// Integration test against a REAL database. Run with `npm run test:db`.
//
// Linking is the bot's entire access control: a Telegram account that
// redeems a code can write expenses into a household. The properties
// worth holding are therefore single-use, expiry, the throttle, and that
// nothing links twice.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "../db";
import {
  createLinkCode,
  redeemLinkCode,
  resolveLinkedMember,
  unlinkTelegramUser,
  unlinkMember,
  normalizeCode,
  MAX_FAILED_ATTEMPTS,
  CODE_TTL_MINUTES,
} from "./link";
import { loadSession, saveSession, clearSession, clearExpiredSessions, nextStep } from "./session";

// Far outside the range real Telegram ids occupy for these tests, and
// above 2^31 so the BigInt column is actually exercised.
let nextId = BigInt("9000000001");
const freshTelegramId = () => {
  const id = nextId;
  nextId = nextId + BigInt(1);
  return id;
};

describe("telegram linking (real DB)", () => {
  let householdId: string;
  let aliceId: string;
  let bobId: string;

  beforeAll(async () => {
    const household = await prisma.household.create({ data: { name: "__test__ telegram link" } });
    householdId = household.id;
    const [a, b] = await Promise.all([
      prisma.member.create({ data: { householdId, name: "Alice" } }),
      prisma.member.create({ data: { householdId, name: "Bob" } }),
    ]);
    aliceId = a.id;
    bobId = b.id;
  });

  afterAll(async () => {
    await prisma.household.delete({ where: { id: householdId } });
  });

  beforeEach(async () => {
    // Links and attempts are per-test state; codes cascade with members.
    await prisma.telegramLink.deleteMany({ where: { memberId: { in: [aliceId, bobId] } } });
    await prisma.telegramLinkCode.deleteMany({ where: { memberId: { in: [aliceId, bobId] } } });
    await prisma.telegramLinkAttempt.deleteMany({ where: { telegramUserId: { gte: BigInt("9000000000") } } });
  });

  it("mints a code from an unambiguous alphabet with a short expiry", async () => {
    const { code, expiresAt } = await createLinkCode(aliceId);

    expect(code).toHaveLength(8);
    // No characters that get misread off a screen.
    expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    expect(code).not.toMatch(/[ILOU01]/);

    const minutesOut = (expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutesOut).toBeGreaterThan(CODE_TTL_MINUTES - 1);
    expect(minutesOut).toBeLessThanOrEqual(CODE_TTL_MINUTES);
  });

  it("links an account and resolves it back to the member and household", async () => {
    const telegramUserId = freshTelegramId();
    const { code } = await createLinkCode(aliceId);

    const result = await redeemLinkCode(telegramUserId, code);
    expect(result).toMatchObject({ ok: true, memberId: aliceId, memberName: "Alice", householdId });

    const resolved = await resolveLinkedMember(telegramUserId);
    expect(resolved).toEqual({ memberId: aliceId, memberName: "Alice", householdId });
  });

  it("accepts the code in any case or spacing", async () => {
    const telegramUserId = freshTelegramId();
    const { code } = await createLinkCode(aliceId);

    const result = await redeemLinkCode(telegramUserId, ` ${code.toLowerCase()} `);
    expect(result.ok).toBe(true);
    expect(normalizeCode(" abcd-2345 ")).toBe("ABCD2345");
  });

  it("burns the code: a second redemption fails", async () => {
    const { code } = await createLinkCode(aliceId);
    expect((await redeemLinkCode(freshTelegramId(), code)).ok).toBe(true);

    const second = await redeemLinkCode(freshTelegramId(), code);
    expect(second).toEqual({ ok: false, reason: "used" });
  });

  it("invalidates the previous code when a new one is minted", async () => {
    const first = await createLinkCode(aliceId);
    const second = await createLinkCode(aliceId);
    expect(second.code).not.toBe(first.code);

    // An old screenshot is worthless.
    expect(await redeemLinkCode(freshTelegramId(), first.code)).toEqual({ ok: false, reason: "invalid" });
    expect((await redeemLinkCode(freshTelegramId(), second.code)).ok).toBe(true);
  });

  it("refuses an expired code", async () => {
    const { code } = await createLinkCode(aliceId);
    await prisma.telegramLinkCode.update({
      where: { code },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await redeemLinkCode(freshTelegramId(), code)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses to link one Telegram account to a second member", async () => {
    const telegramUserId = freshTelegramId();
    expect((await redeemLinkCode(telegramUserId, (await createLinkCode(aliceId)).code)).ok).toBe(true);

    const second = await redeemLinkCode(telegramUserId, (await createLinkCode(bobId)).code);
    expect(second).toEqual({ ok: false, reason: "already-linked" });
  });

  it("refuses to link one member to a second Telegram account", async () => {
    expect((await redeemLinkCode(freshTelegramId(), (await createLinkCode(aliceId)).code)).ok).toBe(true);

    const other = await redeemLinkCode(freshTelegramId(), (await createLinkCode(aliceId)).code);
    expect(other).toEqual({ ok: false, reason: "member-taken" });
  });

  it("throttles guessing after repeated failures", async () => {
    const telegramUserId = freshTelegramId();

    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      expect(await redeemLinkCode(telegramUserId, "ZZZZZZZZ")).toEqual({ ok: false, reason: "invalid" });
    }

    // The next attempt is refused before the code is even looked at —
    // so a real code presented now is also refused.
    const { code } = await createLinkCode(aliceId);
    expect(await redeemLinkCode(telegramUserId, code)).toEqual({ ok: false, reason: "rate-limited" });
    expect(await prisma.telegramLink.count({ where: { telegramUserId } })).toBe(0);
  });

  it("throttles per account, not globally", async () => {
    const guesser = freshTelegramId();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await redeemLinkCode(guesser, "ZZZZZZZZ");
    expect(await redeemLinkCode(guesser, "ZZZZZZZZ")).toEqual({ ok: false, reason: "rate-limited" });

    // Someone else is unaffected.
    const innocent = freshTelegramId();
    expect((await redeemLinkCode(innocent, (await createLinkCode(aliceId)).code)).ok).toBe(true);
  });

  it("forgets failures older than the window", async () => {
    const telegramUserId = freshTelegramId();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await redeemLinkCode(telegramUserId, "ZZZZZZZZ");
    expect(await redeemLinkCode(telegramUserId, "ZZZZZZZZ")).toEqual({ ok: false, reason: "rate-limited" });

    // Age the attempts past the one-hour window.
    await prisma.telegramLinkAttempt.updateMany({
      where: { telegramUserId },
      data: { createdAt: new Date(Date.now() - 61 * 60_000) },
    });

    expect((await redeemLinkCode(telegramUserId, (await createLinkCode(aliceId)).code)).ok).toBe(true);
  });

  it("unlinks from either side", async () => {
    const fromChat = freshTelegramId();
    await redeemLinkCode(fromChat, (await createLinkCode(aliceId)).code);
    expect(await unlinkTelegramUser(fromChat)).toBe(true);
    expect(await resolveLinkedMember(fromChat)).toBeNull();
    // Idempotent.
    expect(await unlinkTelegramUser(fromChat)).toBe(false);

    const fromWeb = freshTelegramId();
    await redeemLinkCode(fromWeb, (await createLinkCode(bobId)).code);
    expect(await unlinkMember(bobId)).toBe(true);
    expect(await resolveLinkedMember(fromWeb)).toBeNull();
  });

  it("frees the member for a new account after unlinking", async () => {
    const first = freshTelegramId();
    await redeemLinkCode(first, (await createLinkCode(aliceId)).code);
    await unlinkTelegramUser(first);

    const second = freshTelegramId();
    expect((await redeemLinkCode(second, (await createLinkCode(aliceId)).code)).ok).toBe(true);
  });
});

describe("telegram sessions (real DB)", () => {
  const chatId = BigInt("9100000001");
  const telegramUserId = BigInt("9100000002");

  afterAll(async () => {
    await prisma.telegramSession.deleteMany({ where: { chatId } });
  });

  beforeEach(async () => {
    await prisma.telegramSession.deleteMany({ where: { chatId } });
  });

  it("round-trips a draft", async () => {
    await saveSession(chatId, telegramUserId, "awaiting_amount", { title: "Mercadona" });
    const session = await loadSession(chatId);
    expect(session).toMatchObject({ chatId, telegramUserId, step: "awaiting_amount" });
    expect(session!.draft.title).toBe("Mercadona");
  });

  it("overwrites rather than stacking rows for the same chat", async () => {
    await saveSession(chatId, telegramUserId, "awaiting_amount", { title: "A" });
    await saveSession(chatId, telegramUserId, "awaiting_category", { title: "A", amountCents: 4520 });

    expect(await prisma.telegramSession.count({ where: { chatId } })).toBe(1);
    const session = await loadSession(chatId);
    expect(session!.step).toBe("awaiting_category");
    expect(session!.draft.amountCents).toBe(4520);
  });

  it("treats a session untouched for over 30 minutes as gone, and deletes it", async () => {
    await saveSession(chatId, telegramUserId, "awaiting_amount", { title: "Stale" });
    await prisma.telegramSession.update({
      where: { chatId },
      data: { updatedAt: new Date(Date.now() - 31 * 60_000) },
    });

    expect(await loadSession(chatId)).toBeNull();
    // Reading an expired session cleans it up rather than leaving it.
    expect(await prisma.telegramSession.count({ where: { chatId } })).toBe(0);
  });

  it("sweeps stale rows", async () => {
    await saveSession(chatId, telegramUserId, "awaiting_amount", { title: "Stale" });
    await prisma.telegramSession.update({
      where: { chatId },
      data: { updatedAt: new Date(Date.now() - 31 * 60_000) },
    });

    expect(await clearExpiredSessions()).toBeGreaterThanOrEqual(1);
    expect(await prisma.telegramSession.count({ where: { chatId } })).toBe(0);
  });

  it("clearSession reports whether there was anything to clear", async () => {
    await saveSession(chatId, telegramUserId, "awaiting_title", {});
    expect(await clearSession(chatId)).toBe(true);
    expect(await clearSession(chatId)).toBe(false);
  });
});

describe("nextStep", () => {
  it("asks only for what is missing, in order", () => {
    expect(nextStep({})).toBe("awaiting_title");
    expect(nextStep({ title: "Mercadona" })).toBe("awaiting_amount");
    // The quick format supplies title and amount, so the flow skips both.
    expect(nextStep({ title: "Mercadona", amountCents: 4520 })).toBe("awaiting_category");
    expect(nextStep({ title: "M", amountCents: 1, categoryId: "c1" })).toBe("awaiting_split");
    expect(nextStep({ title: "M", amountCents: 1, categoryId: "c1", split: "EQUAL" })).toBe("awaiting_confirm");
  });

  it("treats 'no category' as answered, not missing", () => {
    // null is a real choice; undefined means not asked yet.
    expect(nextStep({ title: "M", amountCents: 1, categoryId: null })).toBe("awaiting_split");
  });

  it("does not skip a zero amount check by truthiness", () => {
    // 0 never reaches here (parseAmount rejects it), but the guard must
    // test for undefined rather than falsiness regardless.
    expect(nextStep({ title: "M", amountCents: 0 })).toBe("awaiting_category");
  });
});
