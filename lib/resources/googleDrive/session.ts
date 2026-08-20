import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * The Drive OAuth session: an access token (plus refresh token/expiry),
 * held in the browser only as an AES-256-GCM encrypted, authenticated
 * blob inside an HttpOnly/Secure/SameSite=Lax cookie (set by
 * `app/api/drive/callback`) - never in localStorage, never sent to
 * client JavaScript, never returned in an API response body.
 *
 * Precisely: the cookie is a browser-held container, but its *contents*
 * are opaque ciphertext to the browser and to anyone who copies the
 * cookie without the server's `FALCON_DECK_SESSION_SECRET` - only this
 * module's `parseDriveSession`, running server-side, can turn it back
 * into a usable access token. That's a materially different (and much stronger)
 * property than "HttpOnly cookie holding a plaintext token", which is
 * what Falcon Deck did before this hardening pass.
 *
 * Deliberately NOT `import "server-only"`-guarded, unlike the rest of
 * `lib/resources/googleDrive/`: these functions take a secret as an
 * environment variable read at call time, never hold one at module scope,
 * and are exercised directly by scripts/verify-resources.ts (which runs
 * under plain Node, where `server-only` throws unconditionally). The real
 * backstop against accidental client bundling is `node:crypto` itself -
 * Next.js cannot bundle a `node:crypto` import for the browser at all.
 */
export const DRIVE_SESSION_COOKIE = "falcon_deck_drive_session";
/** Short-lived CSRF guard for the OAuth redirect round-trip, cleared once the callback completes (success or failure). */
export const DRIVE_OAUTH_STATE_COOKIE = "falcon_deck_drive_oauth_state";
export const DRIVE_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface DriveSession {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // NIST-recommended IV length for GCM
const AUTH_TAG_LENGTH = 16;
const SESSION_SECRET_ENV_VAR = "FALCON_DECK_SESSION_SECRET";

function getSessionSecret(): string | null {
  const secret = process.env[SESSION_SECRET_ENV_VAR];
  return secret && secret.length > 0 ? secret : null;
}

/** SHA-256 of the operator-provided secret always yields exactly the 32 bytes AES-256 needs, regardless of the secret's own length/format. */
function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/** `iv.authTag.ciphertext`, each base64url - or `null` if no session secret is configured (callers must treat that as "no session available", never as an empty/insecure one). */
function encryptString(plaintext: string): string | null {
  const secret = getSessionSecret();
  if (!secret) return null;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv, authTag, ciphertext].map((buf) => buf.toString("base64url")).join(".");
}

/** Inverse of `encryptString`. Returns `null` for anything that doesn't decrypt and authenticate cleanly - wrong secret, corrupted data, or a tampered value - never throws. */
function decryptString(token: string): string | null {
  const secret = getSessionSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [ivPart, authTagPart, ciphertextPart] = parts;

  try {
    const iv = Buffer.from(ivPart, "base64url");
    const authTag = Buffer.from(authTagPart, "base64url");
    const ciphertext = Buffer.from(ciphertextPart, "base64url");
    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) return null;

    const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // GCM throws on any auth-tag mismatch (wrong key, or the ciphertext/
    // tag/iv was altered in any way) - that's the "reject tampered
    // sessions" property, not a bug to work around.
    return null;
  }
}

/** `null` if `FALCON_DECK_SESSION_SECRET` isn't configured - the caller must not fall back to storing the session unencrypted. */
export function serializeDriveSession(session: DriveSession): string | null {
  return encryptString(JSON.stringify(session));
}

export function parseDriveSession(raw: string | undefined | null): DriveSession | null {
  if (!raw) return null;
  const decrypted = decryptString(raw);
  if (!decrypted) return null;

  try {
    const parsed = JSON.parse(decrypted) as Partial<DriveSession>;
    if (typeof parsed.accessToken !== "string" || parsed.accessToken.length === 0) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === "string" && parsed.refreshToken.length > 0 ? parsed.refreshToken : undefined,
      expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0,
    };
  } catch {
    return null;
  }
}

/** True if the access token itself is still usable right now, with no refresh needed. */
export function isDriveSessionValid(session: DriveSession | null): session is DriveSession {
  return session !== null && session.expiresAt > Date.now();
}

/**
 * True if the session is either currently valid, or can very likely be
 * silently refreshed on next use (it has a refresh token). Used by
 * `/api/drive/status` so a status check never has to perform a real
 * network refresh just to answer "connected?" - and, just as important,
 * so a session with an expired access token and *no* refresh token can
 * never be reported as connected.
 */
export function sessionCanReconnect(session: DriveSession | null): boolean {
  if (!session) return false;
  // Not reusing isDriveSessionValid(session) here: its `session is DriveSession`
  // type predicate makes TypeScript narrow `session` to `never` on the right
  // side of the `||` below (it's already known to be a DriveSession, so the
  // predicate excludes the only remaining type once "false" is assumed).
  return session.expiresAt > Date.now() || Boolean(session.refreshToken);
}
