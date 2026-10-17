/**
 * Where guided setup sends people, and where it must not.
 *
 * Intended behaviour (docs/ONBOARDING_SETUP_ARCHITECTURE.md §10):
 * - an account guided setup is due for, entering through / or /setup,
 *   reaches /start;
 * - /start itself stays behind eligibility and the switch;
 * - ordinary routes opened directly behave exactly as before (the gate never
 *   sends them to guided setup);
 * - established, completed, legacy, unreadable, switch-off and production
 *   requests are unchanged.
 *
 * 1. The decision functions the server and gate run, across those accounts.
 * 2. The real ActiveScheduleGate inside the real AppDataProvider, rendered
 *    in Chromium with next/navigation stubbed: what it renders and where it
 *    redirects for each case.
 * 3. That the app's entry points are wired to those functions.
 *
 *   npm run verify:guided-setup-routing
 */
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import type { DataAuthorityState } from "@/lib/auth/dataAuthority";
import { guidedSetupEntry, isGuidedSetupEnabled } from "@/lib/onboarding/guidedSetupFlag";
import { rootDestination, type SetupEntry } from "@/lib/onboarding/setupEntry";
import type { SetupState } from "@/lib/onboarding/setupRepository";
import { gateDestination } from "@/lib/store/ActiveScheduleGate";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok  - ${label}`);
  else {
    failures += 1;
    console.error(`FAIL  - ${label}${detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`}`);
  }
}

const cloud: DataAuthorityState = { kind: "cloud-ready", organizationId: "org", membershipId: "m", migratedAt: null };
const legacyPending: DataAuthorityState = { kind: "local", organizationId: "org", membershipId: "m", migratedAt: null };
const seed = { activeBellScheduleId: null, lunchWave: "none" } as unknown;
const notStarted = (eligible: boolean) => ({ status: "not-started", eligible, reason: eligible ? null : "has-classes", seed }) as unknown as SetupState;
const inProgress = { status: "in-progress", draft: { operationId: "op", revision: 1, updatedAt: "", payload: {} } } as unknown as SetupState;
const completed = { status: "completed", completion: {} } as unknown as SetupState;

interface Account {
  name: string;
  authority: DataAuthorityState;
  setupState: SetupState | null;
  /** teacherSchedulePreferences.activeBellScheduleId once loaded. */
  activeSchedule: string | null;
  guidedWhenOn: boolean;
}
const accounts: Account[] = [
  { name: "new eligible account, nothing chosen", authority: cloud, setupState: notStarted(true), activeSchedule: null, guidedWhenOn: true },
  { name: "new eligible account that chose a school schedule elsewhere", authority: cloud, setupState: notStarted(true), activeSchedule: "s-school", guidedWhenOn: true },
  { name: "guided draft in progress", authority: cloud, setupState: inProgress, activeSchedule: null, guidedWhenOn: true },
  { name: "completed account", authority: cloud, setupState: completed, activeSchedule: "s-own", guidedWhenOn: false },
  { name: "established account (classes, not eligible)", authority: cloud, setupState: notStarted(false), activeSchedule: "s-own", guidedWhenOn: false },
  { name: "established account with no active schedule", authority: cloud, setupState: notStarted(false), activeSchedule: null, guidedWhenOn: false },
  { name: "setup state unreadable", authority: cloud, setupState: null, activeSchedule: null, guidedWhenOn: false },
  { name: "legacy account, migration pending", authority: legacyPending, setupState: notStarted(true), activeSchedule: null, guidedWhenOn: false },
];

const ENVS = {
  "switch on (Preview)": { FALCON_GUIDED_SETUP: "on", VERCEL_ENV: "preview" },
  "switch off": { VERCEL_ENV: "preview" },
  "production, even with the variable set": { FALCON_GUIDED_SETUP: "on", VERCEL_ENV: "production" },
} as const;

/** What the app does for a request, composed from the same functions its entry points call. */
function route(env: Record<string, string>, account: Account, path: string): string {
  const entry: SetupEntry = guidedSetupEntry(isGuidedSetupEnabled(env), account.authority, account.setupState);
  if (path === "/") return rootDestination(entry); // app/page.tsx
  if (path === "/start") return entry === "guided-setup" ? "/start" : "/setup"; // app/(guided)/start/page.tsx
  // (app)/layout.tsx -> ActiveScheduleGate (enabled for cloud-ready only)
  const gate = gateDestination(account.authority.kind === "cloud-ready", path, { activeBellScheduleId: account.activeSchedule }, entry === "guided-setup");
  if (gate) return gate;
  if (path === "/setup" && entry === "guided-setup") return "/start"; // app/(app)/setup/page.tsx
  return path;
}

