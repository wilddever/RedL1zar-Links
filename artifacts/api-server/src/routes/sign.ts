import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import express, { Router, type IRouter } from "express";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import {
  db,
  signNotificationsTable,
  signRateLimitsTable,
  signSubmissionsTable,
} from "@workspace/db";
import {
  deleteSignImage,
  getSignImagePath,
  readSignImage,
  saveSignImage,
} from "../lib/objectStorage";

const router: IRouter = Router();
const MAX_NICKNAME_LENGTH = 48;
const MAX_IMAGE_BYTES = 600_000;
const WALL_LIMIT = 120;
const RATE_LIMIT_MS = 60 * 60 * 1_000;
const NOTIFICATION_RETRY_DELAYS_MS = [0, 1_000, 5_000];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type SignAction = "approve" | "reject" | "delete";

function noStore(res: express.Response) {
  res.setHeader("Cache-Control", "no-store");
}

function isPng(bytes: Buffer): boolean {
  return (
    bytes.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  );
}

function getRequestOrigin(req: express.Request): string {
  const host = req.get("host");
  if (!host) throw new Error("Request host is unavailable.");
  return `${req.protocol}://${host}`;
}

function getImageUrl(req: express.Request, id: string, cacheVersion?: Date) {
  const imageUrl = new URL("/api/sign/image", getRequestOrigin(req));
  imageUrl.searchParams.set("id", id);
  if (cacheVersion) imageUrl.searchParams.set("v", cacheVersion.toISOString());
  return imageUrl.toString();
}

function getModerationUrl(
  req: express.Request,
  id: string,
  action: SignAction,
  token: string,
) {
  const moderationUrl = new URL("/api/sign/moderate", getRequestOrigin(req));
  moderationUrl.searchParams.set("id", id);
  moderationUrl.searchParams.set("action", action);
  moderationUrl.searchParams.set("token", token);
  return moderationUrl.toString();
}

