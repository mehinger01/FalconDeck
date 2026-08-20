import "server-only";
import type { ExternalResource } from "@/lib/resources/externalResourceProvider";

const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
const FIELDS = "id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime";

interface DriveApiFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  iconLink?: string;
  thumbnailLink?: string;
  modifiedTime?: string;
}

export class DriveApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function toExternalResource(file: DriveApiFile): ExternalResource {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    webViewUrl: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
    iconUrl: file.iconLink,
    thumbnailUrl: file.thumbnailLink,
    modifiedTime: file.modifiedTime,
  };
}

/** Escapes a value for Drive's `contains` query operator (single-quoted string literal). */
function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function listFiles(accessToken: string, query: string): Promise<ExternalResource[]> {
  const url = new URL(DRIVE_FILES_ENDPOINT);
  url.searchParams.set("fields", `files(${FIELDS})`);
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("q", query);

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 401) throw new DriveApiError("Google Drive authorization expired.", 401);
  if (!response.ok) throw new DriveApiError("Google Drive request failed.", response.status);

  const data = (await response.json()) as { files?: DriveApiFile[] };
  return (data.files ?? []).map(toExternalResource);
}

export function searchDriveFiles(accessToken: string, query: string): Promise<ExternalResource[]> {
  return listFiles(accessToken, `trashed = false and name contains '${escapeDriveQueryValue(query)}'`);
}

export function listRecentDriveFiles(accessToken: string): Promise<ExternalResource[]> {
  return listFiles(accessToken, "trashed = false");
}

export async function getDriveFile(accessToken: string, fileId: string): Promise<ExternalResource | null> {
  const url = new URL(`${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", FIELDS);

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 404) return null;
  if (response.status === 401) throw new DriveApiError("Google Drive authorization expired.", 401);
  if (!response.ok) throw new DriveApiError("Google Drive request failed.", response.status);

  return toExternalResource((await response.json()) as DriveApiFile);
}
