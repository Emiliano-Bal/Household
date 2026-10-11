import Decimal from "decimal.js";
import type { CategoryKind } from "@prisma/client";
import { prisma } from "./db";
import { computeBalances, computeIncomeShares, simplifySettlements, type SplitRule } from "./splitting";
import { monthStart, addMonths } from "./month";

export async function listHouseholds() {
  return prisma.household.findMany({ orderBy: { name: "asc" } });
}

export async function getHousehold(householdId: string) {
  return prisma.household.findUnique({
    where: { id: householdId },
    include: { members: { orderBy: { name: "asc" } } },
  });
}

export async function listCategories(householdId: string) {
  return prisma.category.findMany({ where: { householdId }, orderBy: { name: "asc" } });
}

export interface ExpenseFilters {
  month?: Date;
  categoryId?: string;
  paidByMemberId?: string;
  shared?: "all" | "shared" | "personal";
}

export async function listExpenses(householdId: string, filters: ExpenseFilters = {}) {
  const where: Record<string, unknown> = { householdId };

  if (filters.month) {
    const start = monthStart(filters.month);
    const end = addMonths(start, 1);
    where.date = { gte: start, lt: end };
  }
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.paidByMemberId) where.paidByMemberId = filters.paidByMemberId;
  if (filters.shared === "shared") where.isShared = true;
  if (filters.shared === "personal") where.isShared = false;

  return prisma.expense.findMany({
    where,
    include: { category: true, paidBy: true, shares: { include: { member: true } } },
    orderBy: { date: "desc" },
  });
}

export async function getExpense(expenseId: string) {
  return prisma.expense.findUnique({
    where: { id: expenseId },
    include: { category: true, paidBy: true, shares: { include: { member: true } } },
  });
}

export async function listRecurringExpenses(householdId: string) {
  return prisma.recurringExpense.findMany({
    where: { householdId },
    include: { category: true, paidBy: true },
    orderBy: { label: "asc" },
  });
}

export async function listIncomeForMonth(householdId: string, month: Date) {
  const start = monthStart(month);
  const end = addMonths(start, 1);
  return prisma.incomeRecord.findMany({
    where: { member: { householdId }, month: { gte: start, lt: end } },
    include: { member: true },
    orderBy: [{ member: { name: "asc" } }],
  });
}

/** All income records up to and including `month`, for fallback resolution. */
export async function listIncomeUpTo(householdId: string, month: Date) {
  const end = addMonths(monthStart(month), 1);
  return prisma.incomeRecord.findMany({
    where: { member: { householdId }, month: { lt: end } },
    include: { member: true },
  });
}

export async function listSavingsGoals(householdId: string) {
  return prisma.savingsGoal.findMany({
    where: { householdId },
    include: { contributions: { include: { member: true }, orderBy: { month: "desc" } } },
    orderBy: { name: "asc" },
  });
}

export async function listSettlements(householdId: string) {
  return prisma.settlement.findMany({
    where: { householdId },
    include: { fromMember: true, toMember: true },
    orderBy: { date: "desc" },
  });
}

/**
 * Pairwise balances derived from every shared expense's already-stored
 * ExpenseShare rows plus recorded settlements — never recomputes split
 * ratios, and never reads Settlement rows into spending reports (only
 * here, for balances).
 */
// Exported separately from getBalances (which formats it with names) so
// actions.ts can get the raw Map for previewSettlement without a second,
// differently-shaped implementation of the same balance computation.
export async function computeHouseholdBalancesMap(householdId: string) {
  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: { householdId },
      select: { id: true, paidByMemberId: true, isShared: true, shares: { select: { memberId: true, owedAmount: true } } },
    }),
    prisma.settlement.findMany({ where: { householdId }, select: { fromMemberId: true, toMemberId: true, amount: true } }),
  ]);

  return computeBalances(
    expenses.map((e) => ({ id: e.id, paidByMemberId: e.paidByMemberId, isShared: e.isShared, shares: e.shares })),
    settlements.map((s) => ({ fromMemberId: s.fromMemberId, toMemberId: s.toMemberId, amountCents: s.amount }))
  );
}

