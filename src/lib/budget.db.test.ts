// Integration test against a REAL database — requires DATABASE_URL to
// point at a reachable Postgres with the schema migrated. Not part of
// `npm test` (which stays DB-free); run explicitly with `npm run test:db`.
//
// Covers the two things about budgets that are easy to get subtly wrong:
// the no-row/zero distinction (an unbudgeted category is not a category
// budgeted at zero), and keeping spending that falls outside the plan out
// of the plan's own totals — otherwise leaving a category unbudgeted would
// make a month look on-budget.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// The actions call revalidatePath, which throws outside a Next request
// context. Nothing here asserts on cache invalidation, so stub it.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "./db";
import { getBudgetPlan } from "./queries";
import { setBudget, clearBudget, copyLastMonthBudget } from "./actions";
import { monthStart, addMonths } from "./month";

describe("budget plan (real DB)", () => {
  let householdId: string;
  let memberId: string;
  let groceriesId: string;
  let eatingOutId: string;
  let clothingId: string;
  const month = monthStart(new Date(Date.UTC(2031, 4, 1)));
  const prevMonth = addMonths(month, -1);

  beforeAll(async () => {
    const household = await prisma.household.create({ data: { name: "__test__ budget plan" } });
    householdId = household.id;

    const member = await prisma.member.create({ data: { householdId, name: "Payer" } });
    memberId = member.id;

    const [groceries, eatingOut, clothing] = await Promise.all([
      prisma.category.create({ data: { householdId, name: "Groceries", kind: "VARIABLE" } }),
      prisma.category.create({ data: { householdId, name: "Eating Out", kind: "VARIABLE" } }),
      prisma.category.create({ data: { householdId, name: "Clothing", kind: "VARIABLE" } }),
    ]);
    groceriesId = groceries.id;
    eatingOutId = eatingOut.id;
    clothingId = clothing.id;

    // 420 on groceries (under a 500 budget), 355 on eating out (over a
    // 300 budget), 60 on clothing (budgeted 0), 90 with no category.
    await prisma.expense.createMany({
      data: [
        { householdId, date: month, label: "g", amount: 42000, categoryId: groceriesId, paidByMemberId: memberId, splitRule: { type: "SOLO", memberId }, isShared: false },
        { householdId, date: month, label: "e", amount: 35500, categoryId: eatingOutId, paidByMemberId: memberId, splitRule: { type: "SOLO", memberId }, isShared: false },
        { householdId, date: month, label: "c", amount: 6000, categoryId: clothingId, paidByMemberId: memberId, splitRule: { type: "SOLO", memberId }, isShared: false },
        { householdId, date: month, label: "u", amount: 9000, paidByMemberId: memberId, splitRule: { type: "SOLO", memberId }, isShared: false },
      ],
    });
  });

  afterAll(async () => {
    await prisma.household.delete({ where: { id: householdId } });
  });

  it("reports every category as unbudgeted before any budget is set", async () => {
    const plan = await getBudgetPlan(householdId, month);
    expect(plan.rows).toHaveLength(3);
    expect(plan.rows.every((r) => r.budgetedCents === null)).toBe(true);
    expect(plan.rows.every((r) => r.remainingCents === null && r.usedPercent === null)).toBe(true);
    expect(plan.totalBudgetedCents).toBe(0);
    // Nothing is in the plan yet, so all spending is outside it.
    expect(plan.totalActualCents).toBe(0);
    expect(plan.unbudgetedActualCents).toBe(42000 + 35500 + 6000);
    expect(plan.uncategorizedActualCents).toBe(9000);
  });

  it("tracks remaining and percentage used, including an overspend", async () => {
    await setBudget({ householdId, categoryId: groceriesId, month, amount: 50000 });
    await setBudget({ householdId, categoryId: eatingOutId, month, amount: 30000 });

    const plan = await getBudgetPlan(householdId, month);
    const groceries = plan.rows.find((r) => r.categoryId === groceriesId)!;
    const eatingOut = plan.rows.find((r) => r.categoryId === eatingOutId)!;

    expect(groceries.remainingCents).toBe(8000);
    expect(groceries.usedPercent).toBeCloseTo(84, 5);

    // Over budget reads as a negative remainder and >100%, not a clamp.
    expect(eatingOut.remainingCents).toBe(-5500);
    expect(eatingOut.usedPercent).toBeCloseTo(118.33, 1);
  });

  it("treats a zero budget with spending as 100% used, not 0%", async () => {
    await setBudget({ householdId, categoryId: clothingId, month, amount: 0 });

    const plan = await getBudgetPlan(householdId, month);
    const clothing = plan.rows.find((r) => r.categoryId === clothingId)!;

    expect(clothing.budgetedCents).toBe(0);
    expect(clothing.usedPercent).toBe(100);
    expect(clothing.remainingCents).toBe(-6000);
  });

  it("keeps out-of-plan spending out of the plan's totals", async () => {
    const plan = await getBudgetPlan(householdId, month);

    expect(plan.totalBudgetedCents).toBe(50000 + 30000 + 0);
    expect(plan.totalActualCents).toBe(42000 + 35500 + 6000);
    // Uncategorized spending never counts against a category budget.
    expect(plan.uncategorizedActualCents).toBe(9000);
    expect(plan.unbudgetedActualCents).toBe(0);
  });

  it("distinguishes clearing a budget from setting it to zero", async () => {
    await clearBudget(householdId, clothingId, month);

    const plan = await getBudgetPlan(householdId, month);
    const clothing = plan.rows.find((r) => r.categoryId === clothingId)!;

    expect(clothing.budgetedCents).toBeNull();
    // Its spending moves out of the plan rather than vanishing.
    expect(plan.unbudgetedActualCents).toBe(6000);
    expect(plan.totalActualCents).toBe(42000 + 35500);

    await setBudget({ householdId, categoryId: clothingId, month, amount: 0 });
  });

  it("upserts rather than duplicating when the same category is set twice", async () => {
    await setBudget({ householdId, categoryId: groceriesId, month, amount: 50000 });
    await setBudget({ householdId, categoryId: groceriesId, month, amount: 55000 });

    const rows = await prisma.budget.findMany({ where: { householdId, categoryId: groceriesId, month } });
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(55000);

    await setBudget({ householdId, categoryId: groceriesId, month, amount: 50000 });
  });

  it("refuses to budget a category belonging to another household", async () => {
    const other = await prisma.household.create({ data: { name: "__test__ budget other" } });
    try {
      const result = await setBudget({ householdId: other.id, categoryId: groceriesId, month, amount: 12345 });
      expect(result.ok).toBe(false);
      expect(await prisma.budget.count({ where: { householdId: other.id } })).toBe(0);
      // The real household's own budget is untouched.
      const rows = await prisma.budget.findMany({ where: { categoryId: groceriesId, month } });
      expect(rows[0].amount).toBe(50000);
    } finally {
      await prisma.household.delete({ where: { id: other.id } });
    }
  });

  it("copies last month's budget without overwriting amounts already set", async () => {
    await setBudget({ householdId, categoryId: groceriesId, month: prevMonth, amount: 44400 });
    await prisma.budget.deleteMany({ where: { householdId, categoryId: clothingId, month } });
    await setBudget({ householdId, categoryId: clothingId, month: prevMonth, amount: 11100 });

    const result = await copyLastMonthBudget(householdId, month);
    expect(result).toEqual({ copiedCount: 1, skippedCount: 1 });

    const plan = await getBudgetPlan(householdId, month);
    // Groceries keeps this month's own 500 rather than the prior 444.
    expect(plan.rows.find((r) => r.categoryId === groceriesId)!.budgetedCents).toBe(50000);
    expect(plan.rows.find((r) => r.categoryId === clothingId)!.budgetedCents).toBe(11100);
    expect(plan.previousMonthBudgetCount).toBe(2);

    // Running it again changes nothing.
    expect(await copyLastMonthBudget(householdId, month)).toEqual({ copiedCount: 0, skippedCount: 2 });
  });
});
