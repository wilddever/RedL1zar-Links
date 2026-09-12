interface Env {
  ASSETS: Fetcher;
  SPOTIFY_KV: KVNamespace;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  SPOTIFY_REDIRECT_URI?: string;
  SPOTIFY_OWNER_TOKEN?: string;
  SESSION_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

type SpotifyPublicState = {
  status:
    | 'playing'
    | 'paused'
    | 'idle'
    | 'not_configured'
    | 'not_connected'
    | 'unavailable';
  track: {
    title: string;
    artist: string;
    album: string;
    imageUrl: string | null;
    spotifyUrl: string;
  } | null;
  message: string;
};

type SteamPublicState = {
  status: 'playing' | 'not_playing' | 'unavailable';
  game: {
    name: string;
    appId: string | null;
    steamUrl: string;
    imageUrl: string | null;
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

const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_CURRENTLY_PLAYING_URL =
  'https://api.spotify.com/v1/me/player/currently-playing';
const SPOTIFY_SCOPE = 'user-read-currently-playing user-read-playback-state';
const SPOTIFY_IMAGE_HOSTS = new Set([
  'i.scdn.co',
  'mosaic.scdn.co',
  'image-cdn-ak.spotifycdn.com',
  'image-cdn-fa.spotifycdn.com',
]);
const YANDEX_SEARCH_URL = 'https://api.music.yandex.net/search';
const YANDEX_404_URL = 'https://music.yandex.ru/404';
const YANDEX_WEB_SEARCH_URL = 'https://music.yandex.ru/search';
const STEAM_PROFILE_URL = 'https://steamcommunity.com/id/RedL1zar?xml=1';
const STEAM_PROFILE_HTML_URL = 'https://steamcommunity.com/id/RedL1zar';
const encoder = new TextEncoder();

let accessTokenCache: { accessToken: string; expiresAt: number } | undefined;
let refreshInFlight: Promise<string | null> | undefined;
let spotifyBackoffUntil = 0;
let lastConfirmedGame: SteamPublicState['game'] = null;
let latestSteamRequestId = 0;

class SpotifyUnauthorizedError extends Error {}
class SpotifyTokenUnauthorizedError extends Error {}
class SpotifyRateLimitedError extends Error {}

function json(data: unknown, status = 200, extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(data), { status, headers });
}

function noStore(data: unknown, status = 200) {
  return json(data, status, { 'Cache-Control': 'no-store' });
}

function text(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 8_000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function getConfig(env: Env): SpotifyConfig | null {
  const clientId = env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = env.SPOTIFY_CLIENT_SECRET?.trim();
  const redirectUri = env.SPOTIFY_REDIRECT_URI?.trim();
  const sessionSecret = env.SESSION_SECRET?.trim();
  if (!clientId || !clientSecret || !redirectUri || !sessionSecret) {
    return null;
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
    sessionSecret,
    ownerToken: env.SPOTIFY_OWNER_TOKEN?.trim() || null,
  };
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomHex(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToHex(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))),
  );
}

async function sha256Hex(value: string) {
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))),
  );
}

function equalSecret(left: string | null, right: string | null) {
  if (!left || !right) return false;
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  const prefix = `${name}=`;
  const part = header
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  if (!part) return null;
  try {
    return decodeURIComponent(part.slice(prefix.length));
  } catch {
    return null;
  }
}

