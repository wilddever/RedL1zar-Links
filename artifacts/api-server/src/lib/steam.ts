const STEAM_PROFILE_URL = "https://steamcommunity.com/id/RedL1zar?xml=1";
const STEAM_PROFILE_HTML_URL = "https://steamcommunity.com/id/RedL1zar";

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

function extractHtmlGameName(source: string): string {
  const match = source.match(
    /<div[^>]*class="profile_in_game_name"[^>]*>([\s\S]*?)<\/div>/i,
  );
  return decodeXml((match?.[1] ?? "").replace(/<[^>]+>/g, "").trim());
}

function findMostPlayedGameXml(xml: string, name: string): string {
  const blocks = xml.match(/<mostPlayedGame>[\s\S]*?<\/mostPlayedGame>/gi) ?? [];
  return (
    blocks.find(
      (block) => extractTag(block, "gameName").toLocaleLowerCase() === name.toLocaleLowerCase(),
    ) ?? ""
  );
}

function createGame(name: string, source: string): SteamGame {
  const gameLink = extractTag(source, "gameLink");
  const appId = gameLink.match(/\/app\/(\d+)/i)?.[1] ?? null;
  const steamUrl =
    gameLink ||
    (appId
      ? `https://store.steampowered.com/app/${appId}/`
      : `https://store.steampowered.com/search/?term=${encodeURIComponent(name)}`);
  const imageUrl =
    extractTag(source, "gameIcon") ||
    extractTag(source, "gameLogoSmall") ||
    null;

  return { name, appId, steamUrl, imageUrl };
}

function unavailableState(): SteamCurrentlyPlaying {
  return {
    status: "unavailable",
    game: null,
    message: "Steam временно недоступен",
  };
}

export async function getCurrentSteamState(): Promise<SteamCurrentlyPlaying> {
  let xml = "";
  let xmlAvailable = false;
  try {
    const response = await fetch(STEAM_PROFILE_URL, {
      headers: {
        Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "RedL1zar personal links",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) {
      xml = await response.text();
      xmlAvailable = true;
    }
  } catch {
    // The HTML profile below is a second, independent source.
  }

  if (xmlAvailable) {
    const currentGame = extractTag(xml, "currentGame");
    const name = extractTag(currentGame, "gameName");
    if (name) {
      return {
        status: "playing",
        game: createGame(name, currentGame),
        message: "Сейчас играет в Steam",
      };
    }
  }

  let htmlAvailable = false;
  try {
    const response = await fetch(STEAM_PROFILE_HTML_URL, {
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 RedL1zar personal links",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) {
      const html = await response.text();
      htmlAvailable = true;
      const name = extractHtmlGameName(html);
      if (name) {
        return {
          status: "playing",
          game: createGame(name, findMostPlayedGameXml(xml, name)),
          message: "Сейчас играет в Steam",
        };
      }
    }
  } catch {
    // Fall through to a stable status below.
  }

  if (!xmlAvailable && !htmlAvailable) return unavailableState();
  return {
    status: "not_playing",
    game: null,
    message: "В Steam ничего не запущено",
  };
}