/**
 * Can a tab still running the pre-foundation client (ecb7467, Production until
 * 2026-10-17) end up running its save code against an account or membership
 * created AFTER the switch to a newer build?
 *
 * Two real `next start` builds - the old commit and a current one - take turns
 * on :3000 against the throwaway local stack (scripts/integration/localStack.ts):
 * stopping the old server and starting the new one on the same origin stands in
 * for a deployment. No Vercel (no CDN, no Skew Protection, no alias switch).
 * Playwright drives the browser; FALCON_BROWSER=chromium|webkit (WebKit is the
 * engine Safari uses, not Safari).
 *
 * Part A, browser - old documents opened before the switch, then:
 *   A1 old /login, signed out -> sign in as a post-switch account
 *   A2 old tab signed in -> NavBar sign-out -> sign in as a post-switch account
 *   A3 old tabs (/schedule and /classes) stay open while another tab in the same
 *      browser switches the session to a post-switch account; both old tabs then
 *      save twice (a rejected save followed by a second save)
 *   A4 old /login -> Sign up
 *   A5 old onboarding tab of a user with NO school, while another tab switches to
 *      a post-switch user with no school; the old tab then tries to create one
 *   A6 browser Back to a page loaded before the switch: is it restored from the
 *      back-forward cache, and what does it run?
 *   A7 browser Back across a client-side navigation made before the switch
 * Part B, the old save engine itself (from FALCON_OLD_APP_DIR) with the same
 * session switch, for every table: lesson, class and period-assignment writes
 * and deletes, a rejected save followed by a second save, and a delete-only save.
 *
 * Every account's rows are fingerprinted before and after. Nothing printed
 * contains a token, password or email; accounts appear by label only.
 *
 * Setup and run: docs/ONBOARDING_SETUP_INTEGRATION.md, "Old tabs across a
 * deployment". Not part of `npm run verify`.
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { chromium, webkit, type Browser, type BrowserContext, type Page } from "playwright";
import { SupabaseSetupRepository } from "@/lib/data/supabaseSetupRepository";
import type { AppData, SaveResult } from "@/lib/data/types";
import { createEmptySetupDraft } from "@/lib/onboarding/setupDraft";
import { generateId } from "@/lib/store/id";
import type { SetupDraft } from "@/types/setupDraft";
import { createChecker, loadLocalStackConfig } from "./localStack";

const config = loadLocalStackConfig();
const checker = createChecker();
const check = checker.check;
const observe = (label: string, value: unknown) => console.log(`  obs - ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const admin = new Pool({ connectionString: config.databaseUrl, max: 3 });

const APP = "http://localhost:3000";
const RUN = `oldtab${Date.now().toString(36)}`;
const PASSWORD = `pw-${crypto.randomUUID()}`;
const ENGINE = process.env.FALCON_BROWSER === "webkit" ? "webkit" : "chromium";

function appDir(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See docs/ONBOARDING_SETUP_INTEGRATION.md.`);
  const dir = resolve(value);
  if (!existsSync(join(dir, ".next", "BUILD_ID"))) throw new Error(`${name}: no production build in ${dir} (run next build there first).`);
  return dir;
}
const OLD_DIR = appDir("FALCON_OLD_APP_DIR");
const NEW_DIR = appDir("FALCON_NEW_APP_DIR");

/** Every file under .next/static - to tell which build a page's scripts come from, and to refuse a build not made for this stack. */
function staticFiles(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(name, p);
    }
  };
  walk(join(dir, ".next", "static"));
  return out;
}
const OLD_FILES = staticFiles(OLD_DIR);
const NEW_FILES = staticFiles(NEW_DIR);

/** Refuses a build whose browser bundle points anywhere but this stack (e.g. built with a hosted project's variables). */
function requireBuiltForThisStack(label: string, files: Map<string, string>) {
  let local = false;
  for (const [name, path] of files) {
    if (!name.endsWith(".js")) continue;
    const text = readFileSync(path, "utf8");
    if (/https:\/\/[a-z0-9]{20}\.supabase\.co/.test(text)) throw new Error(`${label} build references a hosted Supabase project. Rebuild it with the stack's variables.`);
    if (text.includes(config.supabaseUrl)) local = true;
  }
  if (!local) throw new Error(`${label} build does not reference ${config.supabaseUrl}. Rebuild it with the stack's variables.`);
}
requireBuiltForThisStack("old", OLD_FILES);
requireBuiltForThisStack("new", NEW_FILES);

