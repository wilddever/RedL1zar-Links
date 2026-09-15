import { Router, type IRouter } from "express";
import healthRouter from "./health";
import messagesRouter from "./messages";
import spotifyRouter from "./spotify";
import steamRouter from "./steam";
import yandexRouter from "./yandex";
import signRouter from "./sign";

const router: IRouter = Router();

router.use(healthRouter);
router.use(messagesRouter);
router.use(spotifyRouter);
router.use(steamRouter);
router.use(yandexRouter);
router.use(signRouter);

export default router;
