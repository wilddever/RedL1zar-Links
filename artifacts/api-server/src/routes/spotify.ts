import { Router, type IRouter } from "express";
import { GetCurrentSpotifyTrackResponse } from "@workspace/api-zod";
import {
  clearSpotifyStateCookie,
  completeSpotifyAuthorization,
  getCurrentSpotifyState,
  getSpotifyAuthorizationUrl,
  getSpotifyNotConfiguredState,
  getSpotifyStateCookie,
  isSpotifyConfigured,
  validateSpotifyCallback,
} from "../lib/spotify";

const router: IRouter = Router();

router.get("/spotify/auth", (req, res) => {
  const authorizationUrl = getSpotifyAuthorizationUrl(req);
  if (!authorizationUrl) {
    res.status(503).json(getSpotifyNotConfiguredState());
    return;
  }
  res.redirect(authorizationUrl);
});

router.get("/spotify/callback", async (req, res) => {
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
    res.status(400).send("Spotify authorization was not completed.");
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : null;
  if (!code) {
    res.status(400).send("Spotify did not return an authorization code.");
    return;
  }

  try {
    await completeSpotifyAuthorization(code);
    res.redirect("/");
  } catch (error) {
    req.log.error({ err: error }, "Spotify authorization exchange failed");
    res
      .status(502)
      .send("Spotify authorization could not be completed. Please try again.");
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

export default router;