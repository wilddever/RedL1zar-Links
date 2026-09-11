import assert from "node:assert/strict";
import { mock, test } from "node:test";

process.env.DATABASE_URL ??= "postgres://localhost/spotify-tests";
process.env.SPOTIFY_CLIENT_ID = "client-id";
process.env.SPOTIFY_CLIENT_SECRET = "client-secret";
process.env.SPOTIFY_REDIRECT_URI = "http://localhost/api/spotify/callback";
process.env.SESSION_SECRET = "session-secret";

const [{ db }, spotify] = await Promise.all([
  import("@workspace/db"),
  import("../src/lib/spotify.ts"),
]);

const tokenResponse = (accessToken: string, refreshToken?: string) =>
  new Response(
    JSON.stringify({
      access_token: accessToken,
      expires_in: 3600,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

test("rotates the refresh token and retries playback after a 401", async () => {
  const storedRefreshToken = "refresh-old";
  const insertedRefreshTokens: string[] = [];
  let playbackRequests = 0;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  mock.method(db as any, "select", () => ({
    from: () => ({
      where: () => ({
        limit: async () => [{ id: 1, refreshToken: storedRefreshToken }],
      }),
    }),
  }));
  mock.method(db as any, "insert", () => ({
    values: (values: { refreshToken: string }) => {
      insertedRefreshTokens.push(values.refreshToken);
      return { onConflictDoUpdate: async () => undefined };
    },
  }));
  mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });

      if (url === "https://accounts.spotify.com/api/token") {
        return tokenResponse(
          requests.filter(
            ({ url: requestUrl }) =>
              requestUrl === "https://accounts.spotify.com/api/token",
          ).length === 1
            ? "access-before-retry"
            : "access-after-retry",
          requests.filter(
            ({ url: requestUrl }) =>
              requestUrl === "https://accounts.spotify.com/api/token",
          ).length === 1
            ? "refresh-new"
            : undefined,
        );
      }

      playbackRequests += 1;
      if (playbackRequests === 1) {
        return new Response(null, { status: 401 });
      }

      return new Response(
        JSON.stringify({
          is_playing: true,
          item: {
            name: "After 401",
            artists: [{ name: "Test Artist" }],
            album: {
              name: "Test Album",
              images: [{ url: "https://example.com/album.jpg" }],
            },
            external_urls: { spotify: "https://open.spotify.com/track/test" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );

  try {
    const state = await spotify.getCurrentSpotifyState();

    assert.deepEqual(state, {
      status: "playing",
      track: {
        title: "After 401",
        artist: "Test Artist",
        album: "Test Album",
        imageUrl: "https://example.com/album.jpg",
        spotifyUrl: "https://open.spotify.com/track/test",
      },
      message: "Сейчас играет",
    });
    assert.equal(playbackRequests, 2);
    assert.deepEqual(insertedRefreshTokens, ["refresh-new"]);

    const tokenRequests = requests.filter(
      ({ url }) => url === "https://accounts.spotify.com/api/token",
    );
    assert.equal(tokenRequests.length, 2);
    assert.match(String(tokenRequests[0]?.init?.body), /refresh_token=refresh-old/);
    assert.match(String(tokenRequests[1]?.init?.body), /refresh_token=refresh-old/);
  } finally {
    mock.restoreAll();
  }
});