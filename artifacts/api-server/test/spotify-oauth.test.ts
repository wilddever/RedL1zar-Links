import assert from "node:assert/strict";
import { once } from "node:events";
import { test, after } from "node:test";

process.env.DATABASE_URL ??= "postgres://localhost/spotify-tests";
process.env.SPOTIFY_CLIENT_ID = "client-id";
process.env.SPOTIFY_CLIENT_SECRET = "client-secret";
process.env.SPOTIFY_REDIRECT_URI = "http://localhost/api/spotify/callback";
process.env.SESSION_SECRET = "session-secret";

const { default: app } = await import("../src/app.ts");
const server = app.listen(0);
await once(server, "listening");
after(() => server.close());

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("OAuth test server did not bind to a TCP port");
}
const baseUrl = `http://127.0.0.1:${address.port}`;

test("Spotify callback requires a valid HMAC state and matching cookie", async () => {
  const authorizationResponse = await fetch(`${baseUrl}/api/spotify/auth`, {
    redirect: "manual",
  });
  assert.equal(authorizationResponse.status, 302);

  const authorizationUrl = new URL(
    authorizationResponse.headers.get("location") ?? "",
  );
  const state = authorizationUrl.searchParams.get("state");
  const setCookie = authorizationResponse.headers.get("set-cookie");
  assert.ok(state);
  assert.ok(setCookie);

  const cookiePair = setCookie.split(";", 1)[0];
  const tamperedState = `${state.slice(0, -1)}${
    state.endsWith("0") ? "1" : "0"
  }`;

  const tamperedResponse = await fetch(
    `${baseUrl}/api/spotify/callback?state=${encodeURIComponent(tamperedState)}`,
    { headers: { cookie: cookiePair } },
  );
  assert.equal(tamperedResponse.status, 400);
  assert.match(await tamperedResponse.text(), /state is invalid/i);

  const missingCookieResponse = await fetch(
    `${baseUrl}/api/spotify/callback?state=${encodeURIComponent(state)}`,
  );
  assert.equal(missingCookieResponse.status, 400);
  assert.match(await missingCookieResponse.text(), /state is invalid/i);

  const wrongCookieResponse = await fetch(
    `${baseUrl}/api/spotify/callback?state=${encodeURIComponent(state)}`,
    { headers: { cookie: "spotify_oauth_state=another-state" } },
  );
  assert.equal(wrongCookieResponse.status, 400);
  assert.match(await wrongCookieResponse.text(), /state is invalid/i);

  const validStateResponse = await fetch(
    `${baseUrl}/api/spotify/callback?state=${encodeURIComponent(state)}`,
    { headers: { cookie: cookiePair } },
  );
  assert.equal(validStateResponse.status, 400);
  assert.match(await validStateResponse.text(), /authorization code/i);
});