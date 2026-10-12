// Integration test against a REAL database. Run with `npm run test:db`.
//
// The countdown's hard parts are all about time, not money: which days
// count as elapsed, that future days carry no spending, and that every
// per-day average guards its divisor instead of dividing by zero.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "./db";
import { getMonthRunway } from "./queries";
import { monthStart, addMonths, daysInMonth } from "./month";

describe("month runway (real DB)", () => {
  let householdId: string;
  let memberId: string;
  // A month safely in the past, so "elapsed" is the whole month and the
  // assertions below don't shift with the calendar. A past date stays
  // past, so this stays stable; the future month is far enough out to
  // stay future for the life of the app.
  const pastMonth = monthStart(new Date(Date.UTC(2025, 2, 1))); // March 2025, 31 days
  const futureMonth = monthStart(new Date(Date.UTC(2099, 5, 1)));

  beforeAll(async () => {
    const household = await prisma.household.create({ data: { name: "__test__ runway" } });
    householdId = household.id;
    const member = await prisma.member.create({ data: { householdId, name: "Earner" } });
    memberId = member.id;

    // 3000 income for the month.
    await prisma.incomeRecord.create({
      data: { memberId, month: pastMonth, netAmount: 300000, source: "Salary" },
    });

    // Spend on days 2, 2 again, 10 and 20 — two on the same day, to prove
    // they aggregate rather than overwrite.
    const on = (day: number) => new Date(Date.UTC(2025, 2, day));
    await prisma.expense.createMany({
      data: [
        { householdId, date: on(2), label: "a", amount: 10000, paidByMemberId: memberId, splitRule: { type: "SOLO", memberId }, isShared: false },
        { householdId, date: on(2), label: "b", amount: 5000, paidByMemberId: memberId, splitRule: { type: "SOLO", memberId }, isShared: false },
        { householdId, date: on(10), label: "c", amount: 25000, paidByMemberId: memberId, splitRule: { type: "SOLO", memberId }, isShared: false },
        { householdId, date: on(20), label: "d", amount: 60000, paidByMemberId: memberId, splitRule: { type: "SOLO", memberId }, isShared: false },
      ],
    });
  });

  afterAll(async () => {
    await prisma.household.delete({ where: { id: householdId } });
  });

  it("starts from the month's income and subtracts each day's spending", async () => {
    const r = await getMonthRunway(householdId, pastMonth);

    expect(r.startingCents).toBe(300000);
    expect(r.daysInMonth).toBe(31);
    expect(r.days).toHaveLength(31);

    // Day 1: nothing spent, balance untouched.
    expect(r.days[0]).toMatchObject({ day: 1, spentCents: 0, remainingCents: 300000 });
    // Day 2: both expenses that day aggregate.
    expect(r.days[1]).toMatchObject({ day: 2, spentCents: 15000, remainingCents: 285000 });
    // Day 3 carries day 2's balance forward with nothing of its own.
    expect(r.days[2]).toMatchObject({ day: 3, spentCents: 0, remainingCents: 285000 });
    expect(r.days[9]).toMatchObject({ day: 10, spentCents: 25000, remainingCents: 260000 });
    expect(r.days[19]).toMatchObject({ day: 20, spentCents: 60000, remainingCents: 200000 });
    expect(r.days[30]).toMatchObject({ day: 31, remainingCents: 200000 });
  });

  it("treats a past month as fully elapsed", async () => {
    const r = await getMonthRunway(householdId, pastMonth);

    expect(r.isPastMonth).toBe(true);
    expect(r.isCurrentMonth).toBe(false);
    expect(r.elapsedDays).toBe(31);
    expect(r.daysRemaining).toBe(0);
    expect(r.days.some((d) => d.isFuture)).toBe(false);

    expect(r.spentToDateCents).toBe(100000);
    expect(r.remainingCents).toBe(200000);
    // No days left to spread the remainder over.
    expect(r.safeDailyCents).toBeNull();
  });

  it("identifies the biggest single day", async () => {
    const r = await getMonthRunway(householdId, pastMonth);
    expect(r.biggestDay).toEqual({ day: 20, spentCents: 60000 });
  });

  it("computes pace figures without dividing by zero", async () => {
    const r = await getMonthRunway(householdId, pastMonth);

    expect(r.evenDailyCents).toBe(Math.round(300000 / 31));
    expect(r.averageDailySpendCents).toBe(Math.round(100000 / 31));
    // 3226/day against 9677/day of income — comfortably inside the month.
    expect(r.projectedEndCents).toBe(300000 - Math.round(100000 / 31) * 31);
  });

  it("reports a future month as untouched, with no average to extrapolate from", async () => {
    const r = await getMonthRunway(householdId, futureMonth);

    expect(r.isCurrentMonth).toBe(false);
    expect(r.isPastMonth).toBe(false);
    expect(r.elapsedDays).toBe(0);
    expect(r.daysRemaining).toBe(daysInMonth(futureMonth));
    // Every day is still ahead, so nothing is counted as spent.
    expect(r.days.every((d) => d.isFuture)).toBe(true);
    expect(r.spentToDateCents).toBe(0);
    // Guarded rather than 0/0.
    expect(r.averageDailySpendCents).toBeNull();
    expect(r.projectedEndCents).toBeNull();
  });

  it("carries a negative balance rather than clamping at zero", async () => {
    const month = addMonths(pastMonth, 1); // April 2025
    await prisma.incomeRecord.create({
      data: { memberId, month, netAmount: 50000, source: "Salary" },
    });
    await prisma.expense.create({
      data: {
        householdId,
        date: new Date(Date.UTC(2025, 3, 5)),
        label: "blowout",
        amount: 80000,
        paidByMemberId: memberId,
        splitRule: { type: "SOLO", memberId },
        isShared: false,
      },
    });

    const r = await getMonthRunway(householdId, month);
    expect(r.startingCents).toBe(50000);
    expect(r.remainingCents).toBe(-30000);
    expect(r.days[4].remainingCents).toBe(-30000);
    // And it stays negative for the rest of the month.
    expect(r.days[r.days.length - 1].remainingCents).toBe(-30000);
  });

  it("handles a month with no income at all", async () => {
    const month = monthStart(new Date(Date.UTC(2025, 10, 1)));
    const other = await prisma.household.create({ data: { name: "__test__ runway no income" } });
    try {
      const m = await prisma.member.create({ data: { householdId: other.id, name: "Broke" } });
      await prisma.expense.create({
        data: {
          householdId: other.id,
          date: new Date(Date.UTC(2025, 10, 3)),
          label: "x",
          amount: 1000,
          paidByMemberId: m.id,
          splitRule: { type: "SOLO", memberId: m.id },
          isShared: false,
        },
      });

      const r = await getMonthRunway(other.id, month);
      expect(r.startingCents).toBe(0);
      expect(r.evenDailyCents).toBe(0);
      expect(r.remainingCents).toBe(-1000);
      expect(Number.isFinite(r.evenDailyCents)).toBe(true);
    } finally {
      await prisma.household.delete({ where: { id: other.id } });
    }
  });
});
