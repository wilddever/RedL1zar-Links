import assert from "node:assert/strict";
import { once } from "node:events";
import { test, after } from "node:test";

process.env.DATABASE_URL ??= "postgres://localhost/spotify-tests";
process.env.SPOTIFY_CLIENT_ID = "client-id";
process.env.SPOTIFY_CLIENT_SECRET = "client-secret";
process.env.SPOTIFY_REDIRECT_URI = "http://localhost/api/spotify/callback";
process.env.SESSION_SECRET = "session-secret";
process.env.SPOTIFY_OWNER_TOKEN = "owner-token";

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
  const publicResponse = await fetch(`${baseUrl}/api/spotify/auth`, {
    redirect: "manual",
  });
  assert.equal(publicResponse.status, 403);

  const authorizationResponse = await fetch(`${baseUrl}/api/spotify/auth`, {
    redirect: "manual",
    headers: { "x-spotify-owner-token": "owner-token" },
  });
  assert.equal(authorizationResponse.status, 302);

  const authorizationUrl = new URL(
    authorizationResponse.headers.get("location") ?? "",
  );
  const state = authorizationUrl.searchParams.get("state");
  const setCookies =
    typeof authorizationResponse.headers.getSetCookie === "function"
      ? authorizationResponse.headers.getSetCookie()
      : [authorizationResponse.headers.get("set-cookie") ?? ""];
  const cookieHeader = setCookies
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
  assert.ok(state);
  assert.match(cookieHeader, /spotify_owner_session=/);
  assert.match(cookieHeader, /spotify_oauth_state=/);

  const repeatedAuthorizationResponse = await fetch(
    `${baseUrl}/api/spotify/auth`,
    {
      redirect: "manual",
      headers: { cookie: cookieHeader },
    },
  );
  assert.equal(repeatedAuthorizationResponse.status, 302);

  const cookieOnlyState = cookieHeader
    .split("; ")
    .filter((cookie) => cookie.startsWith("spotify_oauth_state="))
    .join("; ");

  const callbackWithoutOwnerSession = await fetch(
    `${baseUrl}/api/spotify/callback?state=${encodeURIComponent(state)}`,
    { headers: { cookie: cookieOnlyState } },
  );
  assert.equal(callbackWithoutOwnerSession.status, 403);

  const tamperedState = `${state.slice(0, -1)}${
    state.endsWith("0") ? "1" : "0"
  }`;

  const tamperedResponse = await fetch(
    `${baseUrl}/api/spotify/callback?state=${encodeURIComponent(tamperedState)}`,
    { headers: { cookie: cookieHeader } },
  );
  assert.equal(tamperedResponse.status, 400);
  assert.match(await tamperedResponse.text(), /state is invalid/i);

  const missingCookieResponse = await fetch(
    `${baseUrl}/api/spotify/callback?state=${encodeURIComponent(state)}`,
    {
      headers: {
        cookie: cookieHeader.replace(/spotify_oauth_state=[^; ]+;? ?/, ""),
      },
    },
  );
  assert.equal(missingCookieResponse.status, 400);
  assert.match(await missingCookieResponse.text(), /state is invalid/i);

  const wrongCookieResponse = await fetch(
    `${baseUrl}/api/spotify/callback?state=${encodeURIComponent(state)}`,
    {
      headers: {
        cookie: cookieHeader.replace(
          /spotify_oauth_state=[^; ]+/,
          "spotify_oauth_state=another-state",
        ),
      },
    },
  );

  const deniedResponse = await fetch(
    `${baseUrl}/api/spotify/callback?state=${encodeURIComponent(
      state,
    )}&error=access_denied`,
    {
      headers: { cookie: cookieHeader },
      redirect: "manual",
    },
  );
  const validStateResponse = await fetch(
    `${baseUrl}/api/spotify/callback?state=${encodeURIComponent(state)}`,
    { headers: { cookie: cookieHeader }, redirect: "manual" },
  );
  assert.equal(validStateResponse.status, 302);
  assert.equal(validStateResponse.headers.get("location"), "/?spotify=error");
});