function decisionChecks() {
  console.log("1. Decisions: / and /setup reach guided setup; nothing else does");
  const ordinary = ["/classes", "/lessons", "/schedule", "/setup/schedule", "/present"];
  for (const [envName, env] of Object.entries(ENVS)) {
    const on = envName.startsWith("switch on");
    for (const account of accounts) {
      const guided = on && account.guidedWhenOn;
      const got = { root: route(env, account, "/"), setup: route(env, account, "/setup"), start: route(env, account, "/start") };
      const before = {
        root: "/present",
        setup: gateDestination(account.authority.kind === "cloud-ready", "/setup", { activeBellScheduleId: account.activeSchedule }) ?? "/setup",
      };
      if (guided) {
        check(`${envName} · ${account.name}: / and /setup reach /start, and /start opens`, got.root === "/start" && got.setup === "/start" && got.start === "/start", got);
      } else {
        check(`${envName} · ${account.name}: / and /setup as before; /start sends back to /setup`, got.root === before.root && got.setup === before.setup && got.start === "/setup", { got, before });
      }
      const ordinaryRoutes = ordinary.map((path) => ({
        path,
        now: route(env, account, path),
        before: gateDestination(account.authority.kind === "cloud-ready", path, { activeBellScheduleId: account.activeSchedule }) ?? path,
      }));
      check(`${envName} · ${account.name}: ordinary routes behave exactly as before guided setup`, ordinaryRoutes.every((r) => r.now === r.before && r.now !== "/start"), ordinaryRoutes);
    }
  }
  check("an eligible new account can open /setup/schedule and /schedule directly", route(ENVS["switch on (Preview)"], accounts[0], "/setup/schedule") === "/setup/schedule" && route(ENVS["switch on (Preview)"], accounts[0], "/schedule") === "/schedule");
  check("the gate's guided case is bare /setup only - not /setup/... or anything else", gateDestination(true, "/setup/other", { activeBellScheduleId: null }, true) === "/setup/schedule" && gateDestination(true, "/present", { activeBellScheduleId: null }, true) === "/setup/schedule");
  check("without the flag the gate is exactly the old rule", gateDestination(true, "/setup", { activeBellScheduleId: null }) === "/setup/schedule" && gateDestination(false, "/setup", { activeBellScheduleId: null }, true) === null);
}

