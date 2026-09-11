import { Router, type IRouter, type Request } from "express";

const router: IRouter = Router();
const MESSAGE_MAX_LENGTH = 2_000;
const RATE_LIMIT_MS = 60_000;
const recentMessages = new Map<string, number>();

function getClientKey(request: Request): string {
  return request.ip || "unknown";
}

router.post("/send", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const rawMessage = req.body?.message;
  const message = typeof rawMessage === "string" ? rawMessage.trim() : "";
  if (!message || message.length > MESSAGE_MAX_LENGTH) {
    res.status(400).json({
      ok: false,
      message: `Сообщение должно содержать от 1 до ${MESSAGE_MAX_LENGTH} символов.`,
    });
    return;
  }

  const clientKey = getClientKey(req);
  const lastMessageAt = recentMessages.get(clientKey) ?? 0;
  if (Date.now() - lastMessageAt < RATE_LIMIT_MS) {
    res.status(429).json({
      ok: false,
      message: "Попробуйте отправить сообщение через минуту.",
    });
    return;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    res.status(503).json({
      ok: false,
      message: "Telegram пока не подключён.",
    });
    return;
  }

  recentMessages.set(clientKey, Date.now());
  try {
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: `Анонимное сообщение с RedL1zar:\n\n${message}`,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(8_000),
      },
    );

    if (!telegramResponse.ok) {
      recentMessages.delete(clientKey);
      req.log.warn(
        { status: telegramResponse.status },
        "Telegram message delivery failed",
      );
      res.status(502).json({
        ok: false,
        message: "Не удалось доставить сообщение в Telegram.",
      });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    recentMessages.delete(clientKey);
    req.log.warn({ err: error }, "Telegram message request failed");
    res.status(502).json({
      ok: false,
      message: "Не удалось доставить сообщение в Telegram.",
    });
  }
});

export default router;