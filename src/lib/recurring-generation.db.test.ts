// Integration test against a REAL database. Run with `npm run test:db`.
//
// The recurrence maths is unit-tested in recurring.test.ts. What needs a
// database is idempotency: generation is now keyed on the occurrence
// rather than the month, which is the only way a weekly rule's four or
// five occurrences can coexist, and re-running must add nothing.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "./db";
import { generateRecurringForMonth } from "./actions";
import { monthStart } from "./month";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("recurring generation (real DB)", () => {
  let householdId: string;
  let memberId: string;
  let categoryId: string;

  // March 2026 starts on a Sunday: five Mondays (2, 9, 16, 23, 30).
  const march = monthStart(new Date(Date.UTC(2026, 2, 1)));
  const february = monthStart(new Date(Date.UTC(2026, 1, 1)));

  beforeAll(async () => {
    const household = await prisma.household.create({ data: { name: "__test__ recurring generation" } });
    householdId = household.id;
    const member = await prisma.member.create({ data: { householdId, name: "Payer" } });
    memberId = member.id;
    const category = await prisma.category.create({ data: { householdId, name: "Bills", kind: "FIXED" } });
    categoryId = category.id;
    await prisma.incomeRecord.create({ data: { memberId, month: march, netAmount: 500000, source: "Salary" } });
  });

  afterAll(async () => {
    await prisma.household.delete({ where: { id: householdId } });
  });

  it("generates one expense per weekly occurrence and nothing extra on re-run", async () => {
    await prisma.recurringExpense.create({
      data: {
        householdId,
        categoryId,
        label: "Weekly cleaner",
        amount: 4000,
        frequency: "WEEKLY",
        interval: 1,
        dayOfWeek: 1, // Monday
        startMonth: march,
        paidByMemberId: memberId,
        splitRule: { type: "SOLO", memberId },
      },
    });

    const first = await generateRecurringForMonth(householdId, march);
    expect(first).toEqual({ createdCount: 5, dueCount: 5 });

    const created = await prisma.expense.findMany({
      where: { householdId, label: "Weekly cleaner" },
      orderBy: { date: "asc" },
    });
    expect(created.map((e) => iso(e.date))).toEqual([
      "2026-03-02",
      "2026-03-09",
      "2026-03-16",
      "2026-03-23",
      "2026-03-30",
    ]);
    // Each carries its own occurrence key — a per-month key would have
    // collapsed these into one row.
    expect(new Set(created.map((e) => e.occurrenceDate!.getTime())).size).toBe(5);

    // Re-running is a no-op.
    const second = await generateRecurringForMonth(householdId, march);
    expect(second).toEqual({ createdCount: 0, dueCount: 5 });
    expect(await prisma.expense.count({ where: { householdId, label: "Weekly cleaner" } })).toBe(5);
  });

  it("fills in only the missing occurrences when one is deleted", async () => {
    const victim = await prisma.expense.findFirstOrThrow({
      where: { householdId, label: "Weekly cleaner", date: new Date(Date.UTC(2026, 2, 16)) },
    });
    await prisma.expense.delete({ where: { id: victim.id } });

    const result = await generateRecurringForMonth(householdId, march);
    expect(result).toEqual({ createdCount: 1, dueCount: 5 });
    expect(await prisma.expense.count({ where: { householdId, label: "Weekly cleaner" } })).toBe(5);
  });

  it("posts a 31st-of-the-month rule on the last day of February", async () => {
    await prisma.recurringExpense.create({
      data: {
        householdId,
        categoryId,
        label: "Rent on the 31st",
        amount: 150000,
        frequency: "MONTHLY",
        interval: 1,
        dayOfMonth: 31,
        startMonth: february,
        paidByMemberId: memberId,
        splitRule: { type: "SOLO", memberId },
      },
    });

    await generateRecurringForMonth(householdId, february);

    const feb = await prisma.expense.findFirstOrThrow({ where: { householdId, label: "Rent on the 31st" } });
    // 2026 is not a leap year, so February has 28 days — not skipped, and
    // not spilled into March.
    expect(iso(feb.date)).toBe("2026-02-28");
    expect(iso(feb.occurrenceDate!)).toBe("2026-02-28");

    // And it still lands on the 31st in a month that has one.
    await generateRecurringForMonth(householdId, march);
    const marchRent = await prisma.expense.findFirstOrThrow({
      where: { householdId, label: "Rent on the 31st", date: new Date(Date.UTC(2026, 2, 31)) },
    });
    expect(iso(marchRent.date)).toBe("2026-03-31");

    // The two months are distinct occurrences, both present.
    expect(await prisma.expense.count({ where: { householdId, label: "Rent on the 31st" } })).toBe(2);
  });

  it("does not generate for a quarterly rule in an off month", async () => {
    await prisma.recurringExpense.create({
      data: {
        householdId,
        categoryId,
        label: "Quarterly insurance",
        amount: 30000,
        frequency: "QUARTERLY",
        interval: 1,
        dayOfMonth: 5,
        startMonth: february,
        paidByMemberId: memberId,
        splitRule: { type: "SOLO", memberId },
      },
    });

    await generateRecurringForMonth(householdId, march); // Feb + 1 — off month
    expect(await prisma.expense.count({ where: { householdId, label: "Quarterly insurance" } })).toBe(0);

    await generateRecurringForMonth(householdId, february); // on month
    expect(await prisma.expense.count({ where: { householdId, label: "Quarterly insurance" } })).toBe(1);
  });

  it("skips an inactive rule entirely", async () => {
    const paused = await prisma.recurringExpense.create({
      data: {
        householdId,
        categoryId,
        label: "Paused thing",
        amount: 1000,
        frequency: "MONTHLY",
        interval: 1,
        dayOfMonth: 1,
        startMonth: march,
        paidByMemberId: memberId,
        splitRule: { type: "SOLO", memberId },
        active: false,
      },
    });

    await generateRecurringForMonth(householdId, march);
    expect(await prisma.expense.count({ where: { householdId, recurringExpenseId: paused.id } })).toBe(0);
  });

  it("generated expenses carry real shares, so they reach the balances", async () => {
    const one = await prisma.expense.findFirstOrThrow({
      where: { householdId, label: "Weekly cleaner" },
      include: { shares: true },
    });
    expect(one.shares.length).toBeGreaterThan(0);
    expect(one.shares.reduce((sum, sh) => sum + sh.owedAmount, 0)).toBe(one.amount);
  });
});