// ---------------------------------------------------------------------------
// Servers: one origin, two builds
// ---------------------------------------------------------------------------
let server: ChildProcess | null = null;
async function listening(): Promise<boolean> {
  try {
    await fetch(`${APP}/login`, { redirect: "manual" });
    return true;
  } catch {
    return false;
  }
}
async function startServer(dir: string) {
  if (await listening()) throw new Error("Something is already listening on :3000.");
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: config.supabaseUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.anonKey };
  server = spawn(process.execPath, [join(dir, "node_modules", "next", "dist", "bin", "next"), "start", "-p", "3000"], { cwd: dir, env, stdio: "ignore" });
  for (let i = 0; i < 120; i += 1) {
    if (await listening()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`next start in ${dir} did not come up`);
}
async function stopServer() {
  if (server?.pid) {
    try {
      if (process.platform === "win32") execSync(`taskkill /T /F /PID ${server.pid}`, { stdio: "ignore" });
      else server.kill("SIGKILL");
    } catch {}
  }
  server = null;
  for (let i = 0; i < 60 && (await listening()); i += 1) await new Promise((r) => setTimeout(r, 250));
}

// ---------------------------------------------------------------------------
// Accounts and fingerprints
// ---------------------------------------------------------------------------
interface Account {
  label: string;
  email: string;
  userId: string;
  membershipId: string | null;
  organizationId: string | null;
}
const accounts: Account[] = [];
const labelOf = new Map<string, string>();

function anonClient(): SupabaseClient {
  return createClient(config.supabaseUrl, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signUp(label: string): Promise<{ account: Account; client: SupabaseClient }> {
  const email = `${RUN}-${label.toLowerCase()}@example.test`;
  const client = anonClient();
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD });
  if (error || !data.user || !data.session) throw new Error(`sign-up ${label}: ${error?.message ?? "no session (is autoconfirm on?)"}`);
  const account: Account = { label, email, userId: data.user.id, membershipId: null, organizationId: null };
  accounts.push(account);
  labelOf.set(account.userId, label);
  return { account, client };
}

async function withSchool(label: string, schedule: "own" | "shared" | "none"): Promise<Account> {
  const { account, client } = await signUp(label);
  const boot = await client.rpc("bootstrap_organization", { organization_name: `${label} School` });
  if (boot.error) throw new Error(`bootstrap ${label}: ${boot.error.message}`);
  const row = (await admin.query("select id, organization_id from public.organization_memberships where user_id = $1", [account.userId])).rows[0];
  account.membershipId = row.id;
  account.organizationId = row.organization_id;
  if (schedule === "none") return account;

  const courseId = generateId("course");
  const sectionId = generateId("section");
  let draftSchedule: SetupDraft["schedule"];
  if (schedule === "shared") {
    const scheduleId = `schedule-${crypto.randomUUID()}`;
    await admin.query(
      `insert into public.bell_schedules (id, organization_id, owner_type, owner_membership_id, name, is_default, source)
       values ($1, $2, 'organization', null, 'Regular Day', true, 'built-in')`,
      [scheduleId, account.organizationId],
    );
    await admin.query(
      `insert into public.schedule_blocks (id, bell_schedule_id, organization_id, owner_type, owner_membership_id, position, label, kind, start_time, end_time)
       values ($1 || ':p1', $1, $2, 'organization', null, 0, '1st Hour', 'instructional', '08:00', '08:50')`,
      [scheduleId, account.organizationId],
    );
    draftSchedule = {
      mode: "shared",
      scheduleId,
      expectedBlocks: [{ id: "p1", label: "1st Hour", kind: "instructional", startTime: "08:00", endTime: "08:50", customKindLabel: null, isLunchWindow: false, overrides: [] }],
      assignments: [{ id: crypto.randomUUID(), blockId: "p1", classSectionId: sectionId }],
    };
  } else {
    draftSchedule = { mode: "own", id: generateId("schedule"), name: "My Schedule", timeZone: "America/Detroit", blocks: [{ id: generateId("block"), label: "1st Hour", kind: "instructional", startTime: "08:00", endTime: "08:50", classSectionId: sectionId }] };
  }
  const draft: SetupDraft = {
    ...createEmptySetupDraft(),
    courses: [{ id: courseId, name: "Geometry" }],
    classSections: [{ id: sectionId, courseId, name: "Geometry - 1st Hour" }],
    schedule: draftSchedule,
    lunchWave: "B",
    firstLesson: { id: generateId("lesson"), date: "2026-10-12", classSectionId: sectionId, learningTarget: "I can.", agendaItems: [], resources: [], announcements: [] },
  };
  const repository = new SupabaseSetupRepository(client as never, account.organizationId!);
  const saved = await repository.saveDraft(null, draft, { activeBellScheduleId: null, lunchWave: "none" });
  if (!saved.ok || saved.value.status !== "saved") throw new Error(`draft ${label}`);
  const done = await repository.completeSetup(saved.value.operationId, saved.value.revision);
  if (!done.ok || done.value.status !== "completed") throw new Error(`completion ${label}`);
  return account;
}

