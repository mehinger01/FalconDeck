"use client";

import { useId, useState } from "react";
import { isRecommendedSchedule } from "@/lib/schedule/isRecommendedSchedule";
import { formatTimeString } from "@/lib/schedule/time";
import {
  addOwnBlock,
  buildQuickSchedulePeriods,
  canHoldClass,
  chooseSharedSchedule,
  courseIdForPeriod,
  courseOptions,
  lunchApplies,
  removeOwnBlock,
  scheduleChangeLosesClasses,
  setLunchWave,
  setPeriodCourse,
  startOwnSchedule,
  teachingDayPeriods,
  updateOwnBlock,
  updateOwnScheduleDetails,
} from "@/lib/onboarding/teachingDay";
import type { Course } from "@/types/course";
import { BLOCK_KINDS, type BellSchedule, type BlockKind } from "@/types/schedule";
import type { SetupDraft } from "@/types/setupDraft";
import { DraftTextInput } from "./DraftTextInput";

const KIND_LABEL: Record<BlockKind, string> = {
  instructional: "Class period",
  enrichment: "Enrichment",
  prep: "Prep",
  lunch: "Lunch",
  passing: "Passing time",
  custom: "Other",
};

const LUNCH_OPTIONS: Array<{ value: SetupDraft["lunchWave"]; label: string }> = [
  { value: "A", label: "A Lunch" },
  { value: "B", label: "B Lunch" },
  { value: "C", label: "C Lunch" },
  { value: "none", label: "No lunch wave / not applicable" },
];

const FIELD = "rounded-md border border-falcon-brown-700/30 bg-white px-3 py-2 text-sm text-falcon-brown-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-falcon-gold-500 disabled:opacity-60";
const LABEL = "flex flex-col gap-1 text-sm font-medium text-falcon-brown-800";
const BUTTON_PRIMARY =
  "rounded-md bg-falcon-brown-900 px-3 py-2 text-sm font-semibold text-falcon-cream-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-falcon-gold-500 focus-visible:ring-offset-2 disabled:opacity-50";
const BUTTON_SECONDARY =
  "rounded-md border border-falcon-brown-700/30 bg-white px-3 py-2 text-sm font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-falcon-gold-500 focus-visible:ring-offset-2 disabled:opacity-50";

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function scheduleSpan(schedule: BellSchedule): string {
  const first = schedule.blocks[0];
  const last = schedule.blocks[schedule.blocks.length - 1];
  const count = `${schedule.blocks.length} period${schedule.blocks.length === 1 ? "" : "s"}`;
  return first && last ? `${count} · ${formatTimeString(first.startTime)} – ${formatTimeString(last.endTime)}` : count;
}

export interface TeachingDayScreenProps {
  draft: SetupDraft;
  schoolSchedules: BellSchedule[];
  schoolCourses: Course[];
  disabled: boolean;
  onChange: (next: SetupDraft) => void;
  onPendingChange: (key: string, pending: boolean) => void;
}