function makeCookie(
  request: Request,
  name: string,
  value: string,
  maxAge: number,
) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Max-Age=${Math.floor(
    maxAge / 1000,
  )}; Path=/api/spotify; HttpOnly; SameSite=Lax${secure}`;
}

async function createState(sessionSecret: string) {
  const nonce = randomHex(32);
  return `${nonce}.${await hmacHex(sessionSecret, nonce)}`;
}

async function isValidState(value: string | null, sessionSecret: string) {
  if (!value) return false;
  const [nonce, signature] = value.split('.');
  if (!nonce || !signature || !/^[a-f0-9]{64}$/.test(nonce)) return false;
  return equalSecret(signature, await hmacHex(sessionSecret, nonce));
}

async function createOwnerSession(sessionSecret: string, ownerToken: string) {
  const nonce = randomHex(32);
  const signature = await hmacHex(
    sessionSecret,
    `spotify-owner:${ownerToken}:${nonce}`,
  );
  return `${nonce}.${signature}`;
}

async function isOwnerSession(
  value: string | null,
  sessionSecret: string,
  ownerToken: string,
) {
  if (!value) return false;
  const [nonce, signature] = value.split('.');
  if (!nonce || !signature || !/^[a-f0-9]{64}$/.test(nonce)) return false;
  return equalSecret(
    signature,
    await hmacHex(sessionSecret, `spotify-owner:${ownerToken}:${nonce}`),
  );
}

async function authorizeOwner(
  request: Request,
  env: Env,
  providedTokenOverride?: string | null,
) {
  const config = getConfig(env);
  if (!config?.ownerToken) return { ok: false, cookie: null };
  if (
    await isOwnerSession(
      readCookie(request, 'spotify_owner_session'),
      config.sessionSecret,
      config.ownerToken,
    )
  ) {
    return { ok: true, cookie: null };
  }

  const providedToken =
    providedTokenOverride === undefined
      ? request.headers.get('x-spotify-owner-token')
      : providedTokenOverride;
  if (!equalSecret(providedToken, config.ownerToken)) {
    return { ok: false, cookie: null };
  }

  return {
    ok: true,
    cookie: makeCookie(
      request,
      'spotify_owner_session',
      await createOwnerSession(config.sessionSecret, config.ownerToken),
      30 * 24 * 60 * 60 * 1000,
    ),
  };
}

async function createSpotifyAuthorizationResponse(
  request: Request,
  env: Env,
  providedToken?: string | null,
) {
  const owner = await authorizeOwner(request, env, providedToken);
  if (!owner.ok) {
    return text('Spotify authorization is restricted to the page owner.', 403);
  }

  const config = getConfig(env);
  if (!config) return noStore({ status: 'not_configured' }, 503);

  const state = await createState(config.sessionSecret);
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    state,
    scope: SPOTIFY_SCOPE,
    show_dialog: 'true',
  });

  return redirect(`${SPOTIFY_AUTHORIZE_URL}?${params}`, [
    makeCookie(request, 'spotify_oauth_state', state, 10 * 60 * 1000),
    ...(owner.cookie ? [owner.cookie] : []),
  ]);
}

function getAllowedSpotifyImageUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || !SPOTIFY_IMAGE_HOSTS.has(url.hostname)) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

async function requestSpotifyToken(
  body: URLSearchParams,
  config: SpotifyConfig,
) {
  const response = await fetchWithTimeout(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!response.ok) {
    if (
      body.get('grant_type') === 'refresh_token' &&
      (response.status === 400 || response.status === 401)
    ) {
      throw new SpotifyTokenUnauthorizedError();
    }
    throw new Error(`Spotify token request failed with ${response.status}`);
  }
  return (await response.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
}

async function refreshAccessToken(
  env: Env,
  config: SpotifyConfig,
  force = false,
): Promise<string | null> {
  const now = Date.now();
  if (
    !force &&
    accessTokenCache &&
    accessTokenCache.expiresAt > now + 60_000
  ) {
    return accessTokenCache.accessToken;
  }
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = await env.SPOTIFY_KV.get('spotify:refresh_token');
    if (!refreshToken) return null;
    const token = await requestSpotifyToken(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      config,
    );
    accessTokenCache = {
      accessToken: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    };
    if (token.refresh_token && token.refresh_token !== refreshToken) {
      await env.SPOTIFY_KV.put('spotify:refresh_token', token.refresh_token);
    }
    return token.access_token;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = undefined;
  }
}

async function normalizeSpotifyPlayback(
  playback: {
    is_playing?: boolean;
    item?: {
      name?: string;
      album?: { name?: string; images?: Array<{ url?: string }> };
      artists?: Array<{ name?: string }>;
      external_urls?: { spotify?: string };
    } | null;
  } | null,
): Promise<SpotifyPublicState> {
  const item = playback?.item;
  if (!item?.name) {
    return {
      status: 'idle',
      track: null,
      message: 'Сейчас ничего не играет',
    };
  }
  const artist = item.artists
    ?.map((entry) => entry.name?.trim())
    .filter((name): name is string => Boolean(name))
    .join(', ');
  const spotifyUrl = item.external_urls?.spotify?.trim() || '';
  if (!artist || !spotifyUrl) {
    return {
      status: 'unavailable',
      track: null,
      message: 'Spotify вернул неполные данные о треке',
    };
  }
  return {
    status: playback?.is_playing ? 'playing' : 'paused',
    track: {
      title: item.name,
      artist,
      album: item.album?.name?.trim() || 'Без названия альбома',
      imageUrl: item.album?.images?.[0]?.url?.trim() || null,
      spotifyUrl,
    },
    message: playback?.is_playing ? 'Сейчас играет' : 'На паузе',
  };
}

async function getCurrentSpotifyState(env: Env): Promise<SpotifyPublicState> {
  const config = getConfig(env);
  if (!config) {
    return {
      status: 'not_configured',
      track: null,
      message: 'Spotify ещё не подключён',
    };
  }

  let accessToken: string | null;
  try {
    accessToken = await refreshAccessToken(env, config);
  } catch (error) {
    if (error instanceof SpotifyTokenUnauthorizedError) {
      return {
        status: 'not_connected',
        track: null,
        message: 'Подключите Spotify через официальную авторизацию',
      };
    }
    throw error;
  }
  if (!accessToken) {
    return {
      status: 'not_connected',
      track: null,
      message: 'Подключите Spotify через официальную авторизацию',
    };
  }
  if (Date.now() < spotifyBackoffUntil) {
    return {
      status: 'unavailable',
      track: null,
      message: 'Spotify временно недоступен',
    };
  }

  const requestPlayback = async (token: string) => {
    const response = await fetchWithTimeout(SPOTIFY_CURRENTLY_PLAYING_URL, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 204) return null;
    if (response.status === 401) throw new SpotifyUnauthorizedError();
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after') || '60');
      spotifyBackoffUntil =
        Date.now() + Math.min(Math.max(retryAfter, 15), 300) * 1000;
      throw new SpotifyRateLimitedError();
    }
    if (!response.ok) {
      throw new Error(`Spotify playback request failed with ${response.status}`);
    }
    return (await response.json()) as Parameters<
      typeof normalizeSpotifyPlayback
    >[0];
  };

  try {
    return await normalizeSpotifyPlayback(await requestPlayback(accessToken));
  } catch (error) {
    if (error instanceof SpotifyRateLimitedError) {
      return {
        status: 'unavailable',
        track: null,
        message: 'Spotify временно недоступен',
      };
    }
    if (!(error instanceof SpotifyUnauthorizedError)) throw error;
    accessTokenCache = undefined;
    let renewedToken: string | null;
    try {
      renewedToken = await refreshAccessToken(env, config, true);
    } catch (refreshError) {
      if (!(refreshError instanceof SpotifyTokenUnauthorizedError)) throw refreshError;
      renewedToken = null;
    }
    if (!renewedToken) {
      return {
        status: 'not_connected',
        track: null,
        message: 'Подключите Spotify через официальную авторизацию',
      };
    }
    return normalizeSpotifyPlayback(await requestPlayback(renewedToken));
  }
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    );
}

function extractTag(source: string, tagName: string) {
  const match = source.match(
    new RegExp(
      `<${tagName}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tagName}>`,
      'i',
    ),
  );
  return decodeXml((match?.[1] ?? match?.[2] ?? '').trim());
}

function createSteamGame(name: string, source: string) {
  const gameLink = extractTag(source, 'gameLink');
  const appId = gameLink.match(/\/app\/(\d+)/i)?.[1] ?? null;
  return {
    name,
    appId,
    steamUrl:
      gameLink ||
      (appId
        ? `https://store.steampowered.com/app/${appId}/`
        : `https://store.steampowered.com/search/?term=${encodeURIComponent(name)}`),
    imageUrl: extractTag(source, 'gameIcon') || extractTag(source, 'gameLogoSmall') || null,
  };
}

