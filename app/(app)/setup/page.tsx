import { OnboardingScreen } from "@/components/onboarding/OnboardingScreen";
import { MigrationSetupCard } from "@/components/onboarding/MigrationSetupCard";
import { resolveDataAuthorityState } from "@/lib/auth/dal";

/**
 * This route is only ever reached with a resolved membership (the (app)
 * layout above it redirects anonymous/no-membership/needs-selection users
 * elsewhere) - so `authority.kind` here is always "local" or "cloud-ready",
 * never "anonymous"/"no-membership".
 */
export default async function SetupPage() {
  const authority = await resolveDataAuthorityState();
  const migratedAt = authority.kind === "cloud-ready" ? authority.migratedAt : null;

  return (
    <>
      <MigrationSetupCard migratedAt={migratedAt} />
      <OnboardingScreen />
    </>
  );
}
