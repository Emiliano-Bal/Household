// Integration test against a REAL database. Run with `npm run test:db`.
//
// Budget limits are standing, not per-month, and that is the whole point:
// a limit set once keeps applying, only the spend measured against it
// resets. The cases below pin that down, plus the two rules the schema
// cannot express — variable categories only, and household-wide spend.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "./db";
import { getBudgetLimits, getBudgetStatus } from "./queries";
import { setBudgetLimit } from "./actions";
import { monthStart, addMonths } from "./month";

describe("budget limits (real DB)", () => {
  let householdId: string;
  let alice: string;
  let bob: string;
  let groceriesId: string;
  let eatingOutId: string;
  let rentId: string;
  let savingsId: string;

  // setBudgetLimit always writes "from the current month", so the tests
  // anchor on that and look forward/back from it.
  const thisMonth = monthStart(new Date());
  const nextMonth = addMonths(thisMonth, 1);
  const lastMonth = addMonths(thisMonth, -1);

  beforeAll(async () => {
    const household = await prisma.household.create({ data: { name: "__test__ budget limits" } });
    householdId = household.id;

    const [a, b] = await Promise.all([
      prisma.member.create({ data: { householdId, name: "Alice" } }),
      prisma.member.create({ data: { householdId, name: "Bob" } }),
    ]);
    alice = a.id;
    bob = b.id;

    const [groceries, eatingOut, rent, savings] = await Promise.all([
      prisma.category.create({ data: { householdId, name: "Groceries", kind: "VARIABLE" } }),
      prisma.category.create({ data: { householdId, name: "Eating Out", kind: "VARIABLE" } }),
      prisma.category.create({ data: { householdId, name: "Rent / Mortgage", kind: "FIXED" } }),
      prisma.category.create({ data: { householdId, name: "Savings", kind: "SAVINGS" } }),
    ]);
    groceriesId = groceries.id;
    eatingOutId = eatingOut.id;
    rentId = rent.id;
    savingsId = savings.id;
  });

  afterAll(async () => {
    await prisma.household.delete({ where: { id: householdId } });
  });

  it("lists only variable categories — fixed and savings are absent entirely", async () => {
    const limits = await getBudgetLimits(householdId, thisMonth);

    expect(limits.map((l) => l.categoryName).sort()).toEqual(["Eating Out", "Groceries"]);
    // Not merely unlimited — not present at all.
    expect(limits.some((l) => l.categoryId === rentId)).toBe(false);
    expect(limits.some((l) => l.categoryId === savingsId)).toBe(false);
  });

  it("refuses a limit on a fixed or savings category", async () => {
    const onFixed = await setBudgetLimit({ householdId, categoryId: rentId, amount: 185000 });
    expect(onFixed.ok).toBe(false);
    if (!onFixed.ok) expect(onFixed.error).toMatch(/only variable categories/i);

    const onSavings = await setBudgetLimit({ householdId, categoryId: savingsId, amount: 10000 });
    expect(onSavings.ok).toBe(false);

    // Nothing was written for either.
    expect(await prisma.budgetLimit.count({ where: { categoryId: { in: [rentId, savingsId] } } })).toBe(0);
  });

  it("refuses a category from another household", async () => {
    const other = await prisma.household.create({ data: { name: "__test__ budget limits other" } });
    try {
      const result = await setBudgetLimit({ householdId: other.id, categoryId: groceriesId, amount: 999 });
      expect(result.ok).toBe(false);
      expect(await prisma.budgetLimit.count({ where: { householdId: other.id } })).toBe(0);
    } finally {
      await prisma.household.delete({ where: { id: other.id } });
    }
  });

  it("carries a limit forward to later months with no new row", async () => {
    await setBudgetLimit({ householdId, categoryId: groceriesId, amount: 50000 });

    // Exactly one row exists, for the current month...
    const rows = await prisma.budgetLimit.findMany({ where: { categoryId: groceriesId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].effectiveFrom.getTime()).toBe(thisMonth.getTime());

    // ...yet it resolves for this month and every later one.
    for (const month of [thisMonth, nextMonth, addMonths(thisMonth, 6)]) {
      const limits = await getBudgetLimits(householdId, month);
      expect(limits.find((l) => l.categoryId === groceriesId)!.limitCents).toBe(50000);
    }
  });

  it("does not apply a limit to months before it was set", async () => {
    const limits = await getBudgetLimits(householdId, lastMonth);
    expect(limits.find((l) => l.categoryId === groceriesId)!.limitCents).toBeNull();
  });

  it("counts every member's spending, whoever paid", async () => {
    const day = new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth(), 4));
    await prisma.expense.createMany({
      data: [
        { householdId, date: day, label: "alice shop", amount: 12000, categoryId: groceriesId, paidByMemberId: alice, splitRule: { type: "EQUAL" }, isShared: true },
        { householdId, date: day, label: "bob shop", amount: 8000, categoryId: groceriesId, paidByMemberId: bob, splitRule: { type: "EQUAL" }, isShared: true },
        // Personal, paid by Bob — still household money leaving a budgeted category.
        { householdId, date: day, label: "bob solo", amount: 5000, categoryId: groceriesId, paidByMemberId: bob, splitRule: { type: "SOLO", memberId: bob }, isShared: false },
      ],
    });

    const status = await getBudgetStatus(householdId, thisMonth);
    const groceries = status.rows.find((r) => r.categoryId === groceriesId)!;

    expect(groceries.spentCents).toBe(12000 + 8000 + 5000);
    expect(groceries.remainingCents).toBe(50000 - 25000);
    expect(groceries.usedPercent).toBeCloseTo(50, 5);
  });

  it("resets the spend next month while keeping the same limit", async () => {
    const next = await getBudgetStatus(householdId, nextMonth);
    const groceries = next.rows.find((r) => r.categoryId === groceriesId)!;

    expect(groceries.limitCents).toBe(50000);
    expect(groceries.spentCents).toBe(0);
    expect(groceries.remainingCents).toBe(50000);
    expect(groceries.usedPercent).toBe(0);
  });

  it("leaves earlier months reporting against the limit they were measured by", async () => {
    // Simulate "raised to 600 next month" by writing the later row directly;
    // setBudgetLimit itself can only write the current month.
    await prisma.budgetLimit.create({
      data: { householdId, categoryId: groceriesId, effectiveFrom: nextMonth, amount: 60000 },
    });

    const now = await getBudgetLimits(householdId, thisMonth);
    const later = await getBudgetLimits(householdId, nextMonth);
    const muchLater = await getBudgetLimits(householdId, addMonths(thisMonth, 5));

    // The change did not reach back.
    expect(now.find((l) => l.categoryId === groceriesId)!.limitCents).toBe(50000);
    expect(later.find((l) => l.categoryId === groceriesId)!.limitCents).toBe(60000);
    // And the newer row carries forward in turn.
    expect(muchLater.find((l) => l.categoryId === groceriesId)!.limitCents).toBe(60000);

    // This month's reported status still uses 500, not 600.
    const status = await getBudgetStatus(householdId, thisMonth);
    expect(status.rows.find((r) => r.categoryId === groceriesId)!.limitCents).toBe(50000);
  });

  it("overwrites rather than stacking when the same month is edited twice", async () => {
    await setBudgetLimit({ householdId, categoryId: eatingOutId, amount: 30000 });
    await setBudgetLimit({ householdId, categoryId: eatingOutId, amount: 35000 });

    const rows = await prisma.budgetLimit.findMany({ where: { categoryId: eatingOutId, effectiveFrom: thisMonth } });
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(35000);
  });

  it("treats clearing a limit as a real answer, not a missing one", async () => {
    const cleared = await setBudgetLimit({ householdId, categoryId: eatingOutId, amount: null });
    expect(cleared.ok).toBe(true);

    const limits = await getBudgetLimits(householdId, thisMonth);
    expect(limits.find((l) => l.categoryId === eatingOutId)!.limitCents).toBeNull();

    // An unlimited category drops out of the status rows entirely.
    const status = await getBudgetStatus(householdId, thisMonth);
    expect(status.rows.some((r) => r.categoryId === eatingOutId)).toBe(false);

    await setBudgetLimit({ householdId, categoryId: eatingOutId, amount: 30000 });
  });

  it("keeps spending in unlimited variable categories out of the totals", async () => {
    await setBudgetLimit({ householdId, categoryId: eatingOutId, amount: null });
    const day = new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth(), 6));
    await prisma.expense.create({
      data: { householdId, date: day, label: "dinner", amount: 4000, categoryId: eatingOutId, paidByMemberId: alice, splitRule: { type: "EQUAL" }, isShared: true },
    });

    const status = await getBudgetStatus(householdId, thisMonth);
    expect(status.totalLimitCents).toBe(50000); // groceries only
    expect(status.totalSpentCents).toBe(25000); // groceries only
    expect(status.unlimitedVariableCents).toBe(4000);
  });

  it("ignores fixed-category spending entirely", async () => {
    const day = new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth(), 2));
    await prisma.expense.create({
      data: { householdId, date: day, label: "rent", amount: 185000, categoryId: rentId, paidByMemberId: alice, splitRule: { type: "EQUAL" }, isShared: true },
    });

    const status = await getBudgetStatus(householdId, thisMonth);
    expect(status.rows.some((r) => r.categoryId === rentId)).toBe(false);
    // The big fixed expense moves none of the budget figures.
    expect(status.totalSpentCents).toBe(25000);
    expect(status.unlimitedVariableCents).toBe(4000);
  });

  it("reports an overspend as a negative remainder and over 100%", async () => {
    const day = new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth(), 7));
    await prisma.expense.create({
      data: { householdId, date: day, label: "big shop", amount: 40000, categoryId: groceriesId, paidByMemberId: bob, splitRule: { type: "EQUAL" }, isShared: true },
    });

    const status = await getBudgetStatus(householdId, thisMonth);
    const groceries = status.rows.find((r) => r.categoryId === groceriesId)!;
    expect(groceries.spentCents).toBe(65000);
    expect(groceries.remainingCents).toBe(-15000);
    expect(groceries.usedPercent).toBeCloseTo(130, 5);
  });
});
