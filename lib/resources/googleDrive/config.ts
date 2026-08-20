import "server-only";

/**
 * Server-only: reads Google OAuth configuration from environment variables
 * (see .env.example). Never imported by client components - only by
 * `app/api/drive/*` route handlers, which run on the server. No secret
 * value is ever returned to a caller that might forward it to the client;
 * `isGoogleDriveConfigured` only reports presence/absence.
 *
 * `sessionSecret` (FALCON_DECK_SESSION_SECRET) is required here too, not
 * just clientId/clientSecret/redirectUri: without it, Drive sessions can't
 * be encrypted (see lib/resources/googleDrive/session.ts), so the whole
 * integration is treated as unconfigured rather than half-working with an
 * insecure fallback.
 */
export interface GoogleDriveConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionSecret: string;
}

export function getGoogleDriveConfig(): GoogleDriveConfig | null {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI;
  const sessionSecret = process.env.FALCON_DECK_SESSION_SECRET;
  if (!clientId || !clientSecret || !redirectUri || !sessionSecret) return null;
  return { clientId, clientSecret, redirectUri, sessionSecret };
}

export function isGoogleDriveConfigured(): boolean {
  return getGoogleDriveConfig() !== null;
}
