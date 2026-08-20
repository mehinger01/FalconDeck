"use client";

import { useAppData, useDefaultSchedule } from "@/lib/store/AppDataProvider";

export function SettingsScreen() {
  const { data, actions } = useAppData();
  const defaultSchedule = useDefaultSchedule();
  const classroomExperience = data.classroomExperienceSettings;

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-falcon-brown-900">Settings</h1>
        <p className="mt-1 text-sm text-falcon-brown-700/70">
          Falcon Deck Phase 1 settings. Authentication, Supabase sync, and other integrations are
          intentionally not part of this phase.
        </p>
      </div>

      <section className="rounded-xl border border-falcon-brown-700/15 bg-white/60 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
          Default Schedule
        </h2>
        <p className="mt-1 text-sm text-falcon-brown-700/70">
          Present Mode always follows the schedule marked default.
        </p>
        <select
          value={defaultSchedule?.id ?? ""}
          onChange={(e) => actions.setDefaultSchedule(e.target.value)}
          className="mt-3 w-full rounded-md border border-falcon-brown-700/30 bg-white px-2 py-2 text-sm text-falcon-brown-900"
        >
          {data.schedules.map((schedule) => (
            <option key={schedule.id} value={schedule.id}>
              {schedule.name}
            </option>
          ))}
        </select>
        {defaultSchedule && (
          <p className="mt-2 text-xs text-falcon-brown-700/60">
            Time zone: {defaultSchedule.timeZone}
          </p>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-falcon-brown-700/15 bg-white/60 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
          Classroom Experience
        </h2>
        <p className="mt-1 text-sm text-falcon-brown-700/70">
          Controls Present Mode&rsquo;s automatic transition and end-of-day screens.
        </p>

        <div className="mt-3 flex flex-col gap-3">
          <label className="flex items-start gap-2 text-sm text-falcon-brown-900">
            <input
              type="checkbox"
              checked={classroomExperience.transitionCountdownEnabled}
              onChange={(e) =>
                actions.updateClassroomExperienceSettings({ transitionCountdownEnabled: e.target.checked })
              }
              className="mt-0.5"
            />
            Show a countdown on the between-class transition screen
          </label>

          <label className="flex items-start gap-2 text-sm text-falcon-brown-900">
            <input
              type="checkbox"
              checked={classroomExperience.transitionArrivalInstructionsEnabled}
              onChange={(e) =>
                actions.updateClassroomExperienceSettings({
                  transitionArrivalInstructionsEnabled: e.target.checked,
                })
              }
              className="mt-0.5"
            />
            Show arrival routines on the transition screen
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-falcon-brown-700/70">
              Final-five message (shown with the 5:00 countdown; optional)
            </span>
            <input
              value={classroomExperience.finalFiveMessage}
              onChange={(e) => actions.updateClassroomExperienceSettings({ finalFiveMessage: e.target.value })}
              placeholder="e.g. Wrap up today's work."
              className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
            />
          </label>

          <label className="flex items-start gap-2 text-sm text-falcon-brown-900">
            <input
              type="checkbox"
              checked={classroomExperience.showEndOfDayScreen}
              onChange={(e) =>
                actions.updateClassroomExperienceSettings({ showEndOfDayScreen: e.target.checked })
              }
              className="mt-0.5"
            />
            Show the end-of-day screen once classes are done
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-falcon-brown-700/70">End-of-day message</span>
            <input
              value={classroomExperience.endOfDayMessage}
              onChange={(e) => actions.updateClassroomExperienceSettings({ endOfDayMessage: e.target.value })}
              className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-falcon-brown-700/70">Default Clean Screen message</span>
            <input
              value={classroomExperience.cleanScreenDefaultMessage}
              onChange={(e) =>
                actions.updateClassroomExperienceSettings({ cleanScreenDefaultMessage: e.target.value })
              }
              className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
            />
          </label>

          <label className="flex items-start gap-2 text-sm text-falcon-brown-900">
            <input
              type="checkbox"
              checked={classroomExperience.showClockOnCleanScreen}
              onChange={(e) =>
                actions.updateClassroomExperienceSettings({ showClockOnCleanScreen: e.target.checked })
              }
              className="mt-0.5"
            />
            Show a clock on Clean Screen
          </label>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-falcon-brown-700/15 bg-white/60 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
          Demo Data
        </h2>
        <p className="mt-1 text-sm text-falcon-brown-700/70">
          Everything in Falcon Deck right now is placeholder demo data, stored only in this
          browser. Resetting discards any local edits and restores the original demo schedules,
          courses, and sections.
        </p>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Reset all local changes and restore demo data?")) {
              actions.resetToDemo();
            }
          }}
          className="mt-3 rounded-md border border-red-800/40 px-3 py-1.5 text-sm font-semibold text-red-800 hover:bg-red-800/10"
        >
          Reset to Demo Data
        </button>
      </section>
    </div>
  );
}
