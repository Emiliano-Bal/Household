// Integration test against a REAL database. Run with `npm run test:db`.
//
// Editing money that has already been split is the riskiest write in the
// app: shares have to be recomputed from the ratio in effect on the
// expense's DATE, and the balance has to move by exactly the delta and
// not a cent more.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "./db";
import { updateExpense, deleteExpense, getExpenseChangeImpact, createSettlement, deleteRecurringExpense, generateRecurringForMonth } from "./actions";
import { getBalances } from "./queries";
import { monthStart } from "./month";

const balanceOf = async (householdId: string, memberId: string) =>
  (await getBalances(householdId)).byMember.find((b) => b.memberId === memberId)!.balanceCents;

describe("editing and deleting expenses (real DB)", () => {
  let householdId: string;
  let alice: string;
  let bob: string;
  let categoryId: string;

  const month = monthStart(new Date(Date.UTC(2028, 3, 1))); // April 2028
  const day = new Date(Date.UTC(2028, 3, 10));

  beforeAll(async () => {
    const household = await prisma.household.create({ data: { name: "__test__ expense edit" } });
    householdId = household.id;

    const [a, b] = await Promise.all([
      prisma.member.create({ data: { householdId, name: "Alice" } }),
      prisma.member.create({ data: { householdId, name: "Bob" } }),
    ]);
    alice = a.id;
    bob = b.id;

    const category = await prisma.category.create({ data: { householdId, name: "Groceries", kind: "VARIABLE" } });
    categoryId = category.id;

    // Equal incomes, so a PROPORTIONAL split is 50/50 and the arithmetic
    // below is easy to state exactly.
    await prisma.incomeRecord.createMany({
      data: [
        { memberId: alice, month, netAmount: 200000, source: "Salary" },
        { memberId: bob, month, netAmount: 200000, source: "Salary" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.household.delete({ where: { id: householdId } });
  });

  it("recomputes shares and moves the balance by exactly the delta", async () => {
    const created = await prisma.expense.create({
      data: {
        householdId,
        date: day,
        label: "Shop",
        amount: 10000, // 100.00, paid by Alice, split equally
        categoryId,
        paidByMemberId: alice,
        splitRule: { type: "EQUAL" },
        isShared: true,
        shares: { create: [{ memberId: alice, owedAmount: 5000 }, { memberId: bob, owedAmount: 5000 }] },
      },
    });

    // Alice paid 100 and owes 50, so she is owed 50; Bob owes 50.
    expect(await balanceOf(householdId, alice)).toBe(5000);
    expect(await balanceOf(householdId, bob)).toBe(-5000);

    await updateExpense({
      id: created.id,
      householdId,
      date: day,
      label: "Shop",
      amount: 16000, // 100.00 -> 160.00
      categoryId,
      paidByMemberId: alice,
      splitRule: { type: "EQUAL" },
      isShared: true,
    });

    // Shares were rewritten, not left stale, and still sum to the amount.
    const shares = await prisma.expenseShare.findMany({ where: { expenseId: created.id } });
    expect(shares).toHaveLength(2);
    expect(shares.reduce((sum, s) => sum + s.owedAmount, 0)).toBe(16000);
    for (const s of shares) expect(s.owedAmount).toBe(8000);

    // The delta is +60.00 on the amount, so Alice's balance moves by
    // exactly half of it — +30.00 — and Bob's by the mirror.
    expect(await balanceOf(householdId, alice)).toBe(8000);
    expect(await balanceOf(householdId, bob)).toBe(-8000);
    expect(8000 - 5000).toBe(3000);

    await prisma.expense.delete({ where: { id: created.id } });
  });

  it("reprices by the ratio in effect on the new date when an expense moves month", async () => {
    // May: Alice earns three times Bob, so a proportional split is 75/25.
    const may = monthStart(new Date(Date.UTC(2028, 4, 1)));
    await prisma.incomeRecord.createMany({
      data: [
        { memberId: alice, month: may, netAmount: 300000, source: "Salary" },
        { memberId: bob, month: may, netAmount: 100000, source: "Salary" },
      ],
    });

    const created = await prisma.expense.create({
      data: {
        householdId,
        date: day, // April, where incomes are equal
        label: "Movable",
        amount: 10000,
        categoryId,
        paidByMemberId: alice,
        splitRule: { type: "PROPORTIONAL" },
        isShared: true,
        shares: { create: [{ memberId: alice, owedAmount: 5000 }, { memberId: bob, owedAmount: 5000 }] },
      },
    });

    await updateExpense({
      id: created.id,
      householdId,
      date: new Date(Date.UTC(2028, 4, 10)), // moved into May
      label: "Movable",
      amount: 10000,
      categoryId,
      paidByMemberId: alice,
      splitRule: { type: "PROPORTIONAL" },
      isShared: true,
    });

    const shares = await prisma.expenseShare.findMany({ where: { expenseId: created.id } });
    const byMember = new Map(shares.map((s) => [s.memberId, s.owedAmount]));
    // Priced by May's 75/25, not April's 50/50.
    expect(byMember.get(alice)).toBe(7500);
    expect(byMember.get(bob)).toBe(2500);

    await prisma.expense.delete({ where: { id: created.id } });
    await prisma.incomeRecord.deleteMany({ where: { month: may, memberId: { in: [alice, bob] } } });
  });

  it("warns with real before/after figures when the period is settled", async () => {
    const created = await prisma.expense.create({
      data: {
        householdId,
        date: day,
        label: "Settled shop",
        amount: 10000,
        categoryId,
        paidByMemberId: alice,
        splitRule: { type: "EQUAL" },
        isShared: true,
        shares: { create: [{ memberId: alice, owedAmount: 5000 }, { memberId: bob, owedAmount: 5000 }] },
      },
    });

    // Bob settles his 50 with Alice — now real money has moved.
    await createSettlement({ householdId, fromMemberId: bob, toMemberId: alice, amount: 5000 });
    expect(await balanceOf(householdId, alice)).toBe(0);
    expect(await balanceOf(householdId, bob)).toBe(0);

    const impact = await getExpenseChangeImpact({
      householdId,
      expenseId: created.id,
      proposed: { amount: 20000, date: day, paidByMemberId: alice, splitRule: { type: "EQUAL" }, isShared: true },
    });

    expect(impact).toHaveLength(2);
    const aliceImpact = impact.find((i) => i.memberId === alice)!;
    expect(aliceImpact.memberName).toBe("Alice");
    // Settled at 0; doubling the expense leaves Alice owed another 50.
    expect(aliceImpact.balanceBeforeCents).toBe(0);
    expect(aliceImpact.balanceAfterCents).toBe(5000);
    expect(aliceImpact.relatedSettlementsCents).toBe(5000);

    // Deletion is previewed the same way, with proposed: null.
    const deletionImpact = await getExpenseChangeImpact({ householdId, expenseId: created.id, proposed: null });
    expect(deletionImpact).toHaveLength(2);
    expect(deletionImpact.find((i) => i.memberId === bob)!.balanceAfterCents).toBe(5000);

    // And the warning is only a warning — the write still goes through.
    await updateExpense({
      id: created.id,
      householdId,
      date: day,
      label: "Settled shop",
      amount: 20000,
      categoryId,
      paidByMemberId: alice,
      splitRule: { type: "EQUAL" },
      isShared: true,
    });
    expect(await balanceOf(householdId, alice)).toBe(5000);

    await prisma.expense.delete({ where: { id: created.id } });
    await prisma.settlement.deleteMany({ where: { householdId } });
  });

  it("reports no impact when nothing has been settled", async () => {
    const created = await prisma.expense.create({
      data: {
        householdId,
        date: day,
        label: "Unsettled",
        amount: 10000,
        categoryId,
        paidByMemberId: alice,
        splitRule: { type: "EQUAL" },
        isShared: true,
        shares: { create: [{ memberId: alice, owedAmount: 5000 }, { memberId: bob, owedAmount: 5000 }] },
      },
    });

    const impact = await getExpenseChangeImpact({ householdId, expenseId: created.id, proposed: null });
    expect(impact).toEqual([]);

    await prisma.expense.delete({ where: { id: created.id } });
  });

  it("deletes an expense and its shares, and refuses another household's", async () => {
    const created = await prisma.expense.create({
      data: {
        householdId,
        date: day,
        label: "Doomed",
        amount: 4000,
        categoryId,
        paidByMemberId: bob,
        splitRule: { type: "EQUAL" },
        isShared: true,
        shares: { create: [{ memberId: alice, owedAmount: 2000 }, { memberId: bob, owedAmount: 2000 }] },
      },
    });

    const other = await prisma.household.create({ data: { name: "__test__ expense edit other" } });
    try {
      const refused = await deleteExpense(created.id, other.id);
      expect(refused.ok).toBe(false);
      expect(await prisma.expense.count({ where: { id: created.id } })).toBe(1);
    } finally {
      await prisma.household.delete({ where: { id: other.id } });
    }

    const ok = await deleteExpense(created.id, householdId);
    expect(ok.ok).toBe(true);
    expect(await prisma.expense.count({ where: { id: created.id } })).toBe(0);
    expect(await prisma.expenseShare.count({ where: { expenseId: created.id } })).toBe(0);
  });
});

describe("deleting a recurring rule (real DB)", () => {
  let householdId: string;
  let memberId: string;
  let categoryId: string;
  const march = monthStart(new Date(Date.UTC(2028, 2, 1)));

  beforeAll(async () => {
    const household = await prisma.household.create({ data: { name: "__test__ recurring delete" } });
    householdId = household.id;
    const member = await prisma.member.create({ data: { householdId, name: "Payer" } });
    memberId = member.id;
    const category = await prisma.category.create({ data: { householdId, name: "Bills", kind: "FIXED" } });
    categoryId = category.id;
    await prisma.incomeRecord.create({ data: { memberId, month: march, netAmount: 300000, source: "Salary" } });
  });

  afterAll(async () => {
    await prisma.household.delete({ where: { id: householdId } });
  });

  it("keeps already-generated expenses by default", async () => {
    const rule = await prisma.recurringExpense.create({
      data: {
        householdId,
        categoryId,
        label: "Monthly bill",
        amount: 5000,
        frequency: "MONTHLY",
        interval: 1,
        dayOfMonth: 5,
        startMonth: march,
        paidByMemberId: memberId,
        splitRule: { type: "SOLO", memberId },
      },
    });
    await generateRecurringForMonth(householdId, march);
    expect(await prisma.expense.count({ where: { recurringExpenseId: rule.id } })).toBe(1);

    const balanceBefore = await balanceOf(householdId, memberId);

    const result = await deleteRecurringExpense(rule.id, householdId);
    expect(result).toMatchObject({ ok: true, keptCount: 1, deletedCount: 0 });

    // The rule is gone...
    expect(await prisma.recurringExpense.count({ where: { id: rule.id } })).toBe(0);
    // ...and the expense it created is still there, just detached.
    const kept = await prisma.expense.findFirstOrThrow({ where: { householdId, label: "Monthly bill" } });
    expect(kept.recurringExpenseId).toBeNull();
    expect(kept.amount).toBe(5000);
    // Its shares survive too, so balances do not shift.
    expect(await prisma.expenseShare.count({ where: { expenseId: kept.id } })).toBeGreaterThan(0);
    expect(await balanceOf(householdId, memberId)).toBe(balanceBefore);

    await prisma.expense.delete({ where: { id: kept.id } });
  });

  it("removes them only on the explicit opt-out", async () => {
    const rule = await prisma.recurringExpense.create({
      data: {
        householdId,
        categoryId,
        label: "Doomed bill",
        amount: 7000,
        frequency: "MONTHLY",
        interval: 1,
        dayOfMonth: 6,
        startMonth: march,
        paidByMemberId: memberId,
        splitRule: { type: "SOLO", memberId },
      },
    });
    await generateRecurringForMonth(householdId, march);
    expect(await prisma.expense.count({ where: { recurringExpenseId: rule.id } })).toBe(1);

    const result = await deleteRecurringExpense(rule.id, householdId, { alsoDeleteGenerated: true });
    expect(result).toMatchObject({ ok: true, keptCount: 0, deletedCount: 1 });
    expect(await prisma.expense.count({ where: { householdId, label: "Doomed bill" } })).toBe(0);
  });

  it("refuses a rule from another household", async () => {
    const rule = await prisma.recurringExpense.create({
      data: {
        householdId,
        categoryId,
        label: "Safe",
        amount: 1000,
        frequency: "MONTHLY",
        interval: 1,
        dayOfMonth: 7,
        startMonth: march,
        paidByMemberId: memberId,
        splitRule: { type: "SOLO", memberId },
      },
    });
    const other = await prisma.household.create({ data: { name: "__test__ recurring delete other" } });
    try {
      const refused = await deleteRecurringExpense(rule.id, other.id);
      expect(refused.ok).toBe(false);
      expect(await prisma.recurringExpense.count({ where: { id: rule.id } })).toBe(1);
    } finally {
      await prisma.household.delete({ where: { id: other.id } });
      await prisma.recurringExpense.delete({ where: { id: rule.id } });
    }
  });
});
