const STEAM_PROFILE_URL = "https://steamcommunity.com/id/RedL1zar?xml=1";

type SteamGame = {
  name: string;
  appId: string | null;
  steamUrl: string;
  imageUrl: string | null;
};

export type SteamCurrentlyPlaying = {
  status: "playing" | "not_playing" | "unavailable";
  game: SteamGame | null;
  message: string;
};

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    );
}

function extractTag(source: string, tagName: string): string {
  const expression = new RegExp(
    `<${tagName}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tagName}>`,
    "i",
  );
  const match = source.match(expression);
  return decodeXml((match?.[1] ?? match?.[2] ?? "").trim());
}

function unavailableState(): SteamCurrentlyPlaying {
  return {
    status: "unavailable",
    game: null,
    message: "Steam временно недоступен",
  };
}

export async function getCurrentSteamState(): Promise<SteamCurrentlyPlaying> {
  try {
    const response = await fetch(STEAM_PROFILE_URL, {
      headers: {
        Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "RedL1zar personal links",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return unavailableState();

    const xml = await response.text();
    const currentGame = extractTag(xml, "currentGame");
    const name = extractTag(currentGame, "gameName");
    if (!name) {
      return {
        status: "not_playing",
        game: null,
        message: "В Steam ничего не запущено",
      };
    }

    const gameLink = extractTag(currentGame, "gameLink");
    const appId = gameLink.match(/\/app\/(\d+)/i)?.[1] ?? null;
    const steamUrl =
      gameLink ||
      (appId ? `https://store.steampowered.com/app/${appId}/` : "https://store.steampowered.com/");
    const imageUrl =
      extractTag(currentGame, "gameIcon") ||
      extractTag(currentGame, "gameLogoSmall") ||
      null;

    return {
      status: "playing",
      game: { name, appId, steamUrl, imageUrl },
      message: "Сейчас играет в Steam",
    };
  } catch {
    return unavailableState();
  }
}