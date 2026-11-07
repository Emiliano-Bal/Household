import { randomInt } from "node:crypto";
import { prisma } from "../db";

/**
 * Account linking between a Telegram user and a household Member.
 *
 * There is no user table in this app and no login, so a Member is the
 * only thing a Telegram account can be bound to. A link code is minted in
 * the web app and redeemed in the chat.
 *
 * The web app being unauthenticated is why the code is short-lived,
 * single-use and rate-limited: it is only as secret as the household URL
 * it was displayed on, so the window in which it is worth anything has to
 * be small, and guessing has to be slow. See AUTH_TODO.md.
 */

/** No I, L, O, U, 0 or 1 — those are the pairs people misread off a screen. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 8;
export const CODE_TTL_MINUTES = 15;

/** Failed /link attempts allowed per Telegram account per hour. */
export const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MINUTES = 60;

/**
 * randomInt rather than Math.random: this is a credential, however
 * short-lived, and Math.random is predictable from prior output.
 */
function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export async function createLinkCode(memberId: string): Promise<{ code: string; expiresAt: Date }> {
  // One live code per member: minting a new one should invalidate the old,
  // or a code screenshotted weeks ago would still work.
  await prisma.telegramLinkCode.deleteMany({ where: { memberId, usedAt: null } });

  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);

  // Retry on the vanishingly unlikely collision rather than trusting it
  // cannot happen.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const existing = await prisma.telegramLinkCode.findUnique({ where: { code }, select: { code: true } });
    if (existing) continue;
    await prisma.telegramLinkCode.create({ data: { code, memberId, expiresAt } });
    return { code, expiresAt };
  }
  throw new Error("Could not generate a unique link code.");
}

export type RedeemResult =
  | { ok: true; memberId: string; memberName: string; householdId: string }
  | { ok: false; reason: "rate-limited" | "invalid" | "expired" | "used" | "already-linked" | "member-taken" };

/**
 * Redeems a code typed as `/link <code>`.
 *
 * Every outcome is recorded so repeated failures can be throttled. The
 * caller must not leak which of invalid/expired/used applied in a way
 * that helps an attacker — the bot says the same thing for all three.
 */
export async function redeemLinkCode(telegramUserId: bigint, rawCode: string): Promise<RedeemResult> {
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MINUTES * 60_000);
  const recentFailures = await prisma.telegramLinkAttempt.count({
    where: { telegramUserId, succeeded: false, createdAt: { gte: since } },
  });
  if (recentFailures >= MAX_FAILED_ATTEMPTS) return { ok: false, reason: "rate-limited" };

  const fail = async (reason: Exclude<RedeemResult, { ok: true }>["reason"]): Promise<RedeemResult> => {
    await prisma.telegramLinkAttempt.create({ data: { telegramUserId, succeeded: false } });
    return { ok: false, reason };
  };

  const existingLink = await prisma.telegramLink.findUnique({ where: { telegramUserId } });
  // Not a failed guess — don't spend the rate-limit budget on it.
  if (existingLink) return { ok: false, reason: "already-linked" };

  const code = normalizeCode(rawCode);
  if (code.length !== CODE_LENGTH) return fail("invalid");

  const row = await prisma.telegramLinkCode.findUnique({
    where: { code },
    include: { member: { select: { id: true, name: true, householdId: true } } },
  });
  if (!row) return fail("invalid");
  if (row.usedAt) return fail("used");
  if (row.expiresAt.getTime() < Date.now()) return fail("expired");

  const memberTaken = await prisma.telegramLink.findUnique({ where: { memberId: row.memberId } });
  if (memberTaken) return fail("member-taken");

  // Burn the code and create the link together: a crash between the two
  // would otherwise leave a code that is spent but linked to nothing, or
  // a link created from a code someone else could still use.
  await prisma.$transaction([
    prisma.telegramLinkCode.update({ where: { code }, data: { usedAt: new Date() } }),
    prisma.telegramLink.create({ data: { telegramUserId, memberId: row.memberId } }),
    prisma.telegramLinkAttempt.create({ data: { telegramUserId, succeeded: true } }),
  ]);

  return { ok: true, memberId: row.member.id, memberName: row.member.name, householdId: row.member.householdId };
}

/** Codes are shown uppercase; accept whatever case and spacing was typed. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, "");
}

export interface LinkedMember {
  memberId: string;
  memberName: string;
  householdId: string;
}

/** The member behind a Telegram account, or null when unlinked. */
export async function resolveLinkedMember(telegramUserId: bigint): Promise<LinkedMember | null> {
  const link = await prisma.telegramLink.findUnique({
    where: { telegramUserId },
    include: { member: { select: { id: true, name: true, householdId: true, active: true } } },
  });
  if (!link) return null;
  return {
    memberId: link.member.id,
    memberName: link.member.name,
    householdId: link.member.householdId,
  };
}

/** Undoes the link. Returns false when there was nothing to undo. */
export async function unlinkTelegramUser(telegramUserId: bigint): Promise<boolean> {
  const result = await prisma.telegramLink.deleteMany({ where: { telegramUserId } });
  return result.count > 0;
}

/** Undoes the link from the web side, where the member is known instead. */
export async function unlinkMember(memberId: string): Promise<boolean> {
  const result = await prisma.telegramLink.deleteMany({ where: { memberId } });
  return result.count > 0;
}
