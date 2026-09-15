import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { getAllowedCorsOrigins } from "./lib/cors";

const app: Express = express();

app.set("trust proxy", true);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const configuredOrigins = getAllowedCorsOrigins();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, false);
        return;
      }
      callback(null, configuredOrigins.has(origin) ? origin : false);
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Spotify-Owner-Token"],
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const parserError = error as { type?: string };
  if (req.path === "/api/sign/cards" && parserError.type === "entity.parse.failed") {
    res.setHeader("Cache-Control", "no-store");
    res.status(400).json({ ok: false, message: "Нужен рисунок в формате PNG." });
    return;
  }
  if (req.path === "/api/sign/cards" && parserError.type === "entity.too.large") {
    res.setHeader("Cache-Control", "no-store");
    res
      .status(413)
      .json({ ok: false, message: "Рисунок слишком большой. Попробуйте сделать его проще." });
    return;
  }
  next(error);
});

app.use("/api", router);

export default app;
