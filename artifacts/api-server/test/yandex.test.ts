import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import { mock, test } from "node:test";

process.env.DATABASE_URL ??= "postgres://localhost/yandex-tests";
process.env.SESSION_SECRET ??= "session-secret";
process.env.SPOTIFY_CLIENT_ID ??= "client-id";
process.env.SPOTIFY_CLIENT_SECRET ??= "client-secret";
process.env.SPOTIFY_REDIRECT_URI ??= "http://localhost/api/spotify/callback";

const { default: app } = await import("../src/app.ts");

type JsonResponse = {
  status: number;
  body: { url?: string };
};

async function startTestServer(): Promise<{
  server: Server;
  url: string;
}> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Test server did not receive an address");
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function requestTrack(
  baseUrl: string,
  query: Record<string, string>,
): Promise<JsonResponse> {
  const search = new URLSearchParams(query);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      `${baseUrl}/api/yandex/track?${search}`,
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              body: JSON.parse(body) as { url?: string },
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

async function closeTestServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("returns the URL for the exact title and artist match", async () => {
  const upstreamRequests: string[] = [];
  mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL) => {
      upstreamRequests.push(String(input));
      return new Response(
        JSON.stringify({
          result: {
            tracks: {
              results: [
                {
                  id: "wrong-track",
                  title: "Другая песня",
                  artists: [{ name: "Другой исполнитель" }],
                  albums: [{ id: "wrong-album" }],
                },
                {
                  id: 123,
                  title: "Моя Песня",
                  artists: [{ name: "Исполнитель" }],
                  albums: [{ id: 456 }],
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );

  const { server, url } = await startTestServer();
  try {
    const response = await requestTrack(url, {
      title: "Моя песня",
      artist: "Исполнитель",
      album: "Альбом",
    });

    assert.equal(response.status, 200);
    assert.equal(
      response.body.url,
      "https://music.yandex.ru/album/456/track/123",
    );
    assert.notEqual(response.body.url, "https://music.yandex.ru/404");
    assert.equal(upstreamRequests.length, 1);
    assert.match(upstreamRequests[0] ?? "", /text=/);
  } finally {
    await closeTestServer(server);
    mock.restoreAll();
  }
});

test("uses web search when the Yandex API is unavailable in the region", async () => {
  mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 451 }),
  );

  const title = `Rock & Roll "Live" / 夜の歌`;
  const artist = `AC/DC & “Север”`;
  const album = `Best / Лучшее & More`;
  const expectedText = `${title} ${artist} ${album}`;

  const { server, url } = await startTestServer();
  try {
    const response = await requestTrack(url, {
      title,
      artist,
      album,
    });

    assert.equal(response.status, 200);
    const searchUrl = new URL(response.body.url ?? "");
    assert.equal(searchUrl.origin + searchUrl.pathname, "https://music.yandex.ru/search");
    assert.deepEqual([...searchUrl.searchParams.keys()], ["text"]);
    assert.equal(searchUrl.searchParams.get("text"), expectedText);
    assert.notEqual(response.body.url, "https://music.yandex.ru/404");
  } finally {
    await closeTestServer(server);
    mock.restoreAll();
  }
});

test("uses web search when the API returns no usable track", async () => {
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({ result: { tracks: { results: [] } } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );

  const { server, url } = await startTestServer();
  try {
    const response = await requestTrack(url, {
      title: "Не найденный трек",
      artist: "Артист",
    });

    assert.equal(response.status, 200);
    assert.equal(
      new URL(response.body.url ?? "").searchParams.get("text"),
      "Не найденный трек Артист",
    );
    assert.match(response.body.url ?? "", /^https:\/\/music\.yandex\.ru\/search/);
    assert.notEqual(response.body.url, "https://music.yandex.ru/404");
  } finally {
    await closeTestServer(server);
    mock.restoreAll();
  }
});

test("returns 404 only when a required search parameter is empty", async () => {
  let upstreamRequests = 0;
  mock.method(
    globalThis,
    "fetch",
    async () => {
      upstreamRequests += 1;
      return new Response(null, { status: 500 });
    },
  );

  const { server, url } = await startTestServer();
  try {
    for (const query of [
      { title: "", artist: "Артист" },
      { title: "Трек", artist: "" },
      { title: "   ", artist: "Артист" },
      { title: "Трек", artist: "   " },
    ]) {
      const response = await requestTrack(url, query);
      assert.equal(response.status, 200);
      assert.equal(response.body.url, "https://music.yandex.ru/404");
    }

    assert.equal(upstreamRequests, 0);
  } finally {
    await closeTestServer(server);
    mock.restoreAll();
  }
});