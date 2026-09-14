import { Router, type IRouter } from "express";
import { GetCurrentSpotifyTrackResponse } from "@workspace/api-zod";
import {
  clearSpotifyStateCookie,
  completeSpotifyAuthorization,
  getCurrentSpotifyState,
  getAllowedSpotifyImageUrl,
  getSpotifyAuthorizationUrl,
  getSpotifyNotConfiguredState,
  getSpotifyStateCookie,
  authorizeSpotifyOwner,
  isSpotifyOwner,
  isSpotifyConfigured,
  validateSpotifyCallback,
} from "../lib/spotify";

const router: IRouter = Router();

router.get("/spotify/auth", (req, res) => {
  if (!authorizeSpotifyOwner(req)) {
    res
      .status(403)
      .send("Spotify authorization is restricted to the page owner.");
    return;
  }

  const authorizationUrl = getSpotifyAuthorizationUrl(req);
  if (!authorizationUrl) {
    res.status(503).json(getSpotifyNotConfiguredState());
    return;
  }
  res.redirect(authorizationUrl);
});

router.post("/spotify/owner-session", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!authorizeSpotifyOwner(req)) {
    res.status(403).json({ ok: false, message: "Неверный owner token." });
    return;
  }

  res.json({ ok: true });
});

router.get("/spotify/callback", async (req, res) => {
  if (!isSpotifyOwner(req)) {
    res
      .status(403)
      .send("Spotify authorization is restricted to the page owner.");
    return;
  }

  if (!isSpotifyConfigured()) {
    res.status(503).send("Spotify is not configured on the server.");
    return;
  }

  const state = typeof req.query.state === "string" ? req.query.state : null;
  if (!validateSpotifyCallback(req, state) || state !== getSpotifyStateCookie(req)) {
    clearSpotifyStateCookie(req);
    res.status(400).send("Spotify authorization state is invalid.");
    return;
  }

  clearSpotifyStateCookie(req);
  if (typeof req.query.error === "string") {
    res.redirect("/?spotify=denied");
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : null;
  if (!code) {
    res.redirect("/?spotify=error");
    return;
  }

  try {
    await completeSpotifyAuthorization(code);
    res.redirect("/?spotify=connected");
  } catch (error) {
    req.log.error({ err: error }, "Spotify authorization exchange failed");
    res.redirect("/?spotify=error");
  }
});

router.get("/spotify/currently-playing", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const state = await getCurrentSpotifyState();
    res.json(GetCurrentSpotifyTrackResponse.parse(state));
  } catch (error) {
    req.log.warn({ err: error }, "Spotify playback request failed");
    res.json(
      GetCurrentSpotifyTrackResponse.parse({
        status: "unavailable",
        track: null,
        message: "Spotify временно недоступен",
      }),
    );
  }
});

router.get("/spotify/cover", async (req, res) => {
  const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
  const imageUrl = getAllowedSpotifyImageUrl(rawUrl);
  if (!imageUrl) {
    res.status(400).json({ message: "Недопустимый адрес обложки Spotify." });
    return;
  }

  try {
    const upstream = await fetch(imageUrl, {
      headers: { Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });

    if (!upstream.ok) {
      res.status(upstream.status === 404 ? 404 : 502).end();
      return;
    }

    const resolvedUrl = getAllowedSpotifyImageUrl(upstream.url);
    const contentType = upstream.headers.get("content-type")?.split(";")[0];
    const contentLength = Number(upstream.headers.get("content-length") ?? "0");
    if (
      !resolvedUrl ||
      !contentType?.startsWith("image/") ||
      (contentLength > 5 * 1024 * 1024)
    ) {
      res.status(502).end();
      return;
    }

    const image = Buffer.from(await upstream.arrayBuffer());
    if (image.byteLength > 5 * 1024 * 1024) {
      res.status(502).end();
      return;
    }

    res
      .status(200)
      .set({
        "Cache-Control":
          "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800, stale-if-error=86400",
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      })
      .send(image);
  } catch (error) {
    req.log.warn({ err: error }, "Spotify cover proxy request failed");
    res.status(502).end();
  }
});

export default router;
