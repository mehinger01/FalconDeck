import { OnboardingScreen } from "@/components/onboarding/OnboardingScreen";
import { MigrationSetupCard } from "@/components/onboarding/MigrationSetupCard";
import { RestoreBackupCard } from "@/components/onboarding/RestoreBackupCard";
import { resolveDataAuthorityState } from "@/lib/auth/dal";

/**
 * This route is only ever reached with a resolved membership (the (app)
 * layout above it redirects anonymous/no-membership/needs-selection users
 * elsewhere) - so `authority.kind` here is always "local" or "cloud-ready",
 * never "anonymous"/"no-membership".
 */
export default async function SetupPage() {
  const authority = await resolveDataAuthorityState();
  // Guaranteed "local" or "cloud-ready" by the (app) layout above - both
  // carry organizationId/membershipId. "local" is now reserved exclusively
  // for a legacy_import membership whose migration hasn't completed yet
  // (see deriveDataAuthorityState) - so it alone means "migration pending,"
  // with no need to inspect a (possibly-null, possibly-fabricated)
  // migratedAt value to decide.
  const migrationPending = authority.kind === "local";
  const hasMembership = authority.kind === "local" || authority.kind === "cloud-ready";
  const organizationId = hasMembership ? authority.organizationId : "";
  const membershipId = hasMembership ? authority.membershipId : "";

  return (
    <>
      <MigrationSetupCard migrationPending={migrationPending} organizationId={organizationId} membershipId={membershipId} />
      <RestoreBackupCard authorityKind={authority.kind === "cloud-ready" ? "cloud-ready" : "local"} />
      <OnboardingScreen />
    </>
  );
}