function getRedirectOrigin(): string {
  return process.env.PUBLIC_APP_ORIGIN?.trim() || "https://xn--d1ax3b.fun";
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

function createModerationToken(secret: string, id: string, action: SignAction) {
  return createHmac("sha256", secret)
    .update(`sign-moderate:${id}:${action}`)
    .digest("hex");
}

function validModerationToken(
  secret: string,
  id: string,
  action: SignAction,
  token: unknown,
): boolean {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return false;
  const expected = Buffer.from(createModerationToken(secret, id, action));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function redirectToApp(res: express.Response, query: string) {
  res.redirect(new URL(`/?sign=${query}#sign`, getRedirectOrigin()).toString());
}

async function telegramRequest(
  token: string,
  method: string,
  init: RequestInit,
): Promise<boolean> {
  const response = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`,
    { ...init, signal: AbortSignal.timeout(method === "sendPhoto" ? 15_000 : 8_000) },
  );
  if (!response.ok) return false;
  const payload = (await response.json().catch(() => null)) as { ok?: boolean } | null;
  return payload?.ok === true;
}

async function sendModerationPhoto(
  token: string,
  chatId: string,
  bytes: Buffer,
  caption: string,
): Promise<boolean> {
  const body = new FormData();
  body.append("chat_id", chatId);
  body.append("caption", caption);
  body.append(
    "photo",
    new Blob([bytes as unknown as ArrayBuffer], { type: "image/png" }),
    "sign-card.png",
  );
  return telegramRequest(token, "sendPhoto", { method: "POST", body });
}

async function sendDeletionNotice(
  token: string,
  chatId: string,
  nickname: string,
  deleteUrl: string,
): Promise<boolean> {
  return telegramRequest(token, "sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `Сигна ${nickname} опубликована на стене.`,
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: "Удалить со стены", url: deleteUrl }]],
      },
    }),
  });
}

async function retryNotification(operation: () => Promise<boolean>) {
  for (const delay of NOTIFICATION_RETRY_DELAYS_MS) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      if (await operation()) return true;
    } catch {
      // A failed notification is persisted and can be retried by requestId.
    }
  }
  return false;
}

async function recordNotificationAttempt(
  submissionId: string,
  delivered: boolean,
): Promise<void> {
  await db
    .update(signNotificationsTable)
    .set({
      attempts: sql`${signNotificationsTable.attempts} + 1`,
      lastAttemptAt: new Date(),
      ...(delivered ? { delivered: true, deliveredAt: new Date() } : {}),
    })
    .where(eq(signNotificationsTable.submissionId, submissionId));
}

async function notifyPending(
  req: express.Request,
  submission: {
    id: string;
    nickname: string;
    imagePath: string;
  },
  sessionSecret: string,
  botToken: string,
  chatId: string,
): Promise<boolean> {
  const bytes = await readSignImage(submission.imagePath);
  const caption = [
    "Новая sign-карточка RedL1zar",
    `Ник: ${submission.nickname}`,
    "",
    `APPROVE: ${getModerationUrl(
      req,
      submission.id,
      "approve",
      createModerationToken(sessionSecret, submission.id, "approve"),
    )}`,
    `REJECT: ${getModerationUrl(
      req,
      submission.id,
      "reject",
      createModerationToken(sessionSecret, submission.id, "reject"),
    )}`,
  ].join("\n");
  const delivered = await retryNotification(() =>
    sendModerationPhoto(botToken, chatId, bytes, caption),
  );
  await recordNotificationAttempt(submission.id, delivered);
  return delivered;
}

function parseSubmissionInput(req: express.Request): {
  nickname: string;
  requestId: string;
  bytes: Buffer;
  error?: { message: string; status: number };
} {
  const contentType = req.get("content-type")?.split(";", 1)[0].trim();
  let nickname = "";
  let requestId = (typeof req.query.requestId === "string" ? req.query.requestId : "").trim();
  let bytes: Buffer;

  if (contentType === "image/png") {
    nickname = (typeof req.query.nickname === "string" ? req.query.nickname : "").trim();
    bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? []);
  } else {
    const body = req.body as
      | { nickname?: unknown; image?: unknown; requestId?: unknown }
      | undefined;
    nickname = typeof body?.nickname === "string" ? body.nickname.trim() : "";
    requestId = typeof body?.requestId === "string" ? body.requestId.trim() : requestId;
    const image = typeof body?.image === "string" ? body.image : "";
    const match = image.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      return { nickname, requestId, bytes: Buffer.alloc(0), error: { message: "Нужен рисунок в формате PNG.", status: 400 } };
    }
    try {
      bytes = Buffer.from(match[1], "base64");
    } catch {
      return { nickname, requestId, bytes: Buffer.alloc(0), error: { message: "Рисунок повреждён.", status: 400 } };
    }
  }

  if (
    !nickname ||
    nickname.length > MAX_NICKNAME_LENGTH ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(nickname)
  ) {
    return {
      nickname,
      requestId,
      bytes,
      error: {
        message: `Ник должен содержать от 1 до ${MAX_NICKNAME_LENGTH} символов.`,
        status: 400,
      },
    };
  }
  if (requestId && !/^[a-f0-9]{32}$/.test(requestId)) {
    return {
      nickname,
      requestId,
      bytes,
      error: { message: "Некорректный идентификатор заявки.", status: 400 },
    };
  }
  if (!isPng(bytes)) {
    return {
      nickname,
      requestId,
      bytes,
      error: { message: "Нужен корректный PNG-файл.", status: 400 },
    };
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return {
      nickname,
      requestId,
      bytes,
      error: {
        message: "Рисунок слишком большой. Попробуйте сделать его проще.",
        status: 413,
      },
    };
  }
  return { nickname, requestId, bytes };
}

router.get("/sign/wall", async (req, res): Promise<void> => {
  noStore(res);
  const cards = await db
    .select({
      id: signSubmissionsTable.id,
      nickname: signSubmissionsTable.nickname,
      createdAt: signSubmissionsTable.createdAt,
    })
    .from(signSubmissionsTable)
    .where(eq(signSubmissionsTable.status, "approved"))
    .orderBy(desc(signSubmissionsTable.createdAt))
    .limit(WALL_LIMIT);
  res.json({
    cards: cards.map((card) => ({
      id: card.id,
      nickname: card.nickname,
      createdAt: card.createdAt.toISOString(),
      imageUrl: getImageUrl(req, card.id, card.createdAt),
    })),
  });
});

router.get("/sign/image", async (req, res): Promise<void> => {
  const id = typeof req.query.id === "string" ? req.query.id.trim() : "";
  if (!/^[a-f0-9]{32}$/.test(id)) {
    res.status(404).type("text").send("Not found");
    return;
  }
  const [submission] = await db
    .select()
    .from(signSubmissionsTable)
    .where(and(eq(signSubmissionsTable.id, id), eq(signSubmissionsTable.status, "approved")))
    .limit(1);
  if (!submission) {
    res.status(404).type("text").send("Not found");
    return;
  }
  try {
    const bytes = await readSignImage(submission.imagePath);
    res.setHeader(
      "Cache-Control",
      "public, max-age=60, s-maxage=300, stale-while-revalidate=300, stale-if-error=60",
    );
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `inline; filename="sign-${id}.png"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
  } catch {
    res.status(404).type("text").send("Not found");
  }
});