let ownedTables: string[] = [];
/** One hash per account over its memberships and every row of every table carrying owner_membership_id. */
async function fingerprint(account: Account): Promise<{ memberships: number; hash: string; counts: Record<string, number> }> {
  const memberships = (await admin.query("select id from public.organization_memberships where user_id = $1 order by id", [account.userId])).rows.map((r) => r.id as string);
  const parts: string[] = [JSON.stringify(memberships)];
  const counts: Record<string, number> = {};
  for (const table of ownedTables) {
    const row = (
      await admin.query(`select count(*)::int as n, coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as h from public.${table} t where owner_membership_id = any($1::uuid[])`, [memberships])
    ).rows[0];
    parts.push(`${table}:${row.h}`);
    if (row.n > 0) counts[table] = row.n;
  }
  const membershipRows = (await admin.query("select md5(string_agg(m::text, '|' order by m::text)) as h from public.organization_memberships m where user_id = $1", [account.userId])).rows[0];
  parts.push(`memberships:${membershipRows.h ?? ""}`);
  return { memberships: memberships.length, hash: parts.join(";"), counts };
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------
async function buildOf(page: Page): Promise<string> {
  const srcs: string[] = await page.evaluate(() => Array.from(document.scripts).map((s) => s.src).filter(Boolean)).catch(() => []);
  const names = srcs.map((s) => s.split("?")[0].split("/").pop()!).filter((n) => n.endsWith(".js"));
  const old = names.filter((n) => OLD_FILES.has(n) && !NEW_FILES.has(n)).length;
  const nu = names.filter((n) => NEW_FILES.has(n) && !OLD_FILES.has(n)).length;
  return old > 0 && nu === 0 ? "old" : nu > 0 && old === 0 ? "new" : `unknown(old ${old}, new ${nu})`;
}
const MARK = "loaded-before-switch";
const mark = (page: Page, tag = MARK) => page.evaluate((t) => ((window as unknown as { __marker: string }).__marker = t), tag);
const markerOf = (page: Page) => page.evaluate(() => (window as unknown as { __marker?: string }).__marker ?? null).catch(() => null);
async function state(page: Page): Promise<{ path: string; build: string; marker: string | null }> {
  return { path: new URL(page.url()).pathname + new URL(page.url()).search, build: await buildOf(page), marker: await markerOf(page) };
}
/** Waits until the document that carries `tag` is gone (a full load replaced it), up to `ms`. */
async function waitReplaced(page: Page, tag: string, ms = 15000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if ((await markerOf(page)) !== tag) return true;
    await page.waitForTimeout(100);
  }
  return false;
}
async function settle(page: Page) {
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
}

