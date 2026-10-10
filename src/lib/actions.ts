"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "./db";
import { monthStart, addMonths } from "./month";
import { buildStoredIncomeRatioSnapshot, computeExpenseShares, previewSettlement, type SplitRule } from "./splitting";
import { computeHouseholdBalancesMap } from "./queries";
import { findIncomeEditImpact, findSettlementImpact, type SettlementImpact } from "./income-impact";
import { materializeRecurringExpense, recurringExpensesDueForMonth } from "./recurring";
import {
  createExpenseSchema,
  updateExpenseSchema,
  createRecurringExpenseSchema,
  incomeRecordSchema,
  createMemberSchema,
  createSavingsGoalSchema,
  createSavingsContributionSchema,
  createSettlementSchema,
} from "./schemas";
import { z } from "zod";

async function membersAndIncomeFor(householdId: string) {
  const [members, incomeRecords] = await Promise.all([
    prisma.member.findMany({ where: { householdId } }),
    prisma.incomeRecord.findMany({ where: { member: { householdId } } }),
  ]);
  return {
    members: members.map((m) => ({ id: m.id, active: m.active })),
    incomeRecords: incomeRecords.map((r) => ({ memberId: r.memberId, month: r.month, netAmount: r.netAmount })),
  };
}

// --- Household / members -----------------------------------------------

// baseCurrency defaults to EUR, matching the fixed EUR/es-ES formatting
// everywhere in the UI (src/lib/money.ts) — the field is still a real
// schema column, but nothing reads it for display anymore, so exposing
// it as a user-editable choice would be misleading. See the actions.ts
// history / README for the full note on this.
export async function createHousehold(name: string, baseCurrency = "EUR") {
  const household = await prisma.household.create({ data: { name, baseCurrency } });
  revalidatePath("/");
  return household;
}

export async function createMember(input: z.infer<typeof createMemberSchema>) {
  const data = createMemberSchema.parse(input);
  const member = await prisma.member.create({
    data: { householdId: data.householdId, name: data.name, email: data.email || null },
  });
  revalidatePath(`/h/${data.householdId}`);
  return member;
}

export async function setMemberActive(memberId: string, householdId: string, active: boolean) {
  await prisma.member.update({ where: { id: memberId }, data: { active } });
  revalidatePath(`/h/${householdId}`);
}

export async function createCategory(householdId: string, name: string, kind: "FIXED" | "VARIABLE" | "SAVINGS") {
  const category = await prisma.category.create({ data: { householdId, name, kind } });
  revalidatePath(`/h/${householdId}`);
  return category;
}

// --- Expenses -------------------------------------------------------------

export async function createExpense(input: z.infer<typeof createExpenseSchema>) {
  const data = createExpenseSchema.parse(input);
  const { members, incomeRecords } = await membersAndIncomeFor(data.householdId);

  const shareResult = computeExpenseShares(data.amount, data.paidByMemberId, data.splitRule, members, incomeRecords, data.date);
  const storedSnapshot = buildStoredIncomeRatioSnapshot(shareResult);

  const expense = await prisma.expense.create({
    data: {
      householdId: data.householdId,
      date: data.date,
      label: data.label,
      amount: data.amount,
      categoryId: data.categoryId,
      paidByMemberId: data.paidByMemberId,
      splitRule: data.splitRule satisfies SplitRule,
      isShared: data.isShared,
      incomeRatioSnapshot: (storedSnapshot as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
      shares: { create: shareResult.shares.map((s) => ({ memberId: s.memberId, owedAmount: s.owedAmount })) },
    },
  });

  revalidatePath(`/h/${data.householdId}`);
  return expense;
}

export async function updateExpense(input: z.infer<typeof updateExpenseSchema>) {
  const data = updateExpenseSchema.parse(input);
  const { members, incomeRecords } = await membersAndIncomeFor(data.householdId);

  const shareResult = computeExpenseShares(data.amount, data.paidByMemberId, data.splitRule, members, incomeRecords, data.date);
  const storedSnapshot = buildStoredIncomeRatioSnapshot(shareResult);

  await prisma.$transaction([
    prisma.expenseShare.deleteMany({ where: { expenseId: data.id } }),
    prisma.expense.update({
      where: { id: data.id },
      data: {
        date: data.date,
        label: data.label,
        amount: data.amount,
        categoryId: data.categoryId,
        paidByMemberId: data.paidByMemberId,
        splitRule: data.splitRule satisfies SplitRule,
        isShared: data.isShared,
        incomeRatioSnapshot: (storedSnapshot as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
        shares: { create: shareResult.shares.map((s) => ({ memberId: s.memberId, owedAmount: s.owedAmount })) },
      },
    }),
  ]);

  revalidatePath(`/h/${data.householdId}`);
}

export async function deleteExpense(expenseId: string, householdId: string) {
  await prisma.expense.delete({ where: { id: expenseId } });
  revalidatePath(`/h/${householdId}`);
}

// --- Income -----------------------------------------------------------
//
// Editing a past month's income must not silently rewrite settled
// balances. getIncomeEditImpact is a read-only preview the client calls
// BEFORE submitting an edit to decide whether to show a confirmation
// dialog; saveIncomeRecord takes an explicit `recalculate` flag so the
// write only touches historical ExpenseShare rows when the user confirmed.

interface IncomeEditParams {
  householdId: string;
  memberId: string;
  month: Date;
  netAmount: number;
  recordId?: string;
}

async function proposedIncomeRecords(params: IncomeEditParams) {
  const all = await prisma.incomeRecord.findMany({ where: { member: { householdId: params.householdId } } });
  const month = monthStart(params.month);

  if (params.recordId) {
    return all.map((r) =>
      r.id === params.recordId ? { memberId: r.memberId, month: r.month, netAmount: params.netAmount } : { memberId: r.memberId, month: r.month, netAmount: r.netAmount }
    );
  }
  return [
    ...all.map((r) => ({ memberId: r.memberId, month: r.month, netAmount: r.netAmount })),
    { memberId: params.memberId, month, netAmount: params.netAmount },
  ];
}

export interface IncomeEditImpactResult {
  expenseImpact: Awaited<ReturnType<typeof findIncomeEditImpact>>;
  settlementImpact: SettlementImpact[];
}

export async function getIncomeEditImpact(params: IncomeEditParams): Promise<IncomeEditImpactResult> {
  const month = monthStart(params.month);
  const members = await prisma.member.findMany({ where: { householdId: params.householdId } });
  const proposed = await proposedIncomeRecords(params);

  // Every PROPORTIONAL expense dated on/after the edited month could be
  // relying on this month's ratio, directly or via the fallback-to-prior-
  // month rule.
  const candidates = await prisma.expense.findMany({
    where: { householdId: params.householdId, date: { gte: month } },
    include: { shares: true },
  });
  const proportional = candidates.filter((e) => (e.splitRule as SplitRule)?.type === "PROPORTIONAL");

  const expenseImpact = findIncomeEditImpact(
    proportional.map((e) => ({
      id: e.id,
      date: e.date,
      amountCents: e.amount,
      paidByMemberId: e.paidByMemberId,
      storedShares: e.shares.map((s) => ({ memberId: s.memberId, owedAmount: s.owedAmount })),
    })),
    members.map((m) => ({ id: m.id, active: m.active })),
    proposed
  );

  // Balances are global and cumulative across the WHOLE household (see
  // getBalances/computeBalances) — a settlement has no idea which
  // expense or month it was paying down. So checking for settlement
  // impact needs every shared expense's current shares, not just the
  // ones this particular edit flags, and every settlement ever recorded.
  let settlementImpact: SettlementImpact[] = [];
  if (expenseImpact.length > 0) {
    const [allExpenses, settlements] = await Promise.all([
      prisma.expense.findMany({ where: { householdId: params.householdId }, include: { shares: true } }),
      prisma.settlement.findMany({ where: { householdId: params.householdId } }),
    ]);

    const newSharesByExpenseId = new Map(expenseImpact.map((i) => [i.expenseId, i.newShares]));
    settlementImpact = findSettlementImpact(
      allExpenses.map((e) => ({
        id: e.id,
        paidByMemberId: e.paidByMemberId,
        isShared: e.isShared,
        shares: e.shares.map((s) => ({ memberId: s.memberId, owedAmount: s.owedAmount })),
      })),
      newSharesByExpenseId,
      settlements.map((s) => ({ fromMemberId: s.fromMemberId, toMemberId: s.toMemberId, amountCents: s.amount }))
    );
  }

  return { expenseImpact, settlementImpact };
}

export type SaveIncomeRecordResult = { ok: true; recalculatedCount: number } | { ok: false; error: string };

// Returns a typed result instead of throwing: Next.js redacts a thrown
// Error's message in production builds (by design, to avoid leaking
// internals), so a friendly "pick a different source" message would
// only have survived in `next dev`. Returning it instead means the
// unique-constraint violation reaches the UI the same way in both.
export async function saveIncomeRecord(
  input: z.infer<typeof incomeRecordSchema> & { householdId: string; recordId?: string; recalculate: boolean }
): Promise<SaveIncomeRecordResult> {
  const data = incomeRecordSchema.parse(input);
  const month = monthStart(data.month);

  const impact = input.recalculate
    ? (await getIncomeEditImpact({ householdId: input.householdId, memberId: data.memberId, month, netAmount: data.netAmount, recordId: input.recordId })).expenseImpact
    : [];

  try {
    if (input.recordId) {
      await prisma.incomeRecord.update({ where: { id: input.recordId }, data: { netAmount: data.netAmount, source: data.source } });
    } else {
      await prisma.incomeRecord.create({ data: { memberId: data.memberId, month, netAmount: data.netAmount, source: data.source } });
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return {
        ok: false,
        error: `This member already has an income record for this month with the source "${data.source ?? "General"}". Use a different source, or edit the existing entry instead of adding a new one.`,
      };
    }
    throw error;
  }

  if (impact.length > 0) {
    const { members, incomeRecords } = await membersAndIncomeFor(input.householdId);
    const expenses = await prisma.expense.findMany({ where: { id: { in: impact.map((i) => i.expenseId) } } });

    for (const expense of expenses) {
      const shareResult = computeExpenseShares(
        expense.amount,
        expense.paidByMemberId,
        expense.splitRule as SplitRule,
        members,
        incomeRecords,
        expense.date
      );
      const storedSnapshot = buildStoredIncomeRatioSnapshot(shareResult);
      await prisma.$transaction([
        prisma.expenseShare.deleteMany({ where: { expenseId: expense.id } }),
        prisma.expense.update({
          where: { id: expense.id },
          data: {
            incomeRatioSnapshot: (storedSnapshot as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
            shares: { create: shareResult.shares.map((s) => ({ memberId: s.memberId, owedAmount: s.owedAmount })) },
          },
        }),
      ]);
    }
  }

  revalidatePath(`/h/${input.householdId}`);
  return { ok: true, recalculatedCount: impact.length };
}

export async function copyLastMonthIncome(householdId: string, targetMonth: Date) {
  const target = monthStart(targetMonth);
  const previous = addMonths(target, -1);

  const previousRecords = await prisma.incomeRecord.findMany({ where: { member: { householdId }, month: previous } });
  const existingTarget = await prisma.incomeRecord.findMany({ where: { member: { householdId }, month: target } });
  // source is non-nullable (defaults to "General"), so this key is always
  // a real string on both sides — no more NULL-vs-NULL ambiguity to work around.
  const existingKeys = new Set(existingTarget.map((r) => `${r.memberId}|${r.source}`));

  const toCreate = previousRecords.filter((r) => !existingKeys.has(`${r.memberId}|${r.source}`));

  if (toCreate.length > 0) {
    await prisma.incomeRecord.createMany({
      data: toCreate.map((r) => ({ memberId: r.memberId, month: target, netAmount: r.netAmount, source: r.source })),
    });
  }

  revalidatePath(`/h/${householdId}`);
  return { copiedCount: toCreate.length };
}

// --- Recurring expenses -------------------------------------------------

export async function createRecurringExpense(input: z.infer<typeof createRecurringExpenseSchema>) {
  const data = createRecurringExpenseSchema.parse(input);
  const created = await prisma.recurringExpense.create({
    data: {
      householdId: data.householdId,
      categoryId: data.categoryId,
      label: data.label,
      amount: data.amount,
      dayOfMonth: data.dayOfMonth,
      startMonth: monthStart(data.startMonth),
      endMonth: data.endMonth ? monthStart(data.endMonth) : null,
      paidByMemberId: data.paidByMemberId,
      splitRule: data.splitRule satisfies SplitRule,
    },
  });
  revalidatePath(`/h/${data.householdId}`);
  return created;
}

export async function setRecurringExpenseActive(id: string, householdId: string, active: boolean) {
  await prisma.recurringExpense.update({ where: { id }, data: { active } });
  revalidatePath(`/h/${householdId}`);
}

/**
 * Idempotent: checks for an existing Expense per (recurringExpenseId,
 * generatedForMonth) before creating, and the same pair is also a DB
 * unique constraint as a safety net against concurrent double-clicks.
 */
export async function generateRecurringForMonth(householdId: string, targetMonth: Date) {
  const target = monthStart(targetMonth);
  const recurringRows = await prisma.recurringExpense.findMany({ where: { householdId } });
  const due = recurringExpensesDueForMonth(
    recurringRows.map((r) => ({
      id: r.id,
      categoryId: r.categoryId,
      label: r.label,
      amount: r.amount,
      dayOfMonth: r.dayOfMonth,
      startMonth: r.startMonth,
      endMonth: r.endMonth,
      paidByMemberId: r.paidByMemberId,
      splitRule: r.splitRule as SplitRule,
      active: r.active,
    })),
    target
  );

  const { members, incomeRecords } = await membersAndIncomeFor(householdId);
  let createdCount = 0;

  for (const recurring of due) {
    const existing = await prisma.expense.findFirst({
      where: { recurringExpenseId: recurring.id, generatedForMonth: target },
    });
    if (existing) continue;

    const draft = materializeRecurringExpense(recurring, target);
    const shareResult = computeExpenseShares(draft.amount, draft.paidByMemberId, draft.splitRule, members, incomeRecords, draft.date);
    const storedSnapshot = buildStoredIncomeRatioSnapshot(shareResult);

    try {
      await prisma.expense.create({
        data: {
          householdId,
          date: draft.date,
          label: draft.label,
          amount: draft.amount,
          categoryId: draft.categoryId,
          paidByMemberId: draft.paidByMemberId,
          splitRule: draft.splitRule satisfies SplitRule,
          isShared: draft.splitRule.type !== "SOLO",
          recurringExpenseId: draft.recurringExpenseId,
          generatedForMonth: draft.generatedForMonth,
          incomeRatioSnapshot: (storedSnapshot as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
          shares: { create: shareResult.shares.map((s) => ({ memberId: s.memberId, owedAmount: s.owedAmount })) },
        },
      });
      createdCount++;
    } catch (error) {
      // P2002 = unique constraint violation: another request already
      // generated this one between our check and our insert. Idempotency
      // is preserved either way — just don't double-create.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
  }

  revalidatePath(`/h/${householdId}`);
  return { createdCount, dueCount: due.length };
}

// --- Savings ------------------------------------------------------------

export async function createSavingsGoal(input: z.infer<typeof createSavingsGoalSchema>) {
  const data = createSavingsGoalSchema.parse(input);
  const goal = await prisma.savingsGoal.create({
    data: { householdId: data.householdId, name: data.name, targetAmount: data.targetAmount, targetDate: data.targetDate },
  });
  revalidatePath(`/h/${data.householdId}`);
  return goal;
}

export async function addSavingsContribution(householdId: string, input: z.infer<typeof createSavingsContributionSchema>) {
  const data = createSavingsContributionSchema.parse(input);
  const contribution = await prisma.savingsContribution.create({
    data: { goalId: data.goalId, memberId: data.memberId, month: monthStart(data.month), amount: data.amount, isJoint: data.isJoint },
  });
  revalidatePath(`/h/${householdId}`);
  return contribution;
}

// --- Settlements --------------------------------------------------------

// Read-only — computes what a proposed settlement WOULD do to both
// members' balances, without writing anything. "Overpayment" is never
// blocked, only flagged: the caller (the settlement form) decides
// whether to show a confirmation step before actually calling
// createSettlement with the same inputs.
export async function getSettlementPreview(householdId: string, fromMemberId: string, toMemberId: string, amountCents: number) {
  const balances = await computeHouseholdBalancesMap(householdId);
  return previewSettlement(balances, fromMemberId, toMemberId, amountCents);
}

export type CreateSettlementResult = { ok: true; settlementId: string } | { ok: false; error: string };

export async function createSettlement(
  input: z.infer<typeof createSettlementSchema>
): Promise<CreateSettlementResult> {
  const parsed = createSettlementSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settlement." };
  }
  const data = parsed.data;

  const settlement = await prisma.settlement.create({
    data: {
      householdId: data.householdId,
      fromMemberId: data.fromMemberId,
      toMemberId: data.toMemberId,
      amount: data.amount,
      date: data.date,
      note: data.note,
    },
  });
  revalidatePath(`/h/${data.householdId}`);
  return { ok: true, settlementId: settlement.id };
}

export async function deleteSettlement(settlementId: string, householdId: string) {
  // Balances are always recomputed fresh from every Settlement +
  // ExpenseShare row (see computeBalances) — nothing caches or derives
  // a stored balance, so deleting this row restores the prior balance
  // exactly, by construction, with no separate "undo" logic needed.
  await prisma.settlement.delete({ where: { id: settlementId } });
  revalidatePath(`/h/${householdId}`);
}
