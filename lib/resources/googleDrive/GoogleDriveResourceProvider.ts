import type { ExternalResource, ExternalResourceProvider } from "@/lib/resources/externalResourceProvider";

interface DriveFilesResponse {
  files: ExternalResource[];
}

async function fetchFiles(url: string): Promise<ExternalResource[]> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Google Drive request failed.");
  }
  const data = (await response.json()) as DriveFilesResponse;
  return data.files;
}

/**
 * The only Drive-aware client-side code in the whole app (Part 10) -
 * everything here calls Falcon Deck's own first-party `/api/drive/*`
 * routes, never Google's API directly, and never sees an access token
 * (that stays server-side in an httpOnly cookie - Part 11).
 */
export class GoogleDriveResourceProvider implements ExternalResourceProvider {
  search(query: string): Promise<ExternalResource[]> {
    return fetchFiles(`/api/drive/search?q=${encodeURIComponent(query)}`);
  }

  listRecent(): Promise<ExternalResource[]> {
    return fetchFiles("/api/drive/recent");
  }

  async getFile(id: string): Promise<ExternalResource | null> {
    const response = await fetch(`/api/drive/file/${encodeURIComponent(id)}`);
    if (response.status === 404) return null;
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Google Drive request failed.");
    }
    const data = (await response.json()) as { file: ExternalResource };
    return data.file;
  }
}