interface Hit {
  tab: string;
  method: string;
  table: string;
  as: string;
  status: number | null;
  oldDocument: boolean;
}
const hits: Hit[] = [];
const actionResults: Array<{ tab: string; path: string; action: string; status: number; notFound: boolean }> = [];
function sessionLabel(authorization: string | undefined): string {
  if (!authorization?.startsWith("Bearer ")) return "none";
  try {
    const payload = JSON.parse(Buffer.from(authorization.slice(7).split(".")[1], "base64url").toString());
    return labelOf.get(payload.sub) ?? (payload.role === "anon" ? "anon" : "unknown");
  } catch {
    return "unparsed";
  }
}
/** Records every non-GET PostgREST call (table or rpc, as whom, status, from an old document?) and every server-action POST. */
function watch(page: Page, tab: string) {
  page.on("request", (request) => {
    if (!request.url().startsWith(config.supabaseUrl)) return;
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/rest/v1/") || request.method() === "GET") return;
    const hit: Hit = { tab, method: request.method(), table: path.slice("/rest/v1/".length), as: sessionLabel(request.headers()["authorization"]), status: null, oldDocument: false };
    hits.push(hit);
    markerOf(page).then((m) => (hit.oldDocument = m !== null && m.startsWith(MARK)));
    request.response().then((r) => (hit.status = r?.status() ?? null)).catch(() => {});
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push({ tab, text: message.text().slice(0, 140) });
  });
  page.on("response", (response) => {
    const request = response.request();
    if (request.method() === "POST" && request.url().startsWith(APP) && request.headers()["next-action"]) {
      actionResults.push({
        tab,
        path: new URL(request.url()).pathname,
        action: request.headers()["next-action"].slice(0, 8),
        status: response.status(),
        notFound: response.headers()["x-nextjs-action-not-found"] === "1",
      });
    }
  });
}
const consoleErrors: Array<{ tab: string; text: string }> = [];
const writesFrom = (tab: string) => hits.filter((h) => h.tab === tab);
const brief = (list: Hit[]) => list.map((h) => `${h.method} ${h.table} as ${h.as} -> ${h.status}`);

async function signInThroughForm(page: Page, email: string) {
  await page.locator('input[name="email"]').first().fill(email);
  await page.locator('input[name="password"]').first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await settle(page);
  await page.waitForTimeout(1000);
}
/** In a page of the NEW build: end this browser's session and sign in as `email` (what a teacher does in a fresh tab). */
async function switchSessionIn(page: Page, email: string) {
  await page.goto(`${APP}/login`);
  await page.evaluate(async () => {
    await fetch("/auth/signout", { method: "POST", redirect: "manual" });
  });
  await page.goto(`${APP}/login`);
  await signInThroughForm(page, email);
}
async function clickButton(page: Page, name: string): Promise<boolean> {
  const button = page.getByRole("button", { name, exact: true });
  if ((await button.count()) === 0) return false;
  await button.first().click();
  await page.waitForTimeout(2500);
  return true;
}
async function openOld(context: BrowserContext, tab: string, path: string, signInAs?: Account): Promise<Page> {
  const page = await context.newPage();
  watch(page, tab);
  if (signInAs) {
    await page.goto(`${APP}/login`);
    await signInThroughForm(page, signInAs.email);
  }
  await page.goto(`${APP}${path}`);
  await settle(page);
  await mark(page);
  return page;
}

// ---------------------------------------------------------------------------
// Part B: the old engine itself, with the session switched underneath it
// ---------------------------------------------------------------------------
interface Engine {
  load(): Promise<AppData>;
  save(data: AppData): Promise<SaveResult>;
}
async function oldEngine(): Promise<new (client: unknown, ctx: { organizationId: string; membershipId: string }) => Engine> {
  const path = join(OLD_DIR, "lib", "data", "supabaseDataRepository.ts");
  const source = readFileSync(path, "utf8");
  if (source.includes("save_teacher_schedule_preferences") || !source.includes("this.lastSnapshot = null;")) {
    throw new Error("FALCON_OLD_APP_DIR does not hold the pre-foundation save engine (expected ecb7467).");
  }
  const loaded = (await import(pathToFileURL(path).href)) as { SupabaseDataRepository: new (client: unknown, ctx: { organizationId: string; membershipId: string }) => Engine };
  return loaded.SupabaseDataRepository;
}

const withLunch = (data: AppData, lunchWave: AppData["teacherSchedulePreferences"]["lunchWave"]): AppData => ({
  ...data,
  teacherSchedulePreferences: { ...data.teacherSchedulePreferences, lunchWave },
});