function commitSteamState(
  requestId: number,
  state: SteamPublicState,
): SteamPublicState {
  if (requestId !== latestSteamRequestId) return state;
  if (state.status === 'playing') lastConfirmedGame = state.game;
  if (state.status === 'not_playing') lastConfirmedGame = null;
  return state;
}

async function getCurrentSteamState(): Promise<SteamPublicState> {
  const requestId = ++latestSteamRequestId;
  let xml = '';
  let xmlAvailable = false;
  try {
    const response = await fetchWithTimeout(STEAM_PROFILE_URL, {
      headers: {
        Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'RedL1zar personal links',
      },
    });
    if (response.ok) {
      const body = await response.text();
      if (/<profile\b[^>]*(?:\/>|>[\s\S]*<\/profile>)/i.test(body)) {
        xml = body;
        xmlAvailable = true;
      }
    }
  } catch {}

  if (xmlAvailable) {
    const currentGame = extractTag(xml, 'currentGame');
    const name = extractTag(currentGame, 'gameName');
    if (name) {
      return commitSteamState(requestId, {
        status: 'playing',
        game: createSteamGame(name, currentGame),
        message: 'Сейчас играет в Steam',
      });
    }
  }

  let htmlAvailable = false;
  try {
    const response = await fetchWithTimeout(STEAM_PROFILE_HTML_URL, {
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 RedL1zar personal links',
      },
    });
    if (response.ok) {
      const html = await response.text();
      if (/\bprofile_(?:header|summary|content|in_game_name)\b/i.test(html)) {
        htmlAvailable = true;
        const match = html.match(
          /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bprofile_in_game_name\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
        );
        const name = decodeXml((match?.[1] || '').replace(/<[^>]+>/g, '').trim());
        if (name) {
          return commitSteamState(requestId, {
            status: 'playing',
            game: createSteamGame(name, ''),
            message: 'Сейчас играет в Steam',
          });
        }
      }
    }
  } catch {}

  if (!xmlAvailable || !htmlAvailable) {
    return {
      status: 'unavailable',
      game: lastConfirmedGame,
      message: 'Steam временно недоступен',
    };
  }
  return commitSteamState(requestId, {
    status: 'not_playing',
    game: null,
    message: 'В Steam ничего не запущено',
  });
}

