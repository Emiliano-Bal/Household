import { prisma } from "../db";
import type { Prisma } from "@prisma/client";

/**
 * Conversation state for the expense flow.
 *
 * Vercel functions keep nothing between invocations, so every step of a
 * multi-question flow has to be reloaded from the database. Keyed by chat
 * rather than user: the same person in a private chat and in a group is
 * two independent conversations.
 */

export const SESSION_TTL_MINUTES = 30;

export type Step = "awaiting_title" | "awaiting_amount" | "awaiting_category" | "awaiting_split" | "awaiting_confirm";

export interface Draft {
  title?: string;
  amountCents?: number;
  /** null is a real choice — "sin categoría" — distinct from "not asked yet". */
  categoryId?: string | null;
  categoryName?: string | null;
  split?: "SOLO" | "PROPORTIONAL" | "EQUAL";
}

export interface Session {
  chatId: bigint;
  telegramUserId: bigint;
  step: Step;
  draft: Draft;
}

/**
 * Loads a session, treating anything untouched for SESSION_TTL_MINUTES as
 * absent. Expiry is enforced on read rather than by a scheduled sweep:
 * there is no scheduler here, and a stale row that is never read does no
 * harm. clearExpiredSessions exists to stop the table growing forever.
 */
export async function loadSession(chatId: bigint): Promise<Session | null> {
  const row = await prisma.telegramSession.findUnique({ where: { chatId } });
  if (!row) return null;

  const expired = Date.now() - row.updatedAt.getTime() > SESSION_TTL_MINUTES * 60_000;
  if (expired) {
    await prisma.telegramSession.delete({ where: { chatId } }).catch(() => {});
    return null;
  }

  return {
    chatId: row.chatId,
    telegramUserId: row.telegramUserId,
    step: row.step as Step,
    draft: (row.draft ?? {}) as Draft,
  };
}

export async function saveSession(
  chatId: bigint,
  telegramUserId: bigint,
  step: Step,
  draft: Draft
): Promise<void> {
  const data = { telegramUserId, step, draft: draft as Prisma.InputJsonValue };
  await prisma.telegramSession.upsert({
    where: { chatId },
    create: { chatId, ...data },
    update: data,
  });
}

export async function clearSession(chatId: bigint): Promise<boolean> {
  const result = await prisma.telegramSession.deleteMany({ where: { chatId } });
  return result.count > 0;
}

/**
 * Housekeeping for rows nobody will ever read again. Called
 * opportunistically from the webhook rather than on a schedule — this
 * table sees a handful of rows a day, so a sweep on write is plenty.
 */
export async function clearExpiredSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - SESSION_TTL_MINUTES * 60_000);
  const result = await prisma.telegramSession.deleteMany({ where: { updatedAt: { lt: cutoff } } });
  return result.count;
}

/** Which question still needs an answer, in order. Drives the quick format's "ask only for what is missing". */
export function nextStep(draft: Draft): Step {
  if (!draft.title) return "awaiting_title";
  if (draft.amountCents === undefined) return "awaiting_amount";
  if (draft.categoryId === undefined) return "awaiting_category";
  if (!draft.split) return "awaiting_split";
  return "awaiting_confirm";
}
