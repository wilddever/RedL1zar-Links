import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Request } from "express";
import { db, spotifyConnectionTable } from "@workspace/db";

const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_CURRENTLY_PLAYING_URL =
  "https://api.spotify.com/v1/me/player/currently-playing";
const SPOTIFY_SCOPE = "user-read-currently-playing user-read-playback-state";
const STATE_COOKIE = "spotify_oauth_state";
const OWNER_COOKIE = "spotify_owner_session";
const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const OWNER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const ACCESS_TOKEN_SKEW_MS = 60 * 1000;

type SpotifyTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
};

type SpotifyCurrentResponse = {
  is_playing?: boolean;
  item?: {
    name?: string;
    album?: {
      name?: string;
      images?: Array<{ url?: string }>;
    };
    artists?: Array<{ name?: string }>;
    external_urls?: { spotify?: string };
  } | null;
};

export type SpotifyPublicState = {
  status:
    | "playing"
    | "paused"
    | "idle"
    | "not_configured"
    | "not_connected"
    | "unavailable";
  track: {
    title: string;
    artist: string;
    album: string;
    imageUrl: string | null;
    spotifyUrl: string;
  } | null;
  message: string;
};

type SpotifyConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionSecret: string;
  ownerToken: string | null;
};

let accessTokenCache:
  | { accessToken: string; expiresAt: number }
  | undefined;
let refreshInFlight: Promise<string | null> | undefined;
let spotifyBackoffUntil = 0;

class SpotifyUnauthorizedError extends Error {}
class SpotifyTokenUnauthorizedError extends Error {}
class SpotifyRateLimitedError extends Error {}

function getConfig(): SpotifyConfig | null {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI?.trim();
  const sessionSecret = process.env.SESSION_SECRET?.trim();

  if (!clientId || !clientSecret || !redirectUri || !sessionSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    sessionSecret,
    ownerToken: process.env.SPOTIFY_OWNER_TOKEN?.trim() || null,
  };
}

export function isSpotifyConfigured(): boolean {
  return getConfig() !== null;
}

function serializeCookie(name: string, value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Max-Age=${Math.floor(maxAge / 1000)}; Path=/api/spotify; HttpOnly; SameSite=Lax${secure}`;
}

function appendCookie(request: Request, cookie: string): void {
  const existing = request.res?.getHeader("Set-Cookie");
  const cookies = Array.isArray(existing)
    ? existing.map(String)
    : existing
      ? [String(existing)]
      : [];
  request.res?.setHeader("Set-Cookie", [...cookies, cookie]);
}

function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.get("cookie");
  if (!cookieHeader) return null;

  const prefix = `${name}=`;
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}

function createState(sessionSecret: string): string {
  const nonce = randomBytes(32).toString("hex");
  const signature = createHmac("sha256", sessionSecret)
    .update(nonce)
    .digest("hex");
  return `${nonce}.${signature}`;
}

function isValidState(value: string | null, sessionSecret: string): boolean {
  if (!value) return false;
  const [nonce, signature] = value.split(".");
  if (!nonce || !signature || !/^[a-f0-9]{64}$/.test(nonce)) return false;

  const expected = createHmac("sha256", sessionSecret)
    .update(nonce)
    .digest("hex");
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function hasMatchingSecret(provided: string | null, expected: string | null) {
  if (!provided || !expected) return false;

  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

function createOwnerSession(sessionSecret: string, ownerToken: string): string {
  const nonce = randomBytes(32).toString("hex");
  const signature = createHmac("sha256", sessionSecret)
    .update(`spotify-owner:${ownerToken}:${nonce}`)
    .digest("hex");
  return `${nonce}.${signature}`;
}

function isValidOwnerSession(
  value: string | null,
  sessionSecret: string,
  ownerToken: string,
): boolean {
  if (!value) return false;
  const [nonce, signature] = value.split(".");
  if (!nonce || !signature || !/^[a-f0-9]{64}$/.test(nonce)) return false;

  const expected = createHmac("sha256", sessionSecret)
    .update(`spotify-owner:${ownerToken}:${nonce}`)
    .digest("hex");
  return hasMatchingSecret(signature, expected);
}

async function getStoredConnection() {
  const [connection] = await db
    .select()
    .from(spotifyConnectionTable)
    .where(eq(spotifyConnectionTable.id, 1))
    .limit(1);
  return connection ?? null;
}

async function storeRefreshToken(refreshToken: string): Promise<void> {
  await db
    .insert(spotifyConnectionTable)
    .values({ id: 1, refreshToken })
    .onConflictDoUpdate({
      target: spotifyConnectionTable.id,
      set: { refreshToken, updatedAt: new Date() },
    });
}

async function requestToken(
  body: URLSearchParams,
  config: SpotifyConfig,
): Promise<SpotifyTokenResponse> {
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${config.clientId}:${config.clientSecret}`,
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    if (
      body.get("grant_type") === "refresh_token" &&
      (response.status === 400 || response.status === 401)
    ) {
      throw new SpotifyTokenUnauthorizedError(
        "Spotify refresh token is no longer valid",
      );
    }
    throw new Error(`Spotify token request failed with ${response.status}`);
  }

  return (await response.json()) as SpotifyTokenResponse;
}

