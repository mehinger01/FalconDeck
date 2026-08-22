"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { PresentWatermark } from "@/components/present/PresentWatermark";
import { processWatermarkUpload } from "@/lib/present/processWatermarkUpload";
import { DEFAULT_WATERMARK_OPACITY } from "@/types/classPresentation";

interface BrandingDraft {
  customWatermarkDataUrl?: string;
  watermarkOpacity: number;
}

type UploadState = { status: "idle" } | { status: "processing" } | { status: "error"; message: string };

type SaveFeedback = { status: "idle" } | { status: "saved" } | { status: "error"; message: string };

function draftFrom(settings: BrandingDraft): BrandingDraft {
  return { customWatermarkDataUrl: settings.customWatermarkDataUrl, watermarkOpacity: settings.watermarkOpacity };
}

function brandingEqual(a: BrandingDraft, b: BrandingDraft): boolean {
  return a.customWatermarkDataUrl === b.customWatermarkDataUrl && a.watermarkOpacity === b.watermarkOpacity;
}

/**
 * Explicit draft-vs-saved workflow: uploading an image or dragging the
 * opacity slider only ever touches local `draft` state - Present Mode
 * keeps using whatever is in `data.classroomExperienceSettings`
 * (`saved`, below) until the teacher clicks "Save Branding", which
 * dispatches the draft in one `updateClassroomExperienceSettings` call.
 * "Saving…"/"✓ Branding saved."/error feedback tracks the *persistence*
 * outcome (AppDataProvider's `persistence`, not just the in-memory
 * dispatch) via `pendingSaveTarget`, matched against `data` so this only
 * reacts to the save it actually triggered - not some unrelated save
 * that happens to resolve around the same time.
 */
export function PresentModeBrandingSection() {
  const { data, actions, persistence } = useAppData();
  const saved = draftFrom(data.classroomExperienceSettings);

  const [draft, setDraft] = useState<BrandingDraft>(saved);
  const [syncedSaved, setSyncedSaved] = useState<BrandingDraft>(saved);
  const [uploadState, setUploadState] = useState<UploadState>({ status: "idle" });
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback>({ status: "idle" });
  // Non-null while waiting for a Save Branding click's dispatch to finish
  // persisting - the exact draft values we're waiting to see confirmed.
  const [pendingSaveTarget, setPendingSaveTarget] = useState<BrandingDraft | null>(null);
  // `persistence.attempt` as of the moment Save was clicked - lets the
  // resolution check below tell "a save happened before I clicked" apart
  // from "the save I triggered just finished", even when two consecutive
  // saves share the same outcome (see PersistenceState.attempt).
  const [saveAttemptBaseline, setSaveAttemptBaseline] = useState<number | null>(null);

  // Keep the draft aligned with the persisted value when it changes for a
  // reason OTHER than this component's own Save - initial hydration
  // completing after mount, or another tab saving (Part 5) - but only when
  // there's no in-progress local edit, so an external change never
  // clobbers a teacher's unsaved draft out from under them. Adjusting
  // state during render (rather than in an effect) is React's documented
  // pattern for "sync state when a prop/derived value changes".
  if (!brandingEqual(saved, syncedSaved)) {
    if (brandingEqual(draft, syncedSaved)) setDraft(saved);
    setSyncedSaved(saved);
  }

  // Resolves once a NEW save attempt (started after this component's own
  // Save click) has settled - comparing `persistence.attempt` against the
  // baseline captured at click time, not just `status`, so this can't
  // mistake a save that happened *before* the click (or one with the same
  // outcome as a prior one) for confirmation of *this* click. Every value
  // read here is available synchronously during render, so this follows
  // React's documented "adjust state during render" pattern rather than an
  // effect (which would need an extra commit to take effect, and briefly
  // read AppDataProvider's stale pre-save `persistence` value).
  if (saveAttemptBaseline !== null && persistence.attempt > saveAttemptBaseline && persistence.status !== "saving") {
    setSaveAttemptBaseline(null);
    const target = pendingSaveTarget;
    setPendingSaveTarget(null);
    if (persistence.status === "saved") {
      setSaveFeedback({ status: "saved" });
    } else {
      const hasCustomImage = Boolean(target?.customWatermarkDataUrl);
      setSaveFeedback({
        status: "error",
        message: hasCustomImage
          ? "Falcon Deck couldn't save this watermark. Try a smaller image."
          : `Falcon Deck couldn't save your branding settings.${persistence.error ? ` ${persistence.error}` : ""}`,
      });
    }
  }

  // Auto-clears the transient "✓ Branding saved." confirmation.
  useEffect(() => {
    if (saveFeedback.status !== "saved") return;
    const timer = setTimeout(() => setSaveFeedback({ status: "idle" }), 4000);
    return () => clearTimeout(timer);
  }, [saveFeedback]);

  const isSaving = pendingSaveTarget !== null;
  const hasUnsavedChanges = !brandingEqual(draft, saved);
  const hasNonDefaultDraft =
    draft.customWatermarkDataUrl !== undefined || draft.watermarkOpacity !== DEFAULT_WATERMARK_OPACITY;

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // lets the same file be re-selected later (e.g. after fixing an error)
    if (!file) return;

    setUploadState({ status: "processing" });
    const result = await processWatermarkUpload(file);
    if (!result.ok) {
      setUploadState({ status: "error", message: result.error });
      return;
    }
    setDraft((prev) => ({ ...prev, customWatermarkDataUrl: result.dataUrl }));
    setUploadState({ status: "idle" });
    setSaveFeedback({ status: "idle" });
  }

  function handleOpacityChange(percent: number) {
    setDraft((prev) => ({ ...prev, watermarkOpacity: percent / 100 }));
    setSaveFeedback({ status: "idle" });
  }

  function handleReset() {
    setDraft({ customWatermarkDataUrl: undefined, watermarkOpacity: DEFAULT_WATERMARK_OPACITY });
    setUploadState({ status: "idle" });
    setSaveFeedback({ status: "idle" });
  }

  function handleCancel() {
    setDraft(saved);
    setUploadState({ status: "idle" });
    setSaveFeedback({ status: "idle" });
  }

  function handleSave() {
    setPendingSaveTarget(draft);
    setSaveAttemptBaseline(persistence.attempt);
    setSaveFeedback({ status: "idle" });
    actions.updateClassroomExperienceSettings({
      customWatermarkDataUrl: draft.customWatermarkDataUrl,
      watermarkOpacity: draft.watermarkOpacity,
    });
  }

  return (
    <section className="mt-6 rounded-xl border border-falcon-brown-700/15 bg-white/60 p-4">
      <h2 className="text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">Present Mode Branding</h2>
      <p className="mt-1 text-sm text-falcon-brown-700/70">
        The watermark shown behind the four lesson panels in Present Mode.
      </p>
      <p className="mt-1 text-xs text-falcon-brown-700/60">
        Current branding: {saved.customWatermarkDataUrl ? "Custom watermark" : "OHHS Falcon"}
      </p>

      <div className="mt-3 flex flex-col gap-4">
        <div>
          <span className="text-xs font-semibold text-falcon-brown-700/70">Preview</span>
          <div className="relative mt-1 h-40 w-full max-w-sm overflow-hidden rounded-lg bg-falcon-brown-950">
            <PresentWatermark customImageSrc={draft.customWatermarkDataUrl} opacity={draft.watermarkOpacity} />
            <div className="relative z-10 grid h-full grid-cols-2 gap-2 p-3">
              <div className="rounded-md border border-falcon-gold-500/30 bg-falcon-cream-100/5" />
              <div className="rounded-md border border-falcon-gold-500/30 bg-falcon-cream-100/5" />
              <div className="rounded-md border border-falcon-gold-500/30 bg-falcon-cream-100/5" />
              <div className="rounded-md border border-falcon-gold-500/30 bg-falcon-cream-100/5" />
            </div>
          </div>
        </div>

        <div>
          <span className="text-xs font-semibold text-falcon-brown-700/70">Watermark image</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-md border border-falcon-brown-700/30 bg-white px-3 py-1.5 text-sm font-semibold text-falcon-brown-900 hover:bg-falcon-cream-100">
              Upload custom watermark
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleUpload}
                className="hidden"
              />
            </label>
            {hasNonDefaultDraft && (
              <button
                type="button"
                onClick={handleReset}
                className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-sm font-semibold text-falcon-brown-700 hover:bg-falcon-cream-100"
              >
                Reset to OHHS Falcon
              </button>
            )}
          </div>
          {uploadState.status === "processing" && (
            <p className="mt-1 text-xs text-falcon-brown-700/60">Processing image…</p>
          )}
          {uploadState.status === "error" && <p className="mt-1 text-xs text-red-800">{uploadState.message}</p>}
          <p className="mt-1 text-xs text-falcon-brown-700/50">
            PNG, JPG, or WebP. Large images are resized automatically.
          </p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-falcon-brown-700/70">
            Watermark opacity - {Math.round(draft.watermarkOpacity * 100)}%
          </span>
          <input
            type="range"
            min={5}
            max={60}
            step={1}
            value={Math.round(draft.watermarkOpacity * 100)}
            onChange={(e) => handleOpacityChange(Number(e.target.value))}
          />
        </label>

        <div aria-live="polite" className="min-h-[2rem]">
          {isSaving ? (
            <button
              type="button"
              disabled
              className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-white opacity-60"
            >
              Saving…
            </button>
          ) : saveFeedback.status === "error" ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-red-800">{saveFeedback.message}</p>
              <button
                type="button"
                onClick={handleSave}
                className="self-start rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-falcon-brown-800"
              >
                Retry Save
              </button>
            </div>
          ) : hasUnsavedChanges ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={uploadState.status === "processing"}
                className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-falcon-brown-800 disabled:opacity-60"
              >
                Save Branding
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-sm font-semibold text-falcon-brown-700 hover:bg-falcon-cream-100"
              >
                Cancel Changes
              </button>
            </div>
          ) : (
            saveFeedback.status === "saved" && (
              <p className="text-sm font-semibold text-green-800">✓ Branding saved.</p>
            )
          )}
        </div>
      </div>
    </section>
  );
}
