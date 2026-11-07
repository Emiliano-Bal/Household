import { timingSafeEqual } from "node:crypto";
import { webhookCallback } from "grammy";
import { getBot } from "@/lib/telegram/bot";

/**
 * Telegram webhook.
 *
 * Node runtime, not Edge: this reaches Prisma over node-postgres, which
 * needs TCP sockets. force-dynamic because a webhook must never be
 * served from a cache.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Compares the secret header without leaking its contents through timing.
 * Lengths are compared first because timingSafeEqual throws on a length
 * mismatch — and the length of a secret is not itself a secret worth
 * protecting here.
 */
function secretMatches(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  // Refuse to run half-configured. Without the secret the endpoint would
  // accept anything that can POST JSON, and this endpoint writes money.
  if (!token || !secret) {
    console.error("telegram webhook: TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET is not set");
    return new Response("Bot not configured", { status: 503 });
  }

  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), secret)) {
    // 401 with no detail: an unauthenticated caller learns nothing about
    // whether the bot exists or what it expects.
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    return await webhookCallback(getBot(token), "std/http")(request);
  } catch (error) {
    // Telegram retries non-2xx responses, and a retry storm on a handler
    // that writes expenses is worse than a dropped update. Log and
    // acknowledge; the user is told in-chat by the bot's own error
    // handler where it can be.
    console.error("telegram webhook: unhandled error", error);
    return new Response("OK", { status: 200 });
  }
}

/** Anything other than a POST from Telegram is not interesting. */
export async function GET(): Promise<Response> {
  return new Response("Method Not Allowed", { status: 405 });
}