async function refreshAccessToken(
  config: SpotifyConfig,
  force = false,
): Promise<string | null> {
  const now = Date.now();
  if (
    !force &&
    accessTokenCache &&
    accessTokenCache.expiresAt > now + ACCESS_TOKEN_SKEW_MS
  ) {
    return accessTokenCache.accessToken;
  }

  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const connection = await getStoredConnection();
    if (!connection) return null;

    const token = await requestToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: connection.refreshToken,
      }),
      config,
    );

    accessTokenCache = {
      accessToken: token.access_token,
      expiresAt: now + token.expires_in * 1000,
    };

    if (token.refresh_token && token.refresh_token !== connection.refreshToken) {
      await storeRefreshToken(token.refresh_token);
    }

    return token.access_token;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = undefined;
  }
}

async function exchangeAuthorizationCode(
  code: string,
  config: SpotifyConfig,
): Promise<void> {
  const token = await requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
    config,
  );

  if (!token.refresh_token) {
    throw new Error("Spotify did not return a refresh token");
  }

  await storeRefreshToken(token.refresh_token);
  accessTokenCache = {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
}

async function requestCurrentPlayback(
  accessToken: string,
): Promise<SpotifyCurrentResponse | null> {
  const response = await fetch(SPOTIFY_CURRENTLY_PLAYING_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 204) return null;
  if (response.status === 401) {
    throw new SpotifyUnauthorizedError("Spotify access token expired");
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "60");
    const retryAfterMs = Number.isFinite(retryAfter)
      ? Math.min(Math.max(retryAfter, 15), 300) * 1000
      : 60 * 1000;
    spotifyBackoffUntil = Date.now() + retryAfterMs;
    throw new SpotifyRateLimitedError("Spotify API rate limit reached");
  }
  if (!response.ok) {
    throw new Error(`Spotify playback request failed with ${response.status}`);
  }

  return (await response.json()) as SpotifyCurrentResponse;
}

function normalizePlayback(
  playback: SpotifyCurrentResponse | null,
): SpotifyPublicState {
  const item = playback?.item;
  if (!item?.name) {
    return {
      status: "idle",
      track: null,
      message: "Сейчас ничего не играет",
    };
  }

  const title = item.name;
  const artist = item.artists
    ?.map((entry) => entry.name?.trim())
    .filter((name): name is string => Boolean(name))
    .join(", ");
  const album = item.album?.name?.trim() || "Без названия альбома";
  const imageUrl = item.album?.images?.[0]?.url?.trim() || "";
  const spotifyUrl = item.external_urls?.spotify?.trim() || "";

  if (!artist || !spotifyUrl) {
    return {
      status: "unavailable",
      track: null,
      message: "Spotify вернул неполные данные о треке",
    };
  }

  return {
    status: playback?.is_playing ? "playing" : "paused",
    track: { title, artist, album, imageUrl, spotifyUrl },
    message: playback?.is_playing ? "Сейчас играет" : "На паузе",
  };
}

