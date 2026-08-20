import "server-only";

/**
 * Server-only: reads Google OAuth configuration from environment variables
 * (see .env.example). Never imported by client components - only by
 * `app/api/drive/*` route handlers, which run on the server. No secret
 * value is ever returned to a caller that might forward it to the client;
 * `isGoogleDriveConfigured` only reports presence/absence.
 */
export interface GoogleDriveConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getGoogleDriveConfig(): GoogleDriveConfig | null {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function isGoogleDriveConfigured(): boolean {
  return getGoogleDriveConfig() !== null;
}