export async function getBalances(householdId: string) {
  const [balances, members] = await Promise.all([
    computeHouseholdBalancesMap(householdId),
    prisma.member.findMany({ where: { householdId }, select: { id: true, name: true } }),
  ]);

  const byMember = members.map((m) => ({
    memberId: m.id,
    name: m.name,
    balanceCents: balances.get(m.id)?.toNumber() ?? 0,
  }));

  const suggestedTransfers = simplifySettlements(balances).map((t) => ({
    ...t,
    fromName: members.find((m) => m.id === t.fromMemberId)?.name ?? t.fromMemberId,
    toName: members.find((m) => m.id === t.toMemberId)?.name ?? t.toMemberId,
  }));

  return { byMember, suggestedTransfers };
}

export interface DashboardData {
  month: Date;
  totalIncomeCents: number;
  perMember: Array<{
    memberId: string;
    name: string;
    incomeCents: number;
    incomeSharePercent: number;
    fairContributionCents: number;
    actuallyPaidCents: number;
    /**
     * This month's own contribution to the balance — actuallyPaidCents
     * minus fairContributionCents, both already scoped to this month.
     * Distinct from balanceCents, which is the household's GLOBAL,
     * cumulative-across-every-month balance (see getBalances). A month
     * can show 0 here while balanceCents carries a large outstanding
     * amount from prior months, or vice versa.
     */
    thisMonthBalanceCents: number;
    /** Global, cumulative across every month ever recorded — never just this one. */
    balanceCents: number;
  }>;
  fixedCents: number;
  variableCents: number;
  savingsCents: number;
  leftoverCents: number;
  overspend: boolean;
  incomeWarnings: Array<{
    memberId: string;
    memberName: string;
    type: "PRIOR_MONTH_FALLBACK" | "NO_INCOME_ON_RECORD";
    fallbackMonth: string | null;
  }>;
  /** True when nobody in the household has any income on record this month, so incomeSharePercent/fairContributionCents reflect an equal split rather than an income-weighted one. */
  usedEqualSplitFallback: boolean;
}

export async function getDashboardData(householdId: string, month: Date): Promise<DashboardData> {
  const start = monthStart(month);
  const end = addMonths(start, 1);

  const [members, incomeRecords, expenses] = await Promise.all([
    prisma.member.findMany({ where: { householdId, active: true } }),
    prisma.incomeRecord.findMany({ where: { member: { householdId } } }),
    prisma.expense.findMany({
      where: { householdId, date: { gte: start, lt: end } },
      include: { category: true, shares: true },
    }),
  ]);

  // computeIncomeShares is the ONLY place fallback-to-prior-month
  // resolution happens; resolvedIncome is its resolved absolute-cents
  // numerator, not just the ratio, so there is nothing left to
  // re-derive here.
  const { shares: incomeShares, resolvedIncome, warnings, usedEqualSplitFallback } = computeIncomeShares(
    members.map((m) => ({ id: m.id, active: m.active })),
    incomeRecords.map((r) => ({ memberId: r.memberId, month: r.month, netAmount: r.netAmount })),
    start
  );

  const totalIncomeCents = [...resolvedIncome.values()].reduce((sum, v) => sum.plus(v), new Decimal(0)).toNumber();

  let fixedCents = 0;
  let variableCents = 0;
  let savingsCents = 0;
  const paidByMember = new Map<string, number>();
  const fairContributionByMember = new Map<string, number>();

  for (const expense of expenses) {
    if (expense.category?.kind === "FIXED") fixedCents += expense.amount;
    else if (expense.category?.kind === "SAVINGS") savingsCents += expense.amount;
    else variableCents += expense.amount;

    paidByMember.set(expense.paidByMemberId, (paidByMember.get(expense.paidByMemberId) ?? 0) + expense.amount);

    for (const share of expense.shares) {
      fairContributionByMember.set(share.memberId, (fairContributionByMember.get(share.memberId) ?? 0) + share.owedAmount);
    }
  }

  const { byMember: balances } = await getBalances(householdId);
  const balanceByMember = new Map(balances.map((b) => [b.memberId, b.balanceCents]));

  const perMember = members.map((member) => {
    const fairContributionCents = fairContributionByMember.get(member.id) ?? 0;
    const actuallyPaidCents = paidByMember.get(member.id) ?? 0;
    return {
      memberId: member.id,
      name: member.name,
      incomeCents: resolvedIncome.get(member.id)?.toNumber() ?? 0,
      incomeSharePercent: (incomeShares.get(member.id)?.toNumber() ?? 0) * 100,
      fairContributionCents,
      actuallyPaidCents,
      thisMonthBalanceCents: actuallyPaidCents - fairContributionCents,
      balanceCents: balanceByMember.get(member.id) ?? 0,
    };
  });

  const leftoverCents = totalIncomeCents - fixedCents - variableCents - savingsCents;

  return {
    month: start,
    totalIncomeCents,
    perMember,
    fixedCents,
    variableCents,
    savingsCents,
    leftoverCents,
    overspend: fixedCents + variableCents + savingsCents > totalIncomeCents,
    incomeWarnings: warnings.map((w) => ({
      memberId: w.memberId,
      memberName: members.find((m) => m.id === w.memberId)?.name ?? w.memberId,
      type: w.type,
      fallbackMonth: w.fallbackMonth,
    })),
    usedEqualSplitFallback,
  };
}

export interface MemberDashboardData {
  member: { id: string; name: string; email: string | null; active: boolean };
  month: Date;
  /** This member's row out of getDashboardData().perMember — same numbers the household Dashboard shows, not a second derivation of them. */
  summary: DashboardData["perMember"][number];
  /** Their fair share of this month's spending, split by category kind. Sums to summary.fairContributionCents. */
  shareByKind: { fixedCents: number; variableCents: number; savingsCents: number; uncategorizedCents: number };
  /** Income rows for this month only — the raw records, not the fallback-resolved figure in `summary.incomeCents`. An empty list with a non-zero summary.incomeCents means a prior month was carried forward. */
  incomeRecords: Array<{ id: string; source: string; netAmountCents: number }>;
  /** Every expense this member owes a share of this month, with their slice of it. */
  shares: Array<{
    expenseId: string;
    date: Date;
    label: string;
    categoryName: string | null;
    categoryKind: CategoryKind | null;
    totalCents: number;
    owedCents: number;
    paidByName: string;
    paidByThisMember: boolean;
    isShared: boolean;
  }>;
  /** Expenses this member paid for this month but owes no share of (a SOLO expense covering someone else). Kept separate so `shares` can stay "what I owe". */
  paidWithoutShare: Array<{ expenseId: string; date: Date; label: string; totalCents: number }>;
  /** Transfers involving this member, newest first, across all months — balances are cumulative, so scoping these to one month would misrepresent them. */
  settlements: Array<{ id: string; date: Date; direction: "paid" | "received"; counterpartName: string; amountCents: number; note: string | null }>;
  savingsContributions: Array<{ id: string; goalName: string; amountCents: number; isJoint: boolean }>;
}

/**
 * One member's view of a month. Aggregates are taken from
 * getDashboardData rather than recomputed: computeIncomeShares is the only
 * place prior-month income fallback is resolved, and a second
 * implementation here would be free to drift from the household Dashboard
 * and disagree with it about the same member's numbers.
 */
export async function getMemberDashboardData(
  householdId: string,
  memberId: string,
  month: Date
): Promise<MemberDashboardData | null> {
  const start = monthStart(month);
  const end = addMonths(start, 1);

  const member = await prisma.member.findFirst({
    where: { id: memberId, householdId },
    select: { id: true, name: true, email: true, active: true },
  });
  if (!member) return null;

  const [dashboard, incomeRecords, monthExpenses, settlements, contributions] = await Promise.all([
    getDashboardData(householdId, start),
    prisma.incomeRecord.findMany({
      where: { memberId, month: start },
      select: { id: true, source: true, netAmount: true },
      orderBy: { source: "asc" },
    }),
    prisma.expense.findMany({
      where: { householdId, date: { gte: start, lt: end } },
      select: {
        id: true,
        date: true,
        label: true,
        amount: true,
        isShared: true,
        paidByMemberId: true,
        paidBy: { select: { name: true } },
        category: { select: { name: true, kind: true } },
        shares: { select: { memberId: true, owedAmount: true } },
      },
      orderBy: { date: "desc" },
    }),
    prisma.settlement.findMany({
      where: { householdId, OR: [{ fromMemberId: memberId }, { toMemberId: memberId }] },
      select: {
        id: true,
        date: true,
        amount: true,
        note: true,
        fromMemberId: true,
        fromMember: { select: { name: true } },
        toMember: { select: { name: true } },
      },
      orderBy: { date: "desc" },
    }),
    prisma.savingsContribution.findMany({
      where: { memberId, month: start },
      select: { id: true, amount: true, isJoint: true, goal: { select: { name: true } } },
    }),
  ]);

  // An inactive member is excluded from getDashboardData's perMember (it
  // only queries active ones), so there is no row to show them.
  const summary =
    dashboard.perMember.find((m) => m.memberId === memberId) ??
    {
      memberId,
      name: member.name,
      incomeCents: 0,
      incomeSharePercent: 0,
      fairContributionCents: 0,
      actuallyPaidCents: 0,
      thisMonthBalanceCents: 0,
      balanceCents: 0,
    };

  const shareByKind = { fixedCents: 0, variableCents: 0, savingsCents: 0, uncategorizedCents: 0 };
  const shares: MemberDashboardData["shares"] = [];
  const paidWithoutShare: MemberDashboardData["paidWithoutShare"] = [];

  for (const expense of monthExpenses) {
    const own = expense.shares.find((sh) => sh.memberId === memberId);
    if (own) {
      if (expense.category?.kind === "FIXED") shareByKind.fixedCents += own.owedAmount;
      else if (expense.category?.kind === "SAVINGS") shareByKind.savingsCents += own.owedAmount;
      else if (expense.category?.kind === "VARIABLE") shareByKind.variableCents += own.owedAmount;
      else shareByKind.uncategorizedCents += own.owedAmount;

      shares.push({
        expenseId: expense.id,
        date: expense.date,
        label: expense.label,
        categoryName: expense.category?.name ?? null,
        categoryKind: expense.category?.kind ?? null,
        totalCents: expense.amount,
        owedCents: own.owedAmount,
        paidByName: expense.paidBy.name,
        paidByThisMember: expense.paidByMemberId === memberId,
        isShared: expense.isShared,
      });
    } else if (expense.paidByMemberId === memberId) {
      paidWithoutShare.push({
        expenseId: expense.id,
        date: expense.date,
        label: expense.label,
        totalCents: expense.amount,
      });
    }
  }

  return {
    member,
    month: start,
    summary,
    shareByKind,
    incomeRecords: incomeRecords.map((r) => ({ id: r.id, source: r.source, netAmountCents: r.netAmount })),
    shares,
    paidWithoutShare,
    settlements: settlements.map((st) => ({
      id: st.id,
      date: st.date,
      direction: st.fromMemberId === memberId ? ("paid" as const) : ("received" as const),
      counterpartName: st.fromMemberId === memberId ? st.toMember.name : st.fromMember.name,
      amountCents: st.amount,
      note: st.note,
    })),
    savingsContributions: contributions.map((c) => ({
      id: c.id,
      goalName: c.goal.name,
      amountCents: c.amount,
      isJoint: c.isJoint,
    })),
  };
}

export type { SplitRule };
