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
    '/api/spotify/currently-playing',
    options?.signal,
  );
}

export function getCurrentSteamGame(options?: { signal?: AbortSignal }) {
  return getJson<SteamCurrentlyPlaying>(
    '/api/steam/currently-playing',
    options?.signal,
  );
}