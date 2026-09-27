import { ScheduleChoiceScreen } from "@/components/onboarding/ScheduleChoiceScreen";

/**
 * Stage F (join-existing-school initiative): the mandatory schedule-
 * selection step. Reached either by a teacher navigating here directly, or
 * by ActiveScheduleGate.tsx redirecting them here from any other ordinary
 * route while teacherSchedulePreferences.activeBellScheduleId is null. This
 * page itself never redirects - it's exempt from the gate (see that file's
 * EXEMPT_PATH_PREFIXES) so it can always render regardless of resolution
 * state, which is what keeps the gate from ever looping.
 */
export default function SetupSchedulePage() {
  return <ScheduleChoiceScreen />;
}
