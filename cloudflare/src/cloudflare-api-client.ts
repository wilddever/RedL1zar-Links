export type SpotifyCurrentlyPlaying = {
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

export type SteamCurrentlyPlaying = {
  status: 'playing' | 'not_playing' | 'unavailable';
  game: {
    name: string;
    appId: string | null;
    steamUrl: string;
    imageUrl: string | null;
  } | null;
  message: string;
};

const runtimeApiBaseUrl =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'xn--d1ax3b.fun' ||
    window.location.hostname === 'рэд.fun')
    ? 'https://api.xn--d1ax3b.fun'
    : '';
const apiBaseUrl = (
  import.meta.env.VITE_API_BASE_URL ?? runtimeApiBaseUrl
).replace(/\/+$/, '');
const spotifyCoverApiBaseUrl = (
  import.meta.env.VITE_SPOTIFY_COVER_API_BASE_URL ?? apiBaseUrl
).replace(/\/+$/, '');

export function apiUrl(path: string) {
  return `${apiBaseUrl}${path}`;
}

export function spotifyCoverApiUrl(path: string) {
  return `${spotifyCoverApiBaseUrl}${path}`;
}

async function getJson<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'include',
    signal,
  });
  if (!response.ok) {
    throw new Error(`API request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export function getCurrentSpotifyTrack(options?: { signal?: AbortSignal }) {
  return getJson<SpotifyCurrentlyPlaying>(
    apiUrl('/api/spotify/currently-playing'),
    options?.signal,
  );
}

export function getCurrentSteamGame(options?: { signal?: AbortSignal }) {
  return getJson<SteamCurrentlyPlaying>(
    apiUrl('/api/steam/currently-playing'),
    options?.signal,
  );
}