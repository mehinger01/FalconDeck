/**
 * Provider-agnostic shape for a file living outside Falcon Deck (Part 10).
 * Google Drive is the only implementation in Phase 5, but nothing here
 * names Drive - a future provider (e.g. OneDrive) would implement the same
 * interface without changing any consumer of it.
 */
export interface ExternalResource {
  id: string;
  name: string;
  mimeType: string;
  webViewUrl: string;
  iconUrl?: string;
  thumbnailUrl?: string;
  modifiedTime?: string;
}

/**
 * The adapter boundary between Falcon Deck and any external file source.
 * React components and the Resource Library's store actions only ever
 * talk to this interface - never to a provider's SDK/API directly (Part
 * 10's "do not put Google API logic directly inside React components").
 */
export interface ExternalResourceProvider {
  search(query: string): Promise<ExternalResource[]>;
  listRecent(): Promise<ExternalResource[]>;
  getFile(id: string): Promise<ExternalResource | null>;
}