export function TeachingDayScreen(props: TeachingDayScreenProps) {
  const { draft, schoolSchedules, disabled } = props;
  const [buildingOwn, setBuildingOwn] = useState(false);
  const ownMode = draft.schedule?.mode === "own";
  const showBuilder = ownMode || buildingOwn || schoolSchedules.length === 0;

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-8 disabled:opacity-70">
      <ScheduleSection {...props} showBuilder={showBuilder} buildingOwn={buildingOwn || ownMode} onBuildOwn={setBuildingOwn} />
      {draft.schedule !== null && <ClassesSection {...props} />}
      {lunchApplies(draft) && <LunchSection {...props} />}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------

function ScheduleSection({
  draft,
  schoolSchedules,
  onChange,
  showBuilder,
  buildingOwn,
  onBuildOwn,
  onPendingChange,
}: TeachingDayScreenProps & { showBuilder: boolean; buildingOwn: boolean; onBuildOwn: (value: boolean) => void }) {
  const groupName = useId();
  const [pendingSwitch, setPendingSwitch] = useState<BellSchedule | "own" | null>(null);
  const selectedId = draft.schedule?.mode === "shared" ? draft.schedule.scheduleId : null;

  const applySwitch = (target: BellSchedule | "own") => {
    setPendingSwitch(null);
    if (target === "own") {
      onBuildOwn(true);
      return;
    }
    onBuildOwn(false);
    onChange(chooseSharedSchedule(draft, target));
  };
  const requestSwitch = (target: BellSchedule | "own") => {
    // Choosing "build my own" changes nothing until periods are laid out; a different school schedule replaces the current one now.
    const changing = target !== "own" && (selectedId !== target.id || buildingOwn);
    if (changing && scheduleChangeLosesClasses(draft)) setPendingSwitch(target);
    else applySwitch(target);
  };

  return (
    <section aria-labelledby="schedule-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="schedule-heading" className="text-lg font-semibold text-falcon-brown-900">
          Your bell schedule
        </h2>
        <p className="text-sm text-falcon-brown-700/70">
          {schoolSchedules.length > 0
            ? "Pick your school's schedule, or build your own if yours isn't listed."
            : "Your school hasn't added a bell schedule yet. Build yours below — you can switch to a school schedule later."}
        </p>
      </div>

      {schoolSchedules.length > 0 && (
        <div role="radiogroup" aria-labelledby="schedule-heading" className="flex flex-col gap-2">
          {schoolSchedules.map((schedule) => (
            <label
              key={schedule.id}
              className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 focus-within:ring-2 focus-within:ring-falcon-gold-500 ${
                selectedId === schedule.id && !buildingOwn ? "border-falcon-gold-500 bg-falcon-gold-300/20" : "border-falcon-brown-700/30 bg-white"
              }`}
            >
              <input
                type="radio"
                name={groupName}
                className="mt-1"
                checked={selectedId === schedule.id && !buildingOwn}
                onChange={() => requestSwitch(schedule)}
              />
              <span>
                <span className="font-semibold text-falcon-brown-900">{schedule.name}</span>
                {isRecommendedSchedule(schedule) && (
                  <span className="ml-2 rounded bg-falcon-gold-300/40 px-1.5 py-0.5 text-xs font-semibold">Recommended by your school</span>
                )}
                <span className="block text-xs text-falcon-brown-700/70">{scheduleSpan(schedule)}</span>
              </span>
            </label>
          ))}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 focus-within:ring-2 focus-within:ring-falcon-gold-500 ${
              buildingOwn ? "border-falcon-gold-500 bg-falcon-gold-300/20" : "border-falcon-brown-700/30 bg-white"
            }`}
          >
            <input type="radio" name={groupName} className="mt-1" checked={buildingOwn} onChange={() => requestSwitch("own")} />
            <span>
              <span className="font-semibold text-falcon-brown-900">My school&apos;s schedule isn&apos;t listed</span>
              <span className="block text-xs text-falcon-brown-700/70">Build your own bell schedule here.</span>
            </span>
          </label>
        </div>
      )}

      {pendingSwitch !== null && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-falcon-gold-500 bg-white px-3 py-2 text-sm">
          <span>Changing your schedule removes the {draft.classSections.length} class{draft.classSections.length === 1 ? "" : "es"} you placed in its periods.</span>
          <button type="button" className={BUTTON_PRIMARY} onClick={() => applySwitch(pendingSwitch)}>
            Change schedule
          </button>
          <button type="button" className={BUTTON_SECONDARY} onClick={() => setPendingSwitch(null)}>
            Keep current schedule
          </button>
        </div>
      )}

      {showBuilder && <OwnScheduleBuilder draft={draft} onChange={onChange} onPendingChange={onPendingChange} />}
    </section>
  );
}

function OwnScheduleBuilder({
  draft,
  onChange,
  onPendingChange,
}: Pick<TeachingDayScreenProps, "draft" | "onChange" | "onPendingChange">) {
  const own = draft.schedule?.mode === "own" ? draft.schedule : null;
  const [name, setName] = useState(own?.name ?? "");
  const [timeZone, setTimeZone] = useState(own?.timeZone ?? browserTimeZone());
  const [periodCount, setPeriodCount] = useState("");
  const [firstStart, setFirstStart] = useState("");
  const [periodMinutes, setPeriodMinutes] = useState("");
  const [passingMinutes, setPassingMinutes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const showGenerator = own === null || own.blocks.length === 0 || confirmReplace;

  const generate = () => {
    if (name.trim() === "") return setError("Give your schedule a name.");
    if (timeZone.trim() === "") return setError("Enter your school's time zone.");
    const result = buildQuickSchedulePeriods({
      periodCount: Number(periodCount),
      firstStart,
      periodMinutes: Number(periodMinutes),
      passingMinutes: passingMinutes === "" ? Number.NaN : Number(passingMinutes),
    });
    if (!result.ok) return setError(result.message);
    setError(null);
    setConfirmReplace(false);
    onChange(startOwnSchedule(draft, { name: name.trim(), timeZone: timeZone.trim(), blocks: result.blocks }));
  };

  return (
    <div className="flex flex-col gap-4 rounded-md border border-falcon-brown-700/20 bg-white p-4">
      {showGenerator ? (
        <>
          <p className="text-sm text-falcon-brown-700/80">
            Tell us the basics and Falcon Deck will lay out your periods. You can change any of them next.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL}>
              Schedule name
              <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Regular Day" />
            </label>
            <label className={LABEL}>
              Time zone
              <input className={FIELD} value={timeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder="e.g. America/Detroit" />
            </label>
            <label className={LABEL}>
              How many periods?
              <input className={FIELD} type="number" min={1} max={12} inputMode="numeric" value={periodCount} onChange={(e) => setPeriodCount(e.target.value)} />
            </label>
            <label className={LABEL}>
              First period starts at
              <input className={FIELD} type="time" value={firstStart} onChange={(e) => setFirstStart(e.target.value)} />
            </label>
            <label className={LABEL}>
              Minutes per period
              <input className={FIELD} type="number" min={5} max={240} inputMode="numeric" value={periodMinutes} onChange={(e) => setPeriodMinutes(e.target.value)} />
            </label>
            <label className={LABEL}>
              Minutes between periods
              <input className={FIELD} type="number" min={0} max={60} inputMode="numeric" value={passingMinutes} onChange={(e) => setPassingMinutes(e.target.value)} />
            </label>
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON_PRIMARY} onClick={generate}>
              {own && own.blocks.length > 0 ? "Replace my periods" : "Lay out my periods"}
            </button>
            {confirmReplace && (
              <button type="button" className={BUTTON_SECONDARY} onClick={() => setConfirmReplace(false)}>
                Cancel
              </button>
            )}
          </div>
          {draft.schedule?.mode === "shared" && draft.classSections.length > 0 && (
            <p className="text-sm text-falcon-brown-700/80">Laying out your own periods replaces your school schedule and removes the classes you placed in it.</p>
          )}
          {confirmReplace && draft.classSections.length > 0 && (
            <p className="text-sm text-falcon-brown-700/80">Replacing your periods removes the classes you placed in them.</p>
          )}
        </>
      ) : (
        own && <OwnPeriodsEditor draft={draft} onChange={onChange} onPendingChange={onPendingChange} onRebuild={() => setConfirmReplace(true)} />
      )}
    </div>
  );
}

function OwnPeriodsEditor({
  draft,
  onChange,
  onPendingChange,
  onRebuild,
}: Pick<TeachingDayScreenProps, "draft" | "onChange" | "onPendingChange"> & { onRebuild: () => void }) {
  const own = draft.schedule?.mode === "own" ? draft.schedule : null;
  if (!own) return null;
  const periods = teachingDayPeriods(draft);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL}>
          Schedule name
          <DraftTextInput
            className={FIELD}
            value={own.name}
            onCommit={(value) => onChange(updateOwnScheduleDetails(draft, { name: value }))}
            onPendingChange={(pending) => onPendingChange("schedule-name", pending)}
          />
        </label>
        <label className={LABEL}>
          Time zone
          <DraftTextInput
            className={FIELD}
            value={own.timeZone}
            onCommit={(value) => onChange(updateOwnScheduleDetails(draft, { timeZone: value }))}
            onPendingChange={(pending) => onPendingChange("schedule-zone", pending)}
          />
        </label>
      </div>
      <p className="text-sm text-falcon-brown-700/80">Check your periods. Change any name, time or type before you continue.</p>
      <ul className="flex flex-col gap-2">
        {periods.map((period) => (
          <li key={period.blockId} className="grid grid-cols-2 gap-2 rounded-md border border-falcon-brown-700/20 p-2 sm:grid-cols-[1.4fr_1fr_1fr_1.2fr_auto] sm:items-end">
            <label className={`${LABEL} col-span-2 sm:col-span-1`}>
              <span className="text-xs">Period name</span>
              <DraftTextInput
                className={FIELD}
                value={period.label}
                onCommit={(value) => onChange(updateOwnBlock(draft, period.blockId, { label: value }))}
                onPendingChange={(pending) => onPendingChange(`label-${period.blockId}`, pending)}
              />
            </label>
            <label className={LABEL}>
              <span className="text-xs">Starts</span>
              <DraftTextInput
                className={FIELD}
                type="time"
                value={period.startTime}
                onCommit={(value) => onChange(updateOwnBlock(draft, period.blockId, { startTime: value }))}
                onPendingChange={(pending) => onPendingChange(`start-${period.blockId}`, pending)}
              />
            </label>
            <label className={LABEL}>
              <span className="text-xs">Ends</span>
              <DraftTextInput
                className={FIELD}
                type="time"
                value={period.endTime}
                onCommit={(value) => onChange(updateOwnBlock(draft, period.blockId, { endTime: value }))}
                onPendingChange={(pending) => onPendingChange(`end-${period.blockId}`, pending)}
              />
            </label>
            <label className={LABEL}>
              <span className="text-xs">Type</span>
              <select
                className={FIELD}
                value={period.kind}
                onChange={(e) => onChange(updateOwnBlock(draft, period.blockId, { kind: e.target.value as BlockKind }))}
              >
                {BLOCK_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={`${BUTTON_SECONDARY} col-span-2 sm:col-span-1`}
              onClick={() => onChange(removeOwnBlock(draft, period.blockId))}
              aria-label={`Remove ${period.label}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON_SECONDARY} onClick={() => onChange(addOwnBlock(draft))} disabled={own.blocks.length === 0}>
          Add a period
        </button>
        <button type="button" className={BUTTON_SECONDARY} onClick={onRebuild}>
          Start over with new numbers
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ClassesSection({ draft, schoolCourses, onChange, onPendingChange }: TeachingDayScreenProps) {
  const periods = teachingDayPeriods(draft);
  const options = courseOptions(draft, schoolCourses);
  const [newCourseFor, setNewCourseFor] = useState<string | null>(null);
  const [newCourseName, setNewCourseName] = useState("");

  const addNewCourse = (blockId: string) => {
    if (newCourseName.trim() === "") return;
    onChange(setPeriodCourse(draft, blockId, { kind: "new", name: newCourseName }, schoolCourses));
    setNewCourseFor(null);
    setNewCourseName("");
    onPendingChange(`new-course-${blockId}`, false);
  };

  if (periods.length === 0) return null;
  return (
    <section aria-labelledby="classes-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="classes-heading" className="text-lg font-semibold text-falcon-brown-900">
          Your classes
        </h2>
        <p className="text-sm text-falcon-brown-700/70">
          Choose what you teach each period. Type a course once — then pick it again for any other period you teach it.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {periods.map((period) => {
          const selectId = `course-${period.blockId}`;
          const courseId = courseIdForPeriod(draft, period);
          const section = period.classSectionId ? draft.classSections.find((s) => s.id === period.classSectionId) : undefined;
          return (
            <li key={period.blockId} className="flex flex-col gap-2 rounded-md border border-falcon-brown-700/20 bg-white px-3 py-2 sm:flex-row sm:items-center">
              <div className="sm:w-56">
                <p className="font-semibold text-falcon-brown-900">{period.label}</p>
                <p className="text-xs text-falcon-brown-700/70">
                  {formatTimeString(period.startTime)} – {formatTimeString(period.endTime)}
                  {period.isLunchWindow ? " · includes lunch" : ""}
                </p>
              </div>
              {canHoldClass(period.kind) ? (
                <div className="flex flex-1 flex-col gap-1">
                  {newCourseFor === period.blockId ? (
                    <div className="flex flex-wrap gap-2">
                      <label htmlFor={`${selectId}-new`} className="sr-only">
                        New course name for {period.label}
                      </label>
                      <input
                        id={`${selectId}-new`}
                        autoFocus
                        className={`${FIELD} flex-1`}
                        placeholder="Course name, e.g. Geometry"
                        value={newCourseName}
                        onChange={(e) => {
                          setNewCourseName(e.target.value);
                          onPendingChange(`new-course-${period.blockId}`, e.target.value.trim() !== "");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addNewCourse(period.blockId);
                          if (e.key === "Escape") {
                            setNewCourseFor(null);
                            onPendingChange(`new-course-${period.blockId}`, false);
                          }
                        }}
                      />
                      <button type="button" className={BUTTON_PRIMARY} onClick={() => addNewCourse(period.blockId)} disabled={newCourseName.trim() === ""}>
                        Add course
                      </button>
                      <button
                        type="button"
                        className={BUTTON_SECONDARY}
                        onClick={() => {
                          setNewCourseFor(null);
                          onPendingChange(`new-course-${period.blockId}`, false);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <label htmlFor={selectId} className="sr-only">
                        Course for {period.label}
                      </label>
                      <select
                        id={selectId}
                        className={FIELD}
                        value={courseId ?? ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value === "__new__") {
                            setNewCourseFor(period.blockId);
                            setNewCourseName("");
                            return;
                          }
                          onChange(setPeriodCourse(draft, period.blockId, value === "" ? { kind: "none" } : { kind: "course", courseId: value }, schoolCourses));
                        }}
                      >
                        <option value="">No class this period</option>
                        {options.filter((o) => o.source === "draft").length > 0 && (
                          <optgroup label="Your courses">
                            {options
                              .filter((o) => o.source === "draft")
                              .map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.name}
                                </option>
                              ))}
                          </optgroup>
                        )}
                        {options.filter((o) => o.source === "school").length > 0 && (
                          <optgroup label="Your school's courses">
                            {options
                              .filter((o) => o.source === "school")
                              .map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.name}
                                </option>
                              ))}
                          </optgroup>
                        )}
                        <option value="__new__">+ New course…</option>
                      </select>
                      {section && <p className="text-xs text-falcon-brown-700/70">Class: {section.name}</p>}
                    </>
                  )}
                </div>
              ) : (
                <p className="flex-1 text-sm text-falcon-brown-700/60">{KIND_LABEL[period.kind]} — no class</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LunchSection({ draft, onChange }: TeachingDayScreenProps) {
  const groupName = useId();
  return (
    <section aria-labelledby="lunch-heading" className="flex flex-col gap-2">
      <div>
        <h2 id="lunch-heading" className="text-lg font-semibold text-falcon-brown-900">
          Your lunch
        </h2>
        <p className="text-sm text-falcon-brown-700/70">Your school&apos;s schedule has a lunch period. Which lunch are you assigned?</p>
      </div>
      <div role="radiogroup" aria-labelledby="lunch-heading" className="flex flex-wrap gap-2">
        {LUNCH_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-falcon-gold-500 ${
              draft.lunchWave === option.value ? "border-falcon-gold-500 bg-falcon-gold-300/20 font-semibold" : "border-falcon-brown-700/30 bg-white"
            }`}
          >
            <input type="radio" name={groupName} checked={draft.lunchWave === option.value} onChange={() => onChange(setLunchWave(draft, option.value))} />
            {option.label}
          </label>
        ))}
      </div>
    </section>
  );
}
