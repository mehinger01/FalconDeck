"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { findLibraryResourceByDriveFileId } from "@/lib/data/libraryResources";
import { convertExternalResourceToLibraryResource } from "@/lib/resources/googleDrive/convertExternalResource";
import { GoogleDriveResourceProvider } from "@/lib/resources/googleDrive/GoogleDriveResourceProvider";
import type { ExternalResource } from "@/lib/resources/externalResourceProvider";

const provider = new GoogleDriveResourceProvider();

type DriveStatus = "loading" | "not-configured" | "disconnected" | "connected" | "error";

interface DriveQueryResult {
  query: string;
  files: ExternalResource[];
  error: string | null;
}

/**
 * Search + Recent only (Part 12) - never a full Drive browser, never a
 * folder tree. Every network call goes through `GoogleDriveResourceProvider`
 * (which itself only calls Falcon Deck's own `/api/drive/*` routes), so no
 * Google API or token logic lives in this component (Part 10). Handles
 * every failure state from Part 21 without ever throwing past this
 * component. `driveQuery` ("" meaning "show recent") is the single source
 * of truth an effect reacts to - fetch state is derived from whether
 * `result` matches the current query, never set imperatively inside the
 * effect itself.
 */
export function DriveImportPanel({ onImported }: { onImported?: () => void }) {
  const { data, actions } = useAppData();
  const [status, setStatus] = useState<DriveStatus>("loading");
  const [searchInput, setSearchInput] = useState("");
  const [driveQuery, setDriveQuery] = useState("");
  const [result, setResult] = useState<DriveQueryResult | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/drive/status")
      .then((response) => response.json())
      .then((body: { configured: boolean; connected: boolean }) => {
        if (cancelled) return;
        if (!body.configured) setStatus("not-configured");
        else if (!body.connected) setStatus("disconnected");
        else setStatus("connected");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status !== "connected") return;
    let cancelled = false;
    const request = driveQuery ? provider.search(driveQuery) : provider.listRecent();
    request
      .then((files) => {
        if (!cancelled) setResult({ query: driveQuery, files, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResult({
            query: driveQuery,
            files: [],
            error: error instanceof Error ? error.message : "Google Drive request failed.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status, driveQuery]);

  const isCurrent = result?.query === driveQuery;
  const files = isCurrent ? result.files : [];
  const fileError = isCurrent ? result.error : null;
  const isLoading = status === "connected" && !isCurrent;

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    setDriveQuery(searchInput.trim());
  }

  function handleImport(file: ExternalResource) {
    const existing = findLibraryResourceByDriveFileId(data.libraryResources, file.id);
    const draft = convertExternalResourceToLibraryResource(file);

    if (existing) {
      const shouldUpdate = window.confirm(
        `"${file.name}" was already imported as "${existing.title}". Update the existing entry with the latest info?`,
      );
      if (!shouldUpdate) return;
      actions.importExternalResource(draft, { updateExistingId: existing.id });
    } else {
      actions.importExternalResource(draft);
    }

    setImportedIds((current) => new Set(current).add(file.id));
    onImported?.();
  }

  async function handleDisconnect() {
    await fetch("/api/drive/disconnect", { method: "POST" });
    setStatus("disconnected");
    setResult(null);
  }

  if (status === "loading") return null;

  if (status === "not-configured") {
    return (
      <p className="rounded-lg border border-dashed border-falcon-brown-700/30 p-3 text-xs text-falcon-brown-700/60">
        Google Drive integration has not been configured for this installation.
      </p>
    );
  }

  if (status === "error") {
    return (
      <p className="rounded-lg border border-dashed border-falcon-brown-700/30 p-3 text-xs text-falcon-brown-700/60">
        Couldn&rsquo;t check the Google Drive connection. Try again shortly.
      </p>
    );
  }

  if (status === "disconnected") {
    return (
      <div className="rounded-lg border border-falcon-brown-700/15 bg-white/60 p-3">
        <p className="mb-2 text-xs text-falcon-brown-700/60">
          Connect Google Drive to import files, or add resources manually.
        </p>
        <a
          href="/api/drive/auth"
          className="inline-block rounded-md bg-falcon-brown-900 px-3 py-1.5 text-xs font-semibold text-falcon-cream-100 hover:bg-falcon-brown-800"
        >
          Connect Google Drive
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-falcon-brown-700/15 bg-white/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-falcon-brown-700/70">
          Import from Google Drive
        </p>
        <button
          type="button"
          onClick={handleDisconnect}
          className="text-xs font-medium text-falcon-brown-700/60 hover:underline"
        >
          Disconnect
        </button>
      </div>

      <form onSubmit={handleSearch} className="mb-2 flex gap-2">
        <input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search Drive…"
          className="flex-1 rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
        />
        <button
          type="submit"
          className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-xs font-semibold text-falcon-brown-800 hover:bg-falcon-gold-300/30"
        >
          Search
        </button>
      </form>

      {fileError && <p className="mb-2 text-xs text-red-800">{fileError}</p>}
      {isLoading && <p className="text-xs text-falcon-brown-700/60">Loading…</p>}
      {!isLoading && !fileError && files.length === 0 && (
        <p className="text-xs text-falcon-brown-700/60">No files found.</p>
      )}

      <ul className="flex flex-col gap-1.5">
        {files.map((file) => (
          <li
            key={file.id}
            className="flex items-center justify-between gap-2 rounded-md border border-falcon-brown-700/15 bg-white p-2 text-sm"
          >
            <span className="min-w-0 truncate text-falcon-brown-900">{file.name}</span>
            <button
              type="button"
              onClick={() => handleImport(file)}
              disabled={importedIds.has(file.id)}
              className="shrink-0 rounded-md bg-falcon-brown-900 px-2 py-1 text-xs font-semibold text-falcon-cream-100 hover:bg-falcon-brown-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importedIds.has(file.id) ? "Imported" : "Import"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