async function bundleHarness(): Promise<string> {
  const result = await build({
    entryPoints: [join(process.cwd(), "scripts/support/activeScheduleGateHarness.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    tsconfig: join(process.cwd(), "tsconfig.json"),
    banner: { js: "var process = { env: { NODE_ENV: 'development' } };" },
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "silent",
    plugins: [
      {
        // The pathname comes from the case; router.replace is recorded, not followed.
        name: "stub-next-navigation",
        setup(build) {
          build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "next-navigation-stub", namespace: "stub" }));
          build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            contents: `
              window.__routing = { replaced: [] };
              const router = { replace: (to) => window.__routing.replaced.push(to), push: (to) => window.__routing.replaced.push("push:" + to), refresh() {}, back() {}, prefetch() {} };
              export function usePathname() { return window.__ROUTE.path; }
              export function useRouter() { return router; }
              export function useSearchParams() { return new URLSearchParams(); }
              export function redirect(to) { throw new Error("redirect " + to); }`,
            loader: "js",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}

interface GateCase {
  name: string;
  path: string;
  enabled: boolean;
  guidedSetupDue?: boolean;
  activeBellScheduleId: string | null;
  expect: { rendersPage: boolean; replacedWith: string | null };
}

async function renderGate(browser: Browser, bundled: string, c: GateCase) {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.evaluate((value) => {
    (window as unknown as { __ROUTE: unknown }).__ROUTE = value;
  }, { path: c.path, enabled: c.enabled, guidedSetupDue: c.guidedSetupDue, activeBellScheduleId: c.activeBellScheduleId });
  await page.addScriptTag({ content: bundled });
  // Let the provider hydrate and the gate's effect run.
  await page.waitForFunction(() => document.getElementById("root")!.childNodes.length > 0 || (window as unknown as { __routing: { replaced: string[] } }).__routing.replaced.length > 0, null, { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  const rendersPage = (await page.locator("#page").count()) === 1;
  const replaced = await page.evaluate(() => (window as unknown as { __routing: { replaced: string[] } }).__routing.replaced);
  await page.close();
  return { rendersPage, replaced, errors };
}

async function gateChecks(browser: Browser) {
  console.log("2. The real ActiveScheduleGate, rendered");
  const bundled = await bundleHarness();
  const cases: GateCase[] = [
    { name: "guided account at /setup with no schedule goes to /start, page not rendered", path: "/setup", enabled: true, guidedSetupDue: true, activeBellScheduleId: null, expect: { rendersPage: false, replacedWith: "/start" } },
    { name: "guided account opening /present directly: the existing gate rule (/setup/schedule), never /start", path: "/present", enabled: true, guidedSetupDue: true, activeBellScheduleId: null, expect: { rendersPage: false, replacedWith: "/setup/schedule" } },
    { name: "guided account opening /classes directly: the existing gate rule", path: "/classes", enabled: true, guidedSetupDue: true, activeBellScheduleId: null, expect: { rendersPage: false, replacedWith: "/setup/schedule" } },
    { name: "guided account opening /setup/schedule directly: renders, no redirect", path: "/setup/schedule", enabled: true, guidedSetupDue: true, activeBellScheduleId: null, expect: { rendersPage: true, replacedWith: null } },
    { name: "guided account opening /schedule directly: renders, no redirect", path: "/schedule", enabled: true, guidedSetupDue: true, activeBellScheduleId: null, expect: { rendersPage: true, replacedWith: null } },
    { name: "guided account with a school schedule chosen, at /classes: renders", path: "/classes", enabled: true, guidedSetupDue: true, activeBellScheduleId: "s-school", expect: { rendersPage: true, replacedWith: null } },
    { name: "guided account with a school schedule chosen, at /setup: the gate lets the page decide (its server redirect)", path: "/setup", enabled: true, guidedSetupDue: true, activeBellScheduleId: "s-school", expect: { rendersPage: true, replacedWith: null } },
    { name: "established/completed account at /setup with no schedule: /setup/schedule, as before", path: "/setup", enabled: true, guidedSetupDue: false, activeBellScheduleId: null, expect: { rendersPage: false, replacedWith: "/setup/schedule" } },
    { name: "established account at /setup with a schedule: renders", path: "/setup", enabled: true, guidedSetupDue: false, activeBellScheduleId: "s-own", expect: { rendersPage: true, replacedWith: null } },
    { name: "/present layout (no guidedSetupDue prop) at /present with no schedule: /setup/schedule, as before", path: "/present", enabled: true, activeBellScheduleId: null, expect: { rendersPage: false, replacedWith: "/setup/schedule" } },
    { name: "migration-pending legacy account: never gated, even if flagged", path: "/setup", enabled: false, guidedSetupDue: true, activeBellScheduleId: null, expect: { rendersPage: true, replacedWith: null } },
  ];
  for (const c of cases) {
    const got = await renderGate(browser, bundled, c);
    const replacedWith = got.replaced.at(-1) ?? null;
    check(c.name, got.errors.length === 0 && got.rendersPage === c.expect.rendersPage && replacedWith === c.expect.replacedWith && got.replaced.every((to) => to === c.expect.replacedWith), got);
  }
}

function wiringChecks() {
  console.log("3. Entry points use these decisions");
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  check("/ redirects by rootDestination of the guided entry", /redirect\(rootDestination\(\(await resolveGuidedSetupContext\(\)\)\.entry\)\)/.test(read("app/page.tsx")));
  const appLayout = read("app/(app)/layout.tsx");
  check("the (app) layout passes guidedSetupDue to the provider and redirects nothing itself", /guidedSetupDue = \(await resolveGuidedSetupContext\(\)\)\.entry === "guided-setup"/.test(appLayout) && /<CutoverAppDataProvider authority=\{authority\} guidedSetupDue=\{guidedSetupDue\}>/.test(appLayout) && !/redirect\("\/start"\)/.test(appLayout));
  const presentLayout = read("app/(presentation)/present/layout.tsx");
  check("the /present layout is untouched by guided setup", !/guided/i.test(presentLayout));
  check("the provider hands guidedSetupDue to the gate", /<ActiveScheduleGate enabled=\{authority\.kind === "cloud-ready"\} guidedSetupDue=\{guidedSetupDue\}>/.test(read("lib/store/CutoverAppDataProvider.tsx")));
  check("/start still requires the guided entry", /if \(context\.entry !== "guided-setup"\) redirect\("\/setup"\)/.test(read("app/(guided)/start/page.tsx")));
  check("the guided entry is decided by the switch first (no lookup while off)", /if \(!isGuidedSetupEnabled\(\)\) return \{ entry: "existing-app" \};/.test(read("lib/auth/guidedSetupEntry.ts")));
}

async function main() {
  decisionChecks();
  const browser = await chromium.launch();
  try {
    await gateChecks(browser);
  } finally {
    await browser.close();
  }
  wiringChecks();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
