/**
 * Compatibility of the currently deployed client with this branch's
 * migrations: loads SupabaseDataRepository from a checkout of the deployed
 * commit (not from this branch) and runs its preference save against the
 * local integration stack, which has every migration on this branch applied.
 *
 * Runs only against a throwaway local stack (scripts/integration/localStack.ts).
 * Not part of `npm run verify`. Setup and cleanup:
 * docs/ONBOARDING_SETUP_INTEGRATION.md.
 *
 * Started from the checkout's directory (so the checkout's own "@/..."
 * imports resolve there), naming this file by its path in this branch:
 *
 *   cd <checkout of the deployed commit>
 *   FALCON_COMPAT_CHECKOUT=$PWD npx tsx <this branch>/scripts/integration/deployed-client-compat.ts
 */
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createChecker, loadLocalStackConfig } from "./localStack";

interface Preferences {
  lunchWave: string;
  activeBellScheduleId: string | null;
}
interface AppDataLike {
  teacherSchedulePreferences: Preferences;
}
interface DataRepositoryLike {
  load(): Promise<AppDataLike>;
  save(next: AppDataLike): Promise<unknown>;
}
type RepositoryConstructor = new (client: unknown, ctx: { organizationId: string; membershipId: string }) => DataRepositoryLike;

const config = loadLocalStackConfig();
const checker = createChecker();
const check = checker.check;
const admin = new Pool({ connectionString: config.databaseUrl, max: 4 });

async function loadDeployedRepository(): Promise<RepositoryConstructor> {
  const checkout = process.env.FALCON_COMPAT_CHECKOUT;
  if (!checkout) throw new Error("FALCON_COMPAT_CHECKOUT is not set. See docs/ONBOARDING_SETUP_INTEGRATION.md.");
  const modulePath = join(resolve(checkout), "lib/data/supabaseDataRepository.ts");
  if (!existsSync(modulePath)) throw new Error(`No repository module at ${modulePath}.`);
  if (resolve(process.cwd()) !== resolve(checkout)) {
    throw new Error("Run this from the checkout's directory, so its own imports resolve there (see the document).");
  }
  const loaded = (await import(pathToFileURL(modulePath).href)) as { SupabaseDataRepository?: RepositoryConstructor };
  if (!loaded.SupabaseDataRepository) throw new Error("That checkout has no SupabaseDataRepository.");
  return loaded.SupabaseDataRepository;
}

function withPrefs(data: AppDataLike, prefs: Partial<Preferences>): AppDataLike {
  return { ...data, teacherSchedulePreferences: { ...data.teacherSchedulePreferences, ...prefs } };
}

async function main() {
  const DeployedRepository = await loadDeployedRepository();
  const client = createClient(config.supabaseUrl, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signUp({ email: `deployed-${Date.now()}@example.test`, password: `local-${crypto.randomUUID()}` });
  if (error || !data.user) throw new Error(`sign-up failed: ${error?.message}`);
  const boot = await client.rpc("bootstrap_organization", { organization_name: "Deployed Client School" });
  if (boot.error) throw new Error(`bootstrap_organization failed: ${boot.error.message}`);
  const membership = (await admin.query("select id, organization_id from public.organization_memberships where user_id = $1", [data.user.id])).rows[0];
  const ctx = { organizationId: membership.organization_id as string, membershipId: membership.id as string };

  const schedules: string[] = [];
  for (const name of ["Regular Day", "Late Start"]) {
    const id = `schedule-${crypto.randomUUID()}`;
    schedules.push(id);
    await admin.query(
      `insert into public.bell_schedules (id, organization_id, owner_type, owner_membership_id, name, is_default, source)
       values ($1, $2, 'organization', null, $3, false, 'built-in')`,
      [id, ctx.organizationId, name],
    );
  }
  const stored = async () =>
    (await admin.query("select active_bell_schedule_id, lunch_wave from public.teacher_schedule_preferences where owner_membership_id = $1", [ctx.membershipId])).rows[0] as
      | { active_bell_schedule_id: string | null; lunch_wave: string }
      | undefined;
  const repository = () => new DeployedRepository(client, ctx);

  console.log(`Deployed client from ${process.env.FALCON_COMPAT_CHECKOUT} against the migrated stack`);
  const first = repository();
  await first.save(withPrefs(await first.load(), { activeBellScheduleId: schedules[0], lunchWave: "B" }));
  let row = await stored();
  check("first-row save works", row?.lunch_wave === "B" && row.active_bell_schedule_id === schedules[0], row);

  const second = repository();
  const loaded = await second.load();
  check("a fresh repository reads it back", loaded.teacherSchedulePreferences.lunchWave === "B" && loaded.teacherSchedulePreferences.activeBellScheduleId === schedules[0]);
  await second.save(withPrefs(loaded, { activeBellScheduleId: schedules[1], lunchWave: "C" }));
  row = await stored();
  check("an update save works", row?.lunch_wave === "C" && row.active_bell_schedule_id === schedules[1], row);

  // Mixed fleet: a write through the new RPC (as this branch's client makes it), then the deployed client again.
  const rpc = await client.rpc("save_teacher_schedule_preferences", {
    p_organization_id: ctx.organizationId,
    p_lunch_wave: "A",
    p_active_bell_schedule_id: null,
    p_changed_columns: ["lunch_wave"],
  });
  check("this branch's RPC writes the same row", rpc.error === null && (await stored())?.lunch_wave === "A", rpc.error);
  const third = repository();
  await third.save(withPrefs(await third.load(), { lunchWave: "none" }));
  row = await stored();
  check("the deployed client then writes on top, having read the RPC's value", row?.lunch_wave === "none" && row.active_bell_schedule_id === schedules[1], row);

  const setupRows = (
    await admin.query(
      `select (select count(*) from public.setup_drafts where owner_membership_id = $1)
            + (select count(*) from public.setup_completions where owner_membership_id = $1) as n`,
      [ctx.membershipId],
    )
  ).rows[0].n;
  check("no setup draft or completion is created by the deployed client", Number(setupRows) === 0);

  await admin.end();
  console.log(checker.failures === 0 ? "\nAll deployed-client checks passed." : `\n${checker.failures} check(s) FAILED.`);
  process.exit(checker.failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await admin.end().catch(() => {});
  process.exit(1);
});