export function getSpotifyAuthorizationUrl(request: Request): string | null {
  const config = getConfig();
  if (!config) return null;

  const state = createState(config.sessionSecret);
  appendCookie(
    request,
    serializeCookie(STATE_COOKIE, state, STATE_MAX_AGE_MS),
  );

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    state,
    scope: SPOTIFY_SCOPE,
    show_dialog: "true",
  });

  return `${SPOTIFY_AUTHORIZE_URL}?${params.toString()}`;
}

export function authorizeSpotifyOwner(request: Request): boolean {
  const config = getConfig();
  if (!config?.ownerToken) return false;

  if (
    isValidOwnerSession(
      readCookie(request, OWNER_COOKIE),
      config.sessionSecret,
      config.ownerToken,
    )
  ) {
    return true;
  }

  const providedToken =
    request.get("x-spotify-owner-token") ??
    (typeof request.query.owner_token === "string"
      ? request.query.owner_token
      : null);
  if (!hasMatchingSecret(providedToken, config.ownerToken)) return false;

  appendCookie(
    request,
    serializeCookie(
      OWNER_COOKIE,
      createOwnerSession(config.sessionSecret, config.ownerToken),
      OWNER_MAX_AGE_MS,
    ),
  );
  return true;
}

export function isSpotifyOwner(request: Request): boolean {
  const config = getConfig();
  return Boolean(
    config &&
      config.ownerToken &&
      isValidOwnerSession(
        readCookie(request, OWNER_COOKIE),
        config.sessionSecret,
        config.ownerToken,
      ),
  );
}

export function validateSpotifyCallback(
  request: Request,
  state: string | null,
): boolean {
  const config = getConfig();
  return Boolean(config && isValidState(state, config.sessionSecret));
}

export async function completeSpotifyAuthorization(
  code: string,
): Promise<void> {
  const config = getConfig();
  if (!config) throw new Error("Spotify is not configured");
  await exchangeAuthorizationCode(code, config);
}

export function clearSpotifyStateCookie(request: Request): void {
  appendCookie(
    request,
    serializeCookie(STATE_COOKIE, "", 0),
  );
}

export function getSpotifyStateCookie(request: Request): string | null {
  return readCookie(request, STATE_COOKIE);
}

export function getSpotifyNotConfiguredState(): SpotifyPublicState {
  return {
    status: "not_configured",
    track: null,
    message: "Spotify ещё не подключён",
  };
}

export async function getCurrentSpotifyState(): Promise<SpotifyPublicState> {
  const config = getConfig();
  if (!config) return getSpotifyNotConfiguredState();

  const connection = await getStoredConnection();
  if (!connection) {
    return {
      status: "not_connected",
      track: null,
      message: "Подключите Spotify через официальную авторизацию",
    };
  }

  let accessToken: string | null;
  try {
    accessToken = await refreshAccessToken(config);
  } catch (error) {
    if (error instanceof SpotifyTokenUnauthorizedError) {
      return {
        status: "not_connected",
        track: null,
        message: "Подключите Spotify через официальную авторизацию",
      };
    }
    throw error;
  }
  if (!accessToken) {
    return {
      status: "not_connected",
      track: null,
      message: "Подключите Spotify через официальную авторизацию",
    };
  }

  if (Date.now() < spotifyBackoffUntil) {
    return {
      status: "unavailable",
      track: null,
      message: "Spotify временно недоступен",
    };
  }

  try {
    return normalizePlayback(await requestCurrentPlayback(accessToken));
  } catch (error) {
    if (error instanceof SpotifyRateLimitedError) {
      return {
        status: "unavailable",
        track: null,
        message: "Spotify временно недоступен",
      };
    }
    if (!(error instanceof SpotifyUnauthorizedError)) throw error;
    accessTokenCache = undefined;
    let renewedToken: string | null;
    try {
      renewedToken = await refreshAccessToken(config, true);
    } catch (refreshError) {
      if (!(refreshError instanceof SpotifyTokenUnauthorizedError)) {
        throw refreshError;
      }
      return {
        status: "not_connected",
        track: null,
        message: "Подключите Spotify через официальную авторизацию",
      };
    }
    if (!renewedToken) {
      return {
        status: "not_connected",
        track: null,
        message: "Подключите Spotify через официальную авторизацию",
      };
    }
    return normalizePlayback(await requestCurrentPlayback(renewedToken));
  }
}