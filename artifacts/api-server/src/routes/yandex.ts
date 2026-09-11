import { Router, type IRouter } from "express";
import {
  findYandexTrack,
  getYandexSearchUrl,
  YANDEX_404_URL,
} from "../lib/yandex";

const router: IRouter = Router();

router.get("/yandex/track", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
  const artist =
    typeof req.query.artist === "string" ? req.query.artist.trim() : "";
  const album = typeof req.query.album === "string" ? req.query.album.trim() : "";

  if (!title || !artist) {
    res.json({ url: YANDEX_404_URL });
    return;
  }

  const match = await findYandexTrack(title, artist, album);
  res.json(match ?? { url: getYandexSearchUrl(title, artist, album) });
});

export default router;