async function partB(oldOwner: Account, newcomer: Account, newcomerWithoutSchool: Account) {
  console.log("\nB. The old save engine (from the old checkout) loaded as an existing account, then the session switches underneath it");
  const OldEngine = await oldEngine();
  for (const target of [newcomer, newcomerWithoutSchool]) {
    const client = anonClient();
    const signedIn = await client.auth.signInWithPassword({ email: oldOwner.email, password: PASSWORD });
    if (signedIn.error) throw new Error(`sign-in ${oldOwner.label}`);
    const tab = new OldEngine(client, { organizationId: oldOwner.organizationId!, membershipId: oldOwner.membershipId! });
    const loaded = await tab.load();
    const ownerBefore = await fingerprint(oldOwner);
    const targetBefore = await fingerprint(target);
    const switched = await client.auth.signInWithPassword({ email: target.email, password: PASSWORD });
    if (switched.error) throw new Error(`sign-in ${target.label}`);
    const label = `(${oldOwner.label} -> ${target.label})`;

    const lesson = loaded.lessons[0];
    const section = loaded.classSections[0];
    const assignment = loaded.teacherPeriodAssignments[0];
    if (!lesson || !section || !assignment) throw new Error(`${oldOwner.label} needs a lesson, class and period assignment`);
    const newCourseId = generateId("course");
    const newSectionId = generateId("section");
    const edited: AppData = {
      ...loaded,
      lessons: loaded.lessons.map((l) => (l.id === lesson.id ? { ...l, learningTarget: "Edited in the old tab" } : l)),
      courses: [...loaded.courses, { id: newCourseId, name: "Biology" }],
      classSections: [...loaded.classSections, { id: newSectionId, courseId: newCourseId, name: "Biology - 2nd Hour" }],
      teacherPeriodAssignments: loaded.teacherPeriodAssignments.map((a) => (a.id === assignment.id ? { ...a, classSectionId: newSectionId } : a)),
      teacherSchedulePreferences: { ...loaded.teacherSchedulePreferences, lunchWave: "A" },
    };
    const first = await tab.save(edited);
    check(`${label} first save (lesson edit, new class, reassigned period, lunch wave) is rejected`, !first.ok, first);
    const second = await tab.save(edited);
    check(`${label} the second save, after the failed one, is rejected too`, !second.ok, second);
    // Deletes while the engine still holds the loaded data as its baseline - the
    // order in which the old engine actually issues DELETEs. A second engine,
    // loaded the same way, whose FIRST save after the switch removes the lesson,
    // the class and the period assignment; then a second save.
    const deletes = (data: AppData): AppData => ({
      ...data,
      lessons: [],
      classSections: data.classSections.filter((s) => s.id !== section.id),
      teacherPeriodAssignments: [],
      classPresentationSettings: [],
    });
    const deleter = anonClient();
    if ((await deleter.auth.signInWithPassword({ email: oldOwner.email, password: PASSWORD })).error) throw new Error(`sign-in ${oldOwner.label}`);
    const deleterTab = new OldEngine(deleter, { organizationId: oldOwner.organizationId!, membershipId: oldOwner.membershipId! });
    const deleterLoaded = await deleterTab.load();
    if ((await deleter.auth.signInWithPassword({ email: target.email, password: PASSWORD })).error) throw new Error(`sign-in ${target.label}`);
    const deleteFirst = await deleterTab.save(deletes(deleterLoaded));
    observe(`${label} delete-first save (lesson, class, period assignment) reports`, deleteFirst.ok ? "ok" : `failed: ${deleteFirst.message.slice(0, 90).trimEnd()}`);
    const deleteSecond = await deleterTab.save(withLunch(deletes(deleterLoaded), "C"));
    observe(`${label} ...and a second save after it reports`, deleteSecond.ok ? "ok" : `failed: ${deleteSecond.message.slice(0, 90).trimEnd()}`);
    const third = await tab.save(deletes(loaded));
    observe(`${label} first engine, delete-only save after its two failures, reports`, third.ok ? "ok" : `failed: ${third.message.slice(0, 90).trimEnd()}`);
    const ownerAfter = await fingerprint(oldOwner);
    const targetAfter = await fingerprint(target);
    check(`${label} ${oldOwner.label}'s rows are unchanged`, ownerAfter.hash === ownerBefore.hash, { before: ownerBefore.counts, after: ownerAfter.counts });
    check(`${label} ${target.label}'s rows and memberships are unchanged`, targetAfter.hash === targetBefore.hash, { before: targetBefore.counts, after: targetAfter.counts });
  }
}

// ---------------------------------------------------------------------------
async function main() {
  ownedTables = (
    await admin.query(
      `select c.table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
       where c.table_schema = 'public' and c.column_name = 'owner_membership_id' and t.table_type = 'BASE TABLE' order by 1`,
    )
  ).rows.map((r) => r.table_name as string);

  const browserType = ENGINE === "webkit" ? webkit : chromium;
  const browser: Browser = await browserType.launch();
  console.log(`Old-tab account switch - Playwright ${ENGINE} ${browser.version()}, run ${RUN}`);
  console.log(`old build ${readFileSync(join(OLD_DIR, ".next", "BUILD_ID"), "utf8").trim()}, new build ${readFileSync(join(NEW_DIR, ".next", "BUILD_ID"), "utf8").trim()}`);
  const contexts: BrowserContext[] = [];
  const context = async () => {
    const c = await browser.newContext();
    await c.addInitScript(() => {
      const w = window as unknown as { __pageshows?: boolean[] };
      window.addEventListener("pageshow", (event) => (w.__pageshows ??= []).push((event as PageTransitionEvent).persisted));
    });
    contexts.push(c);
    return c;
  };

  // ---- before the switch: old build -----------------------------------------
  await startServer(OLD_DIR);
  const existing = await withSchool("EXISTING", "shared"); // has class, lesson, period assignment, preferences
  const existingBack = await withSchool("EXISTING-BACK", "own"); // its own old tabs for A6/A7 write to it
  const noSchool = (await signUp("EXISTING-NO-SCHOOL")).account;

  const c1 = await context();
  const a1 = await openOld(c1, "A1", "/login");
  const c2 = await context();
  const a2 = await openOld(c2, "A2", "/schedule", existing);
  const c3 = await context();
  const a3schedule = await openOld(c3, "A3-schedule", "/schedule", existing);
  const a3classes = await c3.newPage();
  watch(a3classes, "A3-classes");
  await a3classes.goto(`${APP}/classes`);
  await settle(a3classes);
  await mark(a3classes);
  const c4 = await context();
  const a4 = await openOld(c4, "A4", "/login");
  const c5 = await context();
  const a5 = await openOld(c5, "A5", "/onboarding?screen=create", noSchool);
  const c6 = await context();
  const a6 = await openOld(c6, "A6", "/schedule", existingBack);
  await mark(a6, `${MARK}:schedule`);
  await a6.goto(`${APP}/classes`); // a second full load: Back will return to /schedule's document
  await settle(a6);
  await mark(a6, `${MARK}:classes`);
  const c7 = await context();
  const a7 = await openOld(c7, "A7", "/schedule", existingBack);
  await a7.locator('a[href="/lessons"]').first().click(); // client-side navigation, same document
  await a7.waitForURL("**/lessons").catch(() => {});
  await settle(a7);

  console.log("\nBefore the switch (every tab on the old build)");
  for (const [tab, page] of [["A1", a1], ["A2", a2], ["A3-schedule", a3schedule], ["A3-classes", a3classes], ["A4", a4], ["A5", a5], ["A6", a6], ["A7", a7]] as const) {
    const s = await state(page);
    check(`${tab} is on the old build at ${s.path}`, s.build === "old" && s.marker !== null, s);
  }

  // ---- the switch -------------------------------------------------------------
  await stopServer();
  await startServer(NEW_DIR);
  const switchedAt = new Date();
  const newcomer = await withSchool("NEW", "own");
  const newcomerNoSchool = (await signUp("NEW-NO-SCHOOL")).account;
  const created = (await admin.query("select min(created_at) as t from auth.users where id = any($1::uuid[])", [[newcomer.userId, newcomerNoSchool.userId]])).rows[0].t as Date;
  check("the post-switch accounts were created after the switch", created.getTime() >= switchedAt.getTime() - 1000);
  const before = new Map<string, Awaited<ReturnType<typeof fingerprint>>>();
  for (const account of accounts) before.set(account.label, await fingerprint(account));

  // ---- A1 -----------------------------------------------------------------------
  console.log("\nA1 old /login (signed out) -> sign in as NEW");
  await signInThroughForm(a1, newcomer.email);
  const a1s = await state(a1);
  observe("A1 server action", actionResults.filter((a) => a.tab === "A1"));
  observe("A1 tab afterwards", a1s);
  observe("A1 what the old document shows now", (await a1.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 160));
  check("A1 no old document is left signed in to an app page", !(a1s.build === "old" && a1s.path !== "/login"), a1s);

  // ---- A2 -----------------------------------------------------------------------
  console.log("\nA2 old tab signed in as EXISTING -> NavBar sign-out -> sign in as NEW");
  await a2.locator('form[action="/auth/signout"] button').first().click();
  const a2replaced = await waitReplaced(a2, MARK);
  await settle(a2);
  check("A2 sign-out replaced the old document with the new build", a2replaced && (await buildOf(a2)) === "new", await state(a2));
  if (new URL(a2.url()).pathname === "/login") await signInThroughForm(a2, newcomer.email);
  check("A2 signing in as NEW happens on the new build", (await buildOf(a2)) === "new", await state(a2));

  // ---- A3 -----------------------------------------------------------------------
  console.log("\nA3 old /schedule and /classes tabs stay open; another tab in the same browser switches to NEW");
  const switcher = await c3.newPage();
  watch(switcher, "A3-switcher");
  await switchSessionIn(switcher, newcomer.email);
  check("A3 both old tabs are still the old documents", (await markerOf(a3schedule)) === MARK && (await markerOf(a3classes)) === MARK && (await buildOf(a3schedule)) === "old");
  await clickButton(a3schedule, "A Lunch");
  await clickButton(a3schedule, "C Lunch");
  await a3classes.getByPlaceholder("New course name").fill("Biology");
  await a3classes.getByPlaceholder("New course name").press("Enter");
  await a3classes.waitForTimeout(2500);
  await a3classes.getByPlaceholder("New course name").fill("Chemistry");
  await a3classes.getByPlaceholder("New course name").press("Enter");
  await a3classes.waitForTimeout(2500);
  const a3writes = [...writesFrom("A3-schedule"), ...writesFrom("A3-classes")];
  observe("A3 writes from the old tabs", brief(a3writes));
  check("A3 the old tabs did write (so the check below means something)", a3writes.length >= 3);
  check("A3 every old-tab write carried NEW's session", a3writes.every((h) => h.as === "NEW"));
  check("A3 every one of them was rejected (4xx)", a3writes.every((h) => h.status !== null && h.status >= 400 && h.status < 500), brief(a3writes));
  check("A3 the old tabs are still old documents afterwards", (await markerOf(a3schedule)) === MARK && (await markerOf(a3classes)) === MARK);

  // ---- A4 -----------------------------------------------------------------------
  console.log("\nA4 old /login -> Sign up");
  const signUpEmail = `${RUN}-a4@example.test`;
  await a4.locator('input[name="email"]').first().fill(signUpEmail);
  await a4.locator('input[name="password"]').first().fill(PASSWORD);
  await a4.getByRole("button", { name: "Sign up" }).click();
  await settle(a4);
  await a4.waitForTimeout(1000);
  const a4user = (await admin.query("select id from auth.users where email = $1", [signUpEmail])).rows[0];
  observe("A4 server action", actionResults.filter((a) => a.tab === "A4"));
  observe("A4 tab afterwards", await state(a4));
  if (a4user) {
    labelOf.set(a4user.id, "A4-SIGNUP");
    check("A4 if an account was created, the tab is on the new build", (await buildOf(a4)) === "new");
  } else {
    check("A4 no account was created from the old tab", true);
  }

  // ---- A5 -----------------------------------------------------------------------
  console.log("\nA5 old onboarding tab (EXISTING-NO-SCHOOL, no school); another tab switches to NEW-NO-SCHOOL; the old tab creates a school");
  const a5switcher = await c5.newPage();
  watch(a5switcher, "A5-switcher");
  await switchSessionIn(a5switcher, newcomerNoSchool.email);
  observe("A5 the switcher tab (new build) landed on", new URL(a5switcher.url()).pathname);
  await a5switcher.close();
  check("A5 the old onboarding tab is still the old document", (await markerOf(a5)) === MARK && (await buildOf(a5)) === "old");
  await a5.locator('input[name="organizationName"]').fill(`${RUN} Old Tab School`);
  await a5.getByRole("button", { name: "Create school" }).click();
  await settle(a5);
  await a5.waitForTimeout(1500);
  observe("A5 server action", actionResults.filter((a) => a.tab === "A5"));
  const a5after = await state(a5);
  observe("A5 tab afterwards", a5after);
  const schoolsCreated = (await admin.query("select count(*)::int as n from public.organizations where name = $1", [`${RUN} Old Tab School`])).rows[0].n;
  const newcomerMemberships = (await admin.query("select count(*)::int as n from public.organization_memberships where user_id = $1", [newcomerNoSchool.userId])).rows[0].n;
  observe("A5 schools created by the old tab's form / NEW-NO-SCHOOL memberships", { schoolsCreated, newcomerMemberships });
  check("A5 if a school or membership was created, the tab is no longer an old document", (schoolsCreated === 0 && newcomerMemberships === 0) || a5after.build === "new");
  observe("A5 old document's console errors", consoleErrors.filter((e) => e.tab === "A5").map((e) => e.text));
  observe("A5 what the old document shows now", (await a5.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 160));
  const backLink = a5.getByRole("link", { name: /Back to school search/ });
  observe("A5 'Back to school search' links found", await backLink.count());
  const clicked = await backLink.first().click({ timeout: 5000 }).then(() => "clicked", (error: Error) => `click failed: ${error.message.split("\n")[0]}`);
  observe("A5 link click", clicked);
  const a5replaced = await waitReplaced(a5, MARK);
  await settle(a5);
  observe("A5 after the link", { replaced: a5replaced, ...(await state(a5)) });
  if (!a5replaced) {
    // The old document stays. Does any save code in it hold an account? An onboarding page mounts no data provider.
    check("A5 the old document that stays wrote nothing to the database", writesFrom("A5").length === 0, brief(writesFrom("A5")));
    await a5.reload();
    await settle(a5);
    check("A5 a reload of that tab gets the new build", (await buildOf(a5)) === "new", await state(a5));
  } else {
    check("A5 the old tab's own link replaces the old document with the new build", (await buildOf(a5)) === "new", await state(a5));
  }

  // ---- A6 -----------------------------------------------------------------------
  console.log("\nA6 browser Back to a document loaded before the switch");
  await a6.goBack();
  await settle(a6);
  const a6back = await a6.evaluate(() => ({
    marker: (window as unknown as { __marker?: string }).__marker ?? null,
    navigationType: (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type ?? null,
    pageshowPersisted: (window as unknown as { __pageshows?: boolean[] }).__pageshows ?? [],
  }));
  const a6build = await buildOf(a6);
  const restoredFromBfcache = a6back.marker === `${MARK}:schedule` && a6back.pageshowPersisted.includes(true);
  observe(`A6 after Back (${ENGINE})`, { ...a6back, build: a6build, path: new URL(a6.url()).pathname, restoredFromBfcache });
  if (a6back.marker === `${MARK}:schedule`) {
    await clickButton(a6, "A Lunch");
    observe("A6 restored old document's writes", brief(writesFrom("A6")));
    check("A6 a restored old document writes only as the account it loaded (EXISTING-BACK)", writesFrom("A6").every((h) => h.as === "EXISTING-BACK"));
  } else {
    check("A6 Back loaded a fresh document from the new build", a6build === "new");
  }
  await a6.goForward();
  await settle(a6);
  observe("A6 after Forward", { ...(await state(a6)) });

  // ---- A7 -----------------------------------------------------------------------
  console.log("\nA7 browser Back across a client-side navigation made before the switch");
  await a7.goBack();
  await settle(a7);
  const a7s = await state(a7);
  observe("A7 after Back", a7s);
  if (a7s.marker === MARK) {
    await clickButton(a7, "A Lunch");
    observe("A7 old document's writes", brief(writesFrom("A7")));
    check("A7 the old document writes only as the account it loaded (EXISTING-BACK)", writesFrom("A7").every((h) => h.as === "EXISTING-BACK"));
  }

  // ---- B ------------------------------------------------------------------------
  await partB(existing, newcomer, newcomerNoSchool);

  // ---- every account ------------------------------------------------------------
  console.log("\nEvery account, before vs after the browser paths (Part B checks its own)");
  for (const account of accounts) {
    const after = await fingerprint(account);
    const was = before.get(account.label)!;
    if (account.label === "EXISTING-BACK") {
      observe(`${account.label} (its own old tabs in A6/A7 may change its lunch wave)`, { before: was.counts, after: after.counts });
      check(`${account.label} membership unchanged`, after.memberships === was.memberships);
    } else {
      check(`${account.label} unchanged (memberships and every owned row)`, after.hash === was.hash, { before: was.counts, after: after.counts });
    }
  }
  const oldDocumentWritesAsNew = hits.filter((h) => h.oldDocument && (h.as === "NEW" || h.as === "NEW-NO-SCHOOL"));
  check("no write from an old document carrying a post-switch account's session succeeded", oldDocumentWritesAsNew.every((h) => h.status !== null && h.status >= 400), brief(oldDocumentWritesAsNew));

  for (const c of contexts) await c.close();
  await browser.close();
  await stopServer();
  await admin.end();
  console.log(checker.failures === 0 ? "\nAll checks passed." : `\n${checker.failures} check(s) FAILED.`);
  process.exit(checker.failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await stopServer();
  await admin.end().catch(() => {});
  process.exit(1);
});
