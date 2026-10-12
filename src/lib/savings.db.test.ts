// Integration test against a REAL database. Run with `npm run test:db`.
//
// Savings is income minus everything that went out, and goal
// contributions are part of "went out" — money committed to a goal is
// gone from the month's leftover. The thing worth pinning down is that a
// contribution is counted exactly once: SavingsContribution rows and
// SAVINGS-category Expense rows are independent records written by
// different code paths, and neither creates the other.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "./db";
import { getDashboardData } from "./queries";
import { monthStart } from "./month";

describe("savings = income − expenses (real DB)", () => {
  let householdId: string;
  let alice: string;
  let bob: string;
  let variableId: string;
  let fixedId: string;
  let savingsCategoryId: string;
  let goalId: string;

  const month = monthStart(new Date(Date.UTC(2027, 6, 1))); // July 2027

  beforeAll(async () => {
    const household = await prisma.household.create({ data: { name: "__test__ savings formula" } });
    householdId = household.id;

    const [a, b] = await Promise.all([
      prisma.member.create({ data: { householdId, name: "Alice" } }),
      prisma.member.create({ data: { householdId, name: "Bob" } }),
    ]);
    alice = a.id;
    bob = b.id;

    const [variable, fixed, savingsCat, goal] = await Promise.all([
      prisma.category.create({ data: { householdId, name: "Groceries", kind: "VARIABLE" } }),
      prisma.category.create({ data: { householdId, name: "Rent", kind: "FIXED" } }),
      prisma.category.create({ data: { householdId, name: "Savings pot", kind: "SAVINGS" } }),
      prisma.savingsGoal.create({ data: { householdId, name: "Holiday", targetAmount: 500000 } }),
    ]);
    variableId = variable.id;
    fixedId = fixed.id;
    savingsCategoryId = savingsCat.id;
    goalId = goal.id;

    // Income 3000 + 2000 = 5000.
    await prisma.incomeRecord.createMany({
      data: [
        { memberId: alice, month, netAmount: 300000, source: "Salary" },
        { memberId: bob, month, netAmount: 200000, source: "Salary" },
      ],
    });

    const day = new Date(Date.UTC(2027, 6, 10));
    // 1200 fixed + 800 variable, paid by both members.
    await prisma.expense.createMany({
      data: [
        { householdId, date: day, label: "rent", amount: 120000, categoryId: fixedId, paidByMemberId: alice, splitRule: { type: "EQUAL" }, isShared: true },
        { householdId, date: day, label: "shop", amount: 50000, categoryId: variableId, paidByMemberId: bob, splitRule: { type: "EQUAL" }, isShared: true },
        { householdId, date: day, label: "shop 2", amount: 30000, categoryId: variableId, paidByMemberId: alice, splitRule: { type: "EQUAL" }, isShared: true },
      ],
    });
  });

  afterAll(async () => {
    await prisma.household.delete({ where: { id: householdId } });
  });

  it("subtracts every expense from income before any contribution exists", async () => {
    const d = await getDashboardData(householdId, month);

    expect(d.totalIncomeCents).toBe(500000);
    expect(d.fixedCents).toBe(120000);
    expect(d.variableCents).toBe(80000);
    expect(d.savingsCents).toBe(0);
    expect(d.goalContributionsCents).toBe(0);
    expect(d.totalExpensesCents).toBe(200000);
    expect(d.actualSavingsCents).toBe(300000);
    expect(d.savingsRatePercent).toBeCloseTo(60, 5);
  });

  it("counts a goal contribution as an expense, reducing the leftover", async () => {
    await prisma.savingsContribution.create({
      data: { goalId, memberId: alice, month, amount: 100000, isJoint: false },
    });

    const d = await getDashboardData(householdId, month);

    expect(d.goalContributionsCents).toBe(100000);
    expect(d.totalExpensesCents).toBe(300000); // 1200 + 800 + 1000
    expect(d.actualSavingsCents).toBe(200000); // 5000 − 3000
    expect(d.savingsRatePercent).toBeCloseTo(40, 5);
  });

  it("counts a contribution exactly once, not once per member and not twice", async () => {
    // A second contribution from the other member to the same goal.
    await prisma.savingsContribution.create({
      data: { goalId, memberId: bob, month, amount: 50000, isJoint: false },
    });

    const d = await getDashboardData(householdId, month);
    const rows = await prisma.savingsContribution.findMany({ where: { goal: { householdId }, month } });

    // The aggregate equals the sum of the rows — no path adds them twice.
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBe(150000);
    expect(d.goalContributionsCents).toBe(150000);
    expect(d.actualSavingsCents).toBe(500000 - 200000 - 150000);
  });

  it("keeps SAVINGS-category expenses separate from goal contributions", async () => {
    // These are different records written by different code paths; adding
    // one must not move the other.
    const before = await getDashboardData(householdId, month);

    await prisma.expense.create({
      data: {
        householdId,
        date: new Date(Date.UTC(2027, 6, 12)),
        label: "transfer to pot",
        amount: 25000,
        categoryId: savingsCategoryId,
        paidByMemberId: alice,
        splitRule: { type: "EQUAL" },
        isShared: true,
      },
    });

    const after = await getDashboardData(householdId, month);

    expect(after.savingsCents).toBe(25000);
    // The contribution total is untouched by the expense.
    expect(after.goalContributionsCents).toBe(before.goalContributionsCents);
    // And both reduce the leftover, each exactly once.
    expect(after.totalExpensesCents).toBe(before.totalExpensesCents + 25000);
    expect(after.actualSavingsCents).toBe(before.actualSavingsCents - 25000);
  });

  it("reports a negative figure when the household overspends, without clamping", async () => {
    await prisma.expense.create({
      data: {
        householdId,
        date: new Date(Date.UTC(2027, 6, 20)),
        label: "emergency",
        amount: 400000,
        categoryId: variableId,
        paidByMemberId: bob,
        splitRule: { type: "EQUAL" },
        isShared: true,
      },
    });

    const d = await getDashboardData(householdId, month);

    expect(d.totalExpensesCents).toBeGreaterThan(d.totalIncomeCents);
    expect(d.actualSavingsCents).toBeLessThan(0);
    expect(d.actualSavingsCents).toBe(d.totalIncomeCents - d.totalExpensesCents);
    expect(d.savingsRatePercent).toBeLessThan(0);
    expect(d.overspend).toBe(true);
    // leftoverCents is the same number, not a separately clamped one.
    expect(d.leftoverCents).toBe(d.actualSavingsCents);
  });

  it("carries prior-month income forward rather than reporting a zero month", async () => {
    // August has no income records, but computeIncomeShares falls back to
    // the most recent month that does — so income is July's, not zero.
    const august = monthStart(new Date(Date.UTC(2027, 7, 1)));
    const d = await getDashboardData(householdId, august);

    expect(d.totalIncomeCents).toBe(500000);
    // No August spending, so the whole carried-forward income is leftover.
    expect(d.actualSavingsCents).toBe(500000);
    expect(d.savingsRatePercent).toBeCloseTo(100, 5);
  });

  it("has no rate to report for a household that has never had income", async () => {
    const other = await prisma.household.create({ data: { name: "__test__ savings no income" } });
    try {
      const m = await prisma.member.create({ data: { householdId: other.id, name: "Dave" } });
      const cat = await prisma.category.create({ data: { householdId: other.id, name: "Bits", kind: "VARIABLE" } });
      await prisma.expense.create({
        data: {
          householdId: other.id,
          date: new Date(Date.UTC(2027, 6, 5)),
          label: "x",
          amount: 1000,
          categoryId: cat.id,
          paidByMemberId: m.id,
          splitRule: { type: "SOLO", memberId: m.id },
          isShared: false,
        },
      });

      const d = await getDashboardData(other.id, month);
      expect(d.totalIncomeCents).toBe(0);
      // Dividing by zero income would be meaningless, so there is no rate.
      expect(d.savingsRatePercent).toBeNull();
      // The spend still shows as a negative balance, not a swallowed zero.
      expect(d.actualSavingsCents).toBe(-1000);
    } finally {
      await prisma.household.delete({ where: { id: other.id } });
    }
  });

  it("ignores contributions belonging to another household", async () => {
    const other = await prisma.household.create({ data: { name: "__test__ savings other" } });
    try {
      const m = await prisma.member.create({ data: { householdId: other.id, name: "Carol" } });
      const g = await prisma.savingsGoal.create({ data: { householdId: other.id, name: "Car", targetAmount: 100000 } });
      await prisma.savingsContribution.create({ data: { goalId: g.id, memberId: m.id, month, amount: 999999, isJoint: false } });

      const d = await getDashboardData(householdId, month);
      expect(d.goalContributionsCents).toBe(150000); // unchanged
    } finally {
      await prisma.household.delete({ where: { id: other.id } });
    }
  });
});