function normalizeYandex(value: string) {
  return value
    .toLocaleLowerCase('ru-RU')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function yandexSearchUrl(title: string, artist: string, album?: string) {
  const text = [title, artist, album].filter(Boolean).join(' ').trim();
  if (!text) return YANDEX_404_URL;
  return `${YANDEX_WEB_SEARCH_URL}?${new URLSearchParams({ text })}`;
}

async function findYandexTrack(title: string, artist: string, album?: string) {
  const text = [title, artist, album].filter(Boolean).join(' ').trim();
  if (!text) return null;
  try {
    const response = await fetchWithTimeout(
      `${YANDEX_SEARCH_URL}?${new URLSearchParams({
        text,
        type: 'track',
        page: '0',
      })}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'RedL1zar personal links',
        },
      },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      result?: {
        tracks?: {
          results?: Array<{
            id?: number | string;
            title?: string;
            artists?: Array<{ name?: string }>;
            albums?: Array<{ id?: number | string }>;
          }>;
        };
      };
    };
    const results = payload.result?.tracks?.results ?? [];
    const exact = results.find((track) => {
      const candidateTitle = normalizeYandex(track.title ?? '');
      const candidateArtists = normalizeYandex(
        track.artists?.map((entry) => entry.name ?? '').join(' ') ?? '',
      );
      const requestedArtist = normalizeYandex(artist);
      return (
        candidateTitle === normalizeYandex(title) &&
        (candidateArtists.includes(requestedArtist) ||
          requestedArtist.includes(candidateArtists))
      );
    });
    const track = exact ?? results[0];
    const albumId = track?.albums?.[0]?.id;
    if (track?.id === undefined || albumId === undefined) return null;
    return {
      url: `https://music.yandex.ru/album/${encodeURIComponent(
        String(albumId),
      )}/track/${encodeURIComponent(String(track.id))}`,
    };
  } catch {
    return null;
  }
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Spotify-Owner-Token',
      },
    });
  }

  if (url.pathname === '/api/healthz' && request.method === 'GET') {
    return json({ status: 'ok' });
  }

  if (
    url.pathname === '/api/spotify/owner-session' &&
    request.method === 'POST'
  ) {
    const owner = await authorizeOwner(request, env);
    if (!owner.ok) return noStore({ ok: false, message: 'Неверный owner token.' }, 403);
    const response = noStore({ ok: true });
    if (owner.cookie) response.headers.append('Set-Cookie', owner.cookie);
    return response;
  }

  if (url.pathname === '/api/spotify/owner-auth' && request.method === 'POST') {
    const formData = await request.formData().catch(() => null);
    const providedToken = formData?.get('ownerToken');
    if (typeof providedToken !== 'string' || !providedToken.trim()) {
      return text('Owner token is required.', 400);
    }
    return createSpotifyAuthorizationResponse(request, env, providedToken);
  }

  if (url.pathname === '/api/spotify/auth' && request.method === 'GET') {
    return createSpotifyAuthorizationResponse(request, env);
  }

  if (url.pathname === '/api/spotify/callback' && request.method === 'GET') {
    const owner = await authorizeOwner(request, env);
    if (!owner.ok) {
      return text('Spotify authorization is restricted to the page owner.', 403);
    }
    const config = getConfig(env);
    const state = url.searchParams.get('state');
    const stateCookie = readCookie(request, 'spotify_oauth_state');
    const clearState = makeCookie(request, 'spotify_oauth_state', '', 0);
    if (!config || !stateCookie || state !== stateCookie || !(await isValidState(state, config.sessionSecret))) {
      return new Response('Spotify authorization state is invalid.', {
        status: 400,
        headers: { 'Set-Cookie': clearState },
      });
    }
    if (url.searchParams.get('error')) {
      return redirect('/?spotify=denied', [clearState]);
    }
    const code = url.searchParams.get('code');
    if (!code) return redirect('/?spotify=error', [clearState]);
    try {
      const token = await requestSpotifyToken(
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: config.redirectUri,
        }),
        config,
      );
      if (!token.refresh_token) throw new Error('Spotify did not return a refresh token');
      await env.SPOTIFY_KV.put('spotify:refresh_token', token.refresh_token);
      accessTokenCache = {
        accessToken: token.access_token,
        expiresAt: Date.now() + token.expires_in * 1000,
      };
      return redirect('/?spotify=connected', [clearState]);
    } catch {
      return redirect('/?spotify=error', [clearState]);
    }
  }

  if (
    url.pathname === '/api/spotify/currently-playing' &&
    request.method === 'GET'
  ) {
    try {
      return noStore(await getCurrentSpotifyState(env));
    } catch {
      return noStore({
        status: 'unavailable',
        track: null,
        message: 'Spotify временно недоступен',
      });
    }
  }

  if (url.pathname === '/api/spotify/cover' && request.method === 'GET') {
    const imageUrl = getAllowedSpotifyImageUrl(url.searchParams.get('url') || '');
    if (!imageUrl) return text('Недопустимый адрес обложки Spotify.', 400);
    try {
      const upstream = await fetchWithTimeout(imageUrl, {
        headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
        redirect: 'follow',
      });
      if (!upstream.ok) return new Response(null, { status: upstream.status === 404 ? 404 : 502 });
      const resolvedUrl = getAllowedSpotifyImageUrl(upstream.url);
      const contentType = upstream.headers.get('content-type')?.split(';')[0] || '';
      const body = await upstream.arrayBuffer();
      if (!resolvedUrl || !contentType.startsWith('image/') || body.byteLength > 5 * 1024 * 1024) {
        return new Response(null, { status: 502 });
      }
      return new Response(body, {
        headers: {
          'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
          'Content-Type': contentType,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response(null, { status: 502 });
    }
  }

  if (url.pathname === '/api/steam/currently-playing' && request.method === 'GET') {
    return noStore(await getCurrentSteamState());
  }

  if (url.pathname === '/api/yandex/track' && request.method === 'GET') {
    const title = url.searchParams.get('title')?.trim() || '';
    const artist = url.searchParams.get('artist')?.trim() || '';
    const album = url.searchParams.get('album')?.trim() || '';
    if (!title || !artist) return noStore({ url: YANDEX_404_URL });
    const match = await findYandexTrack(title, artist, album);
    return noStore(match ?? { url: yandexSearchUrl(title, artist, album) });
  }

  if (url.pathname === '/api/send' && request.method === 'POST') {
    const rawBody = await request.json().catch(() => null) as { message?: unknown } | null;
    const message = typeof rawBody?.message === 'string' ? rawBody.message.trim() : '';
    if (!message || message.length > 2_000) {
      return noStore(
        { ok: false, message: 'Сообщение должно содержать от 1 до 2000 символов.' },
        400,
      );
    }
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateKey = `telegram-rate:${await sha256Hex(clientIp)}`;
    if (await env.SPOTIFY_KV.get(rateKey)) {
      return noStore({ ok: false, message: 'Попробуйте отправить сообщение через минуту.' }, 429);
    }
    const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = env.TELEGRAM_CHAT_ID?.trim();
    if (!botToken || !chatId) {
      return noStore({ ok: false, message: 'Telegram пока не подключён.' }, 503);
    }
    await env.SPOTIFY_KV.put(rateKey, '1', { expirationTtl: 60 });
    try {
      const response = await fetchWithTimeout(
        `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `Анонимное сообщение с RedL1zar:\n\n${message}`,
            disable_web_page_preview: true,
          }),
        },
      );
      if (!response.ok) {
        await env.SPOTIFY_KV.delete(rateKey);
        return noStore({ ok: false, message: 'Не удалось доставить сообщение в Telegram.' }, 502);
      }
      return noStore({ ok: true });
    } catch {
      await env.SPOTIFY_KV.delete(rateKey);
      return noStore({ ok: false, message: 'Не удалось доставить сообщение в Telegram.' }, 502);
    }
  }

  return json({ message: 'Not found' }, 404);
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};