import type { AppData } from "@/lib/data/types";

const STORAGE_KEY = "falcon-deck:app-data:v1";

/** Reads persisted app data from localStorage. Returns `null` on the server or if nothing is saved. */
export function loadFromStorage(): AppData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AppData) : null;
  } catch {
    return null;
  }
}

/** Persists app data to localStorage. Silently no-ops if storage is unavailable. */
export function saveToStorage(data: AppData): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage may be unavailable (private browsing, quota exceeded) - not fatal.
  }
}

export function clearStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