router.post(
  "/sign/cards",
  express.raw({ type: "image/png", limit: "1mb" }),
  async (req, res): Promise<void> => {
    noStore(res);
    const parsed = parseSubmissionInput(req);
    if (parsed.error) {
      res.status(parsed.error.status).json({ ok: false, message: parsed.error.message });
      return;
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
    const sessionSecret = process.env.SESSION_SECRET?.trim();
    if (!botToken || !chatId || !sessionSecret) {
      res.status(503).json({ ok: false, message: "Модерация пока не подключена." });
      return;
    }

    const { nickname, requestId, bytes } = parsed;
    if (requestId) {
      const [existing] = await db
        .select()
        .from(signSubmissionsTable)
        .where(eq(signSubmissionsTable.requestId, requestId))
        .limit(1);
      if (existing) {
        const [notification] = await db
          .select()
          .from(signNotificationsTable)
          .where(eq(signNotificationsTable.submissionId, existing.id))
          .limit(1);
        if (notification?.delivered || existing.status !== "pending") {
          res.json({ ok: true, id: existing.id, deduplicated: true });
          return;
        }
        try {
          const delivered = await notifyPending(
            req,
            existing,
            sessionSecret,
            botToken,
            chatId,
          );
          if (!delivered) {
            res.status(502).json({
              ok: false,
              id: existing.id,
              message: "Заявка сохранена, но Telegram пока не подтвердил доставку.",
            });
            return;
          }
          res.json({ ok: true, id: existing.id, deduplicated: true });
        } catch (error) {
          req.log.warn({ err: error }, "Failed to retry sign notification");
          res.status(502).json({
            ok: false,
            id: existing.id,
            message: "Заявка сохранена, но Telegram пока не подтвердил доставку.",
          });
        }
        return;
      }
    }

    const ipHash = hashIp(req.ip || req.get("x-forwarded-for") || "unknown");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RATE_LIMIT_MS);
    const id = randomBytes(16).toString("hex");
    const imagePath = getSignImagePath(id);
    let submission: typeof signSubmissionsTable.$inferSelect | undefined;
    try {
      submission = await db.transaction(async (tx) => {
        await tx
          .delete(signRateLimitsTable)
          .where(
            and(eq(signRateLimitsTable.ipHash, ipHash), lte(signRateLimitsTable.expiresAt, now)),
          );
        const [rateLimit] = await tx
          .insert(signRateLimitsTable)
          .values({ ipHash, expiresAt })
          .onConflictDoNothing()
          .returning();
        if (!rateLimit) return undefined;
        const [created] = await tx
          .insert(signSubmissionsTable)
          .values({
            id,
            nickname,
            requestId: requestId || null,
            imagePath,
            status: "pending",
            createdAt: now,
          })
          .returning();
        await tx.insert(signNotificationsTable).values({ submissionId: id });
        return created;
      });
    } catch (error) {
      req.log.error({ err: error }, "Failed to persist sign submission");
      res.status(500).json({ ok: false, message: "Не удалось сохранить заявку." });
      return;
    }
    if (!submission) {
      res.status(429).json({ ok: false, message: "Можно отправлять только одну карточку в час." });
      return;
    }

    try {
      await saveSignImage(imagePath, bytes);
    } catch (error) {
      req.log.error({ err: error, id }, "Failed to persist sign image");
      await db.delete(signSubmissionsTable).where(eq(signSubmissionsTable.id, id));
      res.status(500).json({ ok: false, message: "Не удалось сохранить заявку." });
      return;
    }

    let delivered = false;
    try {
      delivered = await notifyPending(req, submission, sessionSecret, botToken, chatId);
    } catch (error) {
      req.log.warn({ err: error, id }, "Failed to deliver sign notification");
    }
    if (!delivered) {
      res.status(502).json({
        ok: false,
        id,
        message: "Заявка сохранена, но Telegram пока не подтвердил доставку.",
      });
      return;
    }
    res.json({ ok: true, id, telegramDelivered: true });
  },
);

router.get("/sign/moderate", async (req, res): Promise<void> => {
  const id = typeof req.query.id === "string" ? req.query.id.trim() : "";
  const action = req.query.action;
  const token = req.query.token;
  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (
    !/^[a-f0-9]{32}$/.test(id) ||
    (action !== "approve" && action !== "reject" && action !== "delete") ||
    !sessionSecret ||
    !validModerationToken(sessionSecret, id, action, token)
  ) {
    res.status(403).type("text").send("Недействительная ссылка модерации.");
    return;
  }
  const [submission] = await db
    .select()
    .from(signSubmissionsTable)
    .where(eq(signSubmissionsTable.id, id))
    .limit(1);
  if (!submission) {
    res.status(404).type("text").send("Карточка не найдена.");
    return;
  }

  if (action === "delete") {
    if (submission.status !== "approved") {
      res.status(409).type("text").send("Удалить можно только опубликованную карточку.");
      return;
    }
    await db
      .update(signSubmissionsTable)
      .set({ status: "deleted" })
      .where(eq(signSubmissionsTable.id, id));
    try {
      await deleteSignImage(submission.imagePath);
    } catch (error) {
      req.log.warn({ err: error, id }, "Failed to delete sign image");
    }
    redirectToApp(res, "deleted");
    return;
  }
  if (submission.status !== "pending") {
    res.status(409).type("text").send("Эта карточка уже обработана.");
    return;
  }
  if (action === "reject") {
    await db
      .update(signSubmissionsTable)
      .set({ status: "rejected" })
      .where(eq(signSubmissionsTable.id, id));
    try {
      await deleteSignImage(submission.imagePath);
    } catch (error) {
      req.log.warn({ err: error, id }, "Failed to delete rejected sign image");
    }
    redirectToApp(res, "rejected");
    return;
  }

  await db
    .update(signSubmissionsTable)
    .set({ status: "approved" })
    .where(eq(signSubmissionsTable.id, id));
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (botToken && chatId) {
    const deleteUrl = getModerationUrl(
      req,
      id,
      "delete",
      createModerationToken(sessionSecret, id, "delete"),
    );
    void retryNotification(() =>
      sendDeletionNotice(botToken, chatId, submission.nickname, deleteUrl),
    ).catch((error) => req.log.warn({ err: error, id }, "Failed to send sign deletion link"));
  }
  redirectToApp(res, "approved");
});

export default router;