import "server-only";
import type { TokenExchangeResult } from "@/lib/resources/googleDrive/tokenRefresh";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
}

/** The only place that calls Google's token endpoint with a `refresh_token` grant - used by lib/resources/googleDrive/driveSessionServer.ts. Never throws; network/parse failures come back as `{ ok: false }`. */
export async function exchangeRefreshTokenWithGoogle(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<TokenExchangeResult> {
  try {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: params.refreshToken,
        client_id: params.clientId,
        client_secret: params.clientSecret,
        grant_type: "refresh_token",
      }).toString(),
    });

    if (!response.ok) return { ok: false };

    const data = (await response.json().catch(() => null)) as GoogleTokenResponse | null;
    if (!data || typeof data.access_token !== "string" || data.access_token.length === 0 || typeof data.expires_in !== "number") {
      return { ok: false };
    }

    return {
      ok: true,
      accessToken: data.access_token,
      expiresInSeconds: data.expires_in,
      refreshToken: typeof data.refresh_token === "string" && data.refresh_token.length > 0 ? data.refresh_token : undefined,
    };
  } catch {
    return { ok: false };
  }
}
