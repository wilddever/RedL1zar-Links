import { Router, type IRouter } from "express";
import { getCurrentSteamState } from "../lib/steam";

const router: IRouter = Router();

router.get("/steam/currently-playing", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await getCurrentSteamState());
});

export default router;