import { redirect } from "next/navigation";
import { resolveGuidedSetupContext } from "@/lib/auth/guidedSetupEntry";
import { rootDestination } from "@/lib/onboarding/setupEntry";

export default async function RootPage() {
  // With guided setup off this resolves to "existing-app" before any lookup, so "/" still goes straight to /present.
  redirect(rootDestination((await resolveGuidedSetupContext()).entry));
}
