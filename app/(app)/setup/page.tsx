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
  // carry organizationId/membershipId.
  const migratedAt = authority.kind === "cloud-ready" ? authority.migratedAt : null;
  const hasMembership = authority.kind === "local" || authority.kind === "cloud-ready";
  const organizationId = hasMembership ? authority.organizationId : "";
  const membershipId = hasMembership ? authority.membershipId : "";

  return (
    <>
      <MigrationSetupCard migratedAt={migratedAt} organizationId={organizationId} membershipId={membershipId} />
      <RestoreBackupCard authorityKind={authority.kind === "cloud-ready" ? "cloud-ready" : "local"} />
      <OnboardingScreen />
    </>
  );
}
