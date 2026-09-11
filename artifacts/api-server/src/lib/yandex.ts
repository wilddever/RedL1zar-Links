const YANDEX_SEARCH_URL = "https://api.music.yandex.net/search";
const YANDEX_404_URL = "https://music.yandex.ru/404";
const YANDEX_WEB_SEARCH_URL = "https://music.yandex.ru/search";

type YandexArtist = {
  name?: string;
};

type YandexAlbum = {
  id?: number | string;
};

type YandexTrack = {
  id?: number | string;
  title?: string;
  artists?: YandexArtist[];
  albums?: YandexAlbum[];
};

type YandexSearchResponse = {
  result?: {
    tracks?: {
      results?: YandexTrack[];
    };
  };
};

export type YandexTrackLink = {
  url: string;
};

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function getTrackUrl(track: YandexTrack): string | null {
  const trackId = track.id;
  const albumId = track.albums?.[0]?.id;
  if (trackId === undefined || albumId === undefined) return null;

  return `https://music.yandex.ru/album/${encodeURIComponent(String(albumId))}/track/${encodeURIComponent(String(trackId))}`;
}

function chooseTrack(
  results: YandexTrack[],
  title: string,
  artist: string,
): YandexTrack | null {
  const normalizedTitle = normalize(title);
  const normalizedArtist = normalize(artist);

  const exactMatch = results.find((track) => {
    const candidateTitle = normalize(track.title ?? "");
    const candidateArtists = normalize(
      track.artists?.map((entry) => entry.name ?? "").join(" ") ?? "",
    );
    return (
      candidateTitle === normalizedTitle &&
      (candidateArtists.includes(normalizedArtist) ||
        normalizedArtist.includes(candidateArtists))
    );
  });

  return exactMatch ?? results[0] ?? null;
}

export async function findYandexTrack(
  title: string,
  artist: string,
  album?: string,
): Promise<YandexTrackLink | null> {
  const text = [title, artist, album].filter(Boolean).join(" ").trim();
  if (!text) return null;

  const params = new URLSearchParams({
    text,
    type: "track",
    page: "0",
  });

  try {
    const response = await fetch(`${YANDEX_SEARCH_URL}?${params}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "RedL1zar personal links",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as YandexSearchResponse;
    const results = payload.result?.tracks?.results ?? [];
    const track = chooseTrack(results, title, artist);
    const url = track ? getTrackUrl(track) : null;
    return url ? { url } : null;
  } catch {
    return null;
  }
}

export function getYandexSearchUrl(
  title: string,
  artist: string,
  album?: string,
): string {
  const text = [title, artist, album].filter(Boolean).join(" ").trim();
  if (!text) return YANDEX_404_URL;

  return `${YANDEX_WEB_SEARCH_URL}?text=${encodeURIComponent(text)}`;
}

export { YANDEX_404_URL };