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
  //
  // The response names which variables are missing. That is config state,
  // not a secret — the names are already in .env.example and DEPLOY.md —
  // and without it a 503 is indistinguishable from "set but not
  // redeployed", which is the failure people actually hit, since Vercel
  // bakes env vars in at build time.
  // Written as an explicit !token || !secret check rather than testing
  // the array's length: TypeScript narrows on the former, so `token` and
  // `secret` are plain strings below this block.
  if (!token || !secret) {
    const missing = [
      !token && "TELEGRAM_BOT_TOKEN",
      !secret && "TELEGRAM_WEBHOOK_SECRET",
    ].filter(Boolean) as string[];

    console.error(`telegram webhook: not configured — missing ${missing.join(", ")}`);
    return new Response(
      `Bot not configured. Missing on this deployment: ${missing.join(", ")}. ` +
        "Set them in Vercel for this environment, then REDEPLOY — env vars are applied at build time.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
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
