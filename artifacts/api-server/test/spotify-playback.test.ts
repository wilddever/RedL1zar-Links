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

test("normalizes playing, paused and idle states and backs off after 429", async () => {
  let playbackRequests = 0;

  mock.method(db as any, "select", () => ({
    from: () => ({
      where: () => ({
        limit: async () => [{ id: 1, refreshToken: "refresh-token" }],
      }),
    }),
  }));
  mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL) => {
      if (String(input) === "https://accounts.spotify.com/api/token") {
        return new Response(
          JSON.stringify({
            access_token: "access-token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      playbackRequests += 1;
      if (playbackRequests === 1) {
        return new Response(
          JSON.stringify({
            is_playing: true,
            item: {
              name: "Playing Track",
              artists: [{ name: "Artist One" }, { name: "Artist Two" }],
              album: {
                name: "Album One",
                images: [{ url: "https://example.com/playing.jpg" }],
              },
              external_urls: {
                spotify: "https://open.spotify.com/track/playing",
              },
            },
          }),
          { status: 200 },
        );
      }
      if (playbackRequests === 2) {
        return new Response(
          JSON.stringify({
            is_playing: false,
            item: {
              name: "Paused Track",
              artists: [{ name: "Paused Artist" }],
              album: { name: "Paused Album" },
              external_urls: {
                spotify: "https://open.spotify.com/track/paused",
              },
            },
          }),
          { status: 200 },
        );
      }
      if (playbackRequests === 3) {
        return new Response(null, { status: 204 });
      }
      return new Response(null, {
        status: 429,
        headers: { "retry-after": "10" },
      });
    },
  );

  try {
    assert.deepEqual(await spotify.getCurrentSpotifyState(), {
      status: "playing",
      track: {
        title: "Playing Track",
        artist: "Artist One, Artist Two",
        album: "Album One",
        imageUrl: "https://example.com/playing.jpg",
        spotifyUrl: "https://open.spotify.com/track/playing",
      },
      message: "Сейчас играет",
    });
    assert.deepEqual(await spotify.getCurrentSpotifyState(), {
      status: "paused",
      track: {
        title: "Paused Track",
        artist: "Paused Artist",
        album: "Paused Album",
        imageUrl: "",
        spotifyUrl: "https://open.spotify.com/track/paused",
      },
      message: "На паузе",
    });
    assert.deepEqual(await spotify.getCurrentSpotifyState(), {
      status: "idle",
      track: null,
      message: "Сейчас ничего не играет",
    });
    assert.deepEqual(await spotify.getCurrentSpotifyState(), {
      status: "unavailable",
      track: null,
      message: "Spotify временно недоступен",
    });

    const requestsBeforeBackoffCheck = playbackRequests;
    assert.deepEqual(await spotify.getCurrentSpotifyState(), {
      status: "unavailable",
      track: null,
      message: "Spotify временно недоступен",
    });
    assert.equal(playbackRequests, requestsBeforeBackoffCheck);
  } finally {
    mock.restoreAll();
  }
});