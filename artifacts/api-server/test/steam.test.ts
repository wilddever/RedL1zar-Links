import assert from "node:assert/strict";
import { mock, test } from "node:test";

const { getCurrentSteamState } = await import("../src/lib/steam.ts");

const xmlProfileWithoutCurrentGame = `<?xml version="1.0"?>
<profile>
  <mostPlayedGames>
    <mostPlayedGame>
      <gameName>Deep Rock Galactic</gameName>
      <gameLink>https://store.steampowered.com/app/548430/</gameLink>
      <gameIcon>https://cdn.example.com/deep-rock.png</gameIcon>
    </mostPlayedGame>
  </mostPlayedGames>
</profile>`;

test("uses the HTML active-game fallback and enriches it from matching XML data", async () => {
  const requests: string[] = [];
  mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);

      if (url.includes("?xml=1")) {
        return new Response(xmlProfileWithoutCurrentGame, { status: 200 });
      }

      return new Response(
        `<div data-testid="profile" class="profile_header">
          <div class="profile_in_game_name extra_class">
            <a>Deep Rock Galactic</a>
          </div>
        </div>`,
        { status: 200 },
      );
    },
  );

  try {
    assert.deepEqual(await getCurrentSteamState(), {
      status: "playing",
      game: {
        name: "Deep Rock Galactic",
        appId: "548430",
        steamUrl: "https://store.steampowered.com/app/548430/",
        imageUrl: "https://cdn.example.com/deep-rock.png",
      },
      message: "Сейчас играет в Steam",
    });
    assert.deepEqual(requests, [
      "https://steamcommunity.com/id/RedL1zar?xml=1",
      "https://steamcommunity.com/id/RedL1zar",
    ]);
  } finally {
    mock.restoreAll();
  }
});

test("returns not_playing when both Steam profiles are available without an active game", async () => {
  mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL) => {
      if (String(input).includes("?xml=1")) {
        return new Response("<profile><mostPlayedGames /></profile>", {
          status: 200,
        });
      }

      return new Response(
        '<div class="profile_summary"><span>Offline</span></div>',
        { status: 200 },
      );
    },
  );

  try {
    assert.deepEqual(await getCurrentSteamState(), {
      status: "not_playing",
      game: null,
      message: "В Steam ничего не запущено",
    });
  } finally {
    mock.restoreAll();
  }
});

test("keeps the last confirmed game when one Steam profile is unavailable", async () => {
  let requestNumber = 0;
  mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL) => {
      const url = String(input);
      requestNumber += 1;

      if (url.includes("?xml=1")) {
        if (requestNumber === 1) {
          return new Response(
            `<profile>
              <currentGame>
                <gameName>Deep Rock Galactic</gameName>
                <gameLink>https://store.steampowered.com/app/548430/</gameLink>
              </currentGame>
            </profile>`,
            { status: 200 },
          );
        }
        throw new Error("Steam XML unavailable");
      }

      return new Response('<div class="profile_summary"><span>Offline</span></div>', {
        status: 200,
      });
    },
  );

  try {
    assert.deepEqual(await getCurrentSteamState(), {
      status: "playing",
      game: {
        name: "Deep Rock Galactic",
        appId: "548430",
        steamUrl: "https://store.steampowered.com/app/548430/",
        imageUrl: null,
      },
      message: "Сейчас играет в Steam",
    });
    assert.deepEqual(await getCurrentSteamState(), {
      status: "unavailable",
      game: {
        name: "Deep Rock Galactic",
        appId: "548430",
        steamUrl: "https://store.steampowered.com/app/548430/",
        imageUrl: null,
      },
      message: "Steam временно недоступен",
    });
  } finally {
    mock.restoreAll();
  }
});

test("returns to not_playing after both Steam profiles recover", async () => {
  let xmlRequestNumber = 0;
  mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("?xml=1")) {
        xmlRequestNumber += 1;
        if (xmlRequestNumber === 1) {
          return new Response(
            `<profile>
              <currentGame>
                <gameName>Deep Rock Galactic</gameName>
                <gameLink>https://store.steampowered.com/app/548430/</gameLink>
              </currentGame>
            </profile>`,
            { status: 200 },
          );
        }
        if (xmlRequestNumber === 2) {
          throw new Error("Steam XML unavailable");
        }
        return new Response("<profile><mostPlayedGames /></profile>", {
          status: 200,
        });
      }

      return new Response('<div class="profile_summary"><span>Offline</span></div>', {
        status: 200,
      });
    },
  );

  try {
    assert.equal((await getCurrentSteamState()).status, "playing");
    assert.deepEqual(await getCurrentSteamState(), {
      status: "unavailable",
      game: {
        name: "Deep Rock Galactic",
        appId: "548430",
        steamUrl: "https://store.steampowered.com/app/548430/",
        imageUrl: null,
      },
      message: "Steam временно недоступен",
    });
    assert.deepEqual(await getCurrentSteamState(), {
      status: "not_playing",
      game: null,
      message: "В Steam ничего не запущено",
    });
  } finally {
    mock.restoreAll();
  }
});

test("does not infer not_playing when the HTML profile is unavailable", async () => {
  mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("?xml=1")) {
        return new Response("<profile><mostPlayedGames /></profile>", {
          status: 200,
        });
      }

      throw new Error("Steam HTML unavailable");
    },
  );

  try {
    assert.deepEqual(await getCurrentSteamState(), {
      status: "unavailable",
      game: null,
      message: "Steam временно недоступен",
    });
  } finally {
    mock.restoreAll();
  }
});

test("returns to playing when a recovered Steam source reports a game", async () => {
  let xmlRequestNumber = 0;
  mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("?xml=1")) {
        xmlRequestNumber += 1;
        if (xmlRequestNumber === 1) {
          throw new Error("Steam XML unavailable");
        }
        if (xmlRequestNumber === 3) {
          return new Response("<profile><mostPlayedGames /></profile>", {
            status: 200,
          });
        }
        return new Response(
          `<profile>
            <currentGame>
              <gameName>Slay the Spire</gameName>
            </currentGame>
          </profile>`,
          { status: 200 },
        );
      }

      return new Response('<div class="profile_summary"><span>Offline</span></div>', {
        status: 200,
      });
    },
  );

  try {
    assert.equal((await getCurrentSteamState()).status, "unavailable");
    assert.deepEqual(await getCurrentSteamState(), {
      status: "playing",
      game: {
        name: "Slay the Spire",
        appId: null,
        steamUrl: "https://store.steampowered.com/search/?term=Slay%20the%20Spire",
        imageUrl: null,
      },
      message: "Сейчас играет в Steam",
    });
    assert.equal((await getCurrentSteamState()).status, "not_playing");
  } finally {
    mock.restoreAll();
  }
});

test("does not infer not_playing from incomplete successful Steam responses", async () => {
  mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL) => {
      if (String(input).includes("?xml=1")) {
        return new Response("", { status: 200 });
      }

      return new Response("<div />", { status: 200 });
    },
  );

  try {
    assert.deepEqual(await getCurrentSteamState(), {
      status: "unavailable",
      game: null,
      message: "Steam временно недоступен",
    });
  } finally {
    mock.restoreAll();
  }
});