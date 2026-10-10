import Decimal from "decimal.js";
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

export type { SplitRule };
