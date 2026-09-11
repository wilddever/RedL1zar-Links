import { Router, type IRouter } from "express";
import healthRouter from "./health";
import spotifyRouter from "./spotify";

const router: IRouter = Router();

router.use(healthRouter);
router.use(spotifyRouter);

export default router;
