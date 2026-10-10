import Decimal from "decimal.js";
import { monthStart, monthKey } from "./month";

export type MemberId = string;

export class SplitValidationError extends Error {}

export interface MemberInput {
  id: MemberId;
  active: boolean;
}

export interface IncomeRecordInput {
  memberId: MemberId;
  month: Date;
  netAmount: number; // cents
}

export type SplitRule =
  | { type: "PROPORTIONAL" }
  | { type: "EQUAL" }
  | { type: "EXACT"; amounts: Record<MemberId, number> } // cents; must sum to the expense amount
  | { type: "PERCENTAGE"; percentages: Record<MemberId, number> } // 0-100; must sum to 100
  | { type: "SOLO" };

export interface MemberShare {
  memberId: MemberId;
  owedAmount: number; // cents
}

export type IncomeShareWarningType = "PRIOR_MONTH_FALLBACK" | "NO_INCOME_ON_RECORD";

export interface IncomeShareWarning {
  memberId: MemberId;
  requestedMonth: string; // "YYYY-MM"
  type: IncomeShareWarningType;
  /** The month whose income was actually borrowed — only set for PRIOR_MONTH_FALLBACK. */
  fallbackMonth: string | null;
}

export interface IncomeShareResult {
  /** Ratios of each active member's income to the household total for the month; sums to 1. */
  shares: Map<MemberId, Decimal>;
  /**
   * Each active member's resolved net income for the month, in cents,
   * after applying the prior-month fallback — i.e. the actual numerator
   * used to compute `shares`. This is the one and only place that
   * fallback resolution happens; anything that needs a member's "income
   * for this month" (not just their ratio) should read this instead of
   * re-deriving it.
   */
  resolvedIncome: Map<MemberId, Decimal>;
  /** Per-member fallbacks: someone borrowed a prior month's income, or has none on record at all. */
  warnings: IncomeShareWarning[];
  /**
   * True when NO active member has any resolved income for this month
   * (every one of them hit NO_INCOME_ON_RECORD), so `shares` is an equal
   * split across active members rather than an income-weighted one —
   * distinct from an individual member borrowing a prior month while
   * others still have real numbers. Check this before trusting `shares`
   * as actually income-proportional.
   */
  usedEqualSplitFallback: boolean;
}

/**
 * share(M, T) = netIncome(M, T) / SUM(netIncome(all active members, T))
 *
 * If a member has no IncomeRecord for month T, falls back to their most
 * recent prior month with a record and emits a PRIOR_MONTH_FALLBACK
 * warning. If a member has never had any income on record at all, emits
 * a NO_INCOME_ON_RECORD warning instead. If NO active member has any
 * resolved income as of T (every one of them hit NO_INCOME_ON_RECORD —
 * or, in the degenerate case, their on-record amounts happen to sum to
 * exactly zero), falls back to an equal split across active members and
 * sets usedEqualSplitFallback, instead of dividing by zero.
 */
export function computeIncomeShares(
  members: MemberInput[],
  incomeRecords: IncomeRecordInput[],
  month: Date
): IncomeShareResult {
  const activeMembers = members.filter((m) => m.active);
  const warnings: IncomeShareWarning[] = [];
  const requestedKey = monthKey(month);
  const requestedStart = monthStart(month);

  const byMemberMonth = new Map<string, Decimal>();
  for (const record of incomeRecords) {
    const key = `${record.memberId}|${monthKey(record.month)}`;
    byMemberMonth.set(key, (byMemberMonth.get(key) ?? new Decimal(0)).plus(record.netAmount));
  }

  const netByMember = new Map<MemberId, Decimal>();

  for (const member of activeMembers) {
    const directKey = `${member.id}|${requestedKey}`;
    const direct = byMemberMonth.get(directKey);
    if (direct !== undefined) {
      netByMember.set(member.id, direct);
      continue;
    }

    const priorMonths = incomeRecords
      .filter((r) => r.memberId === member.id && monthStart(r.month).getTime() <= requestedStart.getTime())
      .map((r) => monthStart(r.month))
      .sort((a, b) => b.getTime() - a.getTime());

    const fallback = priorMonths[0];
    if (fallback) {
      const fallbackAmount = byMemberMonth.get(`${member.id}|${monthKey(fallback)}`) ?? new Decimal(0);
      netByMember.set(member.id, fallbackAmount);
      warnings.push({
        memberId: member.id,
        requestedMonth: requestedKey,
        type: "PRIOR_MONTH_FALLBACK",
        fallbackMonth: monthKey(fallback),
      });
    } else {
      netByMember.set(member.id, new Decimal(0));
      warnings.push({
        memberId: member.id,
        requestedMonth: requestedKey,
        type: "NO_INCOME_ON_RECORD",
        fallbackMonth: null,
      });
    }
  }

  const total = [...netByMember.values()].reduce((sum, v) => sum.plus(v), new Decimal(0));
  const shares = new Map<MemberId, Decimal>();
  const usedEqualSplitFallback = total.isZero();

  if (usedEqualSplitFallback) {
    const equal = activeMembers.length > 0 ? new Decimal(1).dividedBy(activeMembers.length) : new Decimal(0);
    for (const member of activeMembers) shares.set(member.id, equal);
  } else {
    for (const member of activeMembers) {
      shares.set(member.id, (netByMember.get(member.id) ?? new Decimal(0)).dividedBy(total));
    }
  }

  return { shares, resolvedIncome: netByMember, warnings, usedEqualSplitFallback };
}

/**
 * Splits amountCents across the given ratios so the result sums EXACTLY
 * to amountCents (integer cents, no floating point), using the
 * largest-remainder (Hamilton) method: each member's base share is
 * floor(amount * ratio / totalRatio), then the leftover cents — the
 * difference between amountCents and the sum of floors — are handed out
 * one at a time to the members with the largest fractional remainder.
 * Ties are broken by larger share, then by memberId ascending, so the
 * result is fully deterministic regardless of map insertion order.
 *
 * Each member receives either floor(exact) or floor(exact)+1 — never
 * more than one extra cent each, since every member appears exactly once
 * in the tie-broken order and the leftover count is always strictly less
 * than the number of members (each member's own rounding error is < 1
 * cent, so they can't sum to a whole member's worth across the group).
 */
export function allocateByRatio(amountCents: number, ratios: Map<MemberId, Decimal>): MemberShare[] {
  if (!Number.isInteger(amountCents)) {
    throw new SplitValidationError(`amountCents must be an integer, got ${amountCents}`);
  }
  const entries = [...ratios.entries()];
  if (entries.length === 0) {
    throw new SplitValidationError("Cannot allocate across zero members.");
  }

  const totalRatio = entries.reduce((sum, [, ratio]) => sum.plus(ratio), new Decimal(0));
  if (totalRatio.isZero()) {
    throw new SplitValidationError("Cannot allocate: all ratios are zero.");
  }

  const computed = entries.map(([memberId, ratio]) => {
    const exact = new Decimal(amountCents).times(ratio).dividedBy(totalRatio);
    const floor = exact.floor();
    return { memberId, ratio, floor, remainder: exact.minus(floor) };
  });

  const allocated = computed.reduce((sum, c) => sum.plus(c.floor), new Decimal(0));
  const leftover = new Decimal(amountCents).minus(allocated).toNumber();

  const byRemainderThenRatioThenId = [...computed].sort((a, b) => {
    const remainderCmp = b.remainder.comparedTo(a.remainder);
    if (remainderCmp !== 0) return remainderCmp;
    const ratioCmp = b.ratio.comparedTo(a.ratio);
    if (ratioCmp !== 0) return ratioCmp;
    return a.memberId.localeCompare(b.memberId);
  });

  const owed = new Map(computed.map((c) => [c.memberId, c.floor.toNumber()]));
  for (let i = 0; i < leftover; i++) {
    const memberId = byRemainderThenRatioThenId[i].memberId;
    owed.set(memberId, owed.get(memberId)! + 1);
  }

  return entries.map(([memberId]) => ({ memberId, owedAmount: owed.get(memberId)! }));
}

export interface ExpenseShareResult {
  shares: MemberShare[];
  /** Income ratios frozen at the expense's date — only set for PROPORTIONAL splits. */
  incomeRatioSnapshot: Record<MemberId, number> | null;
  warnings: IncomeShareWarning[];
  /** Always false for non-PROPORTIONAL rules; see IncomeShareResult for what this means. */
  usedEqualSplitFallback: boolean;
}

/**
 * Computes the per-member ExpenseShare rows for one expense, per its
 * splitRule. Always returns shares summing exactly to amountCents.
 */
export function computeExpenseShares(
  amountCents: number,
  paidByMemberId: MemberId,
  splitRule: SplitRule,
  members: MemberInput[],
  incomeRecords: IncomeRecordInput[],
  expenseDate: Date
): ExpenseShareResult {
  assertAmount(amountCents);

  if (splitRule.type === "SOLO") {
    return {
      shares: [{ memberId: paidByMemberId, owedAmount: amountCents }],
      incomeRatioSnapshot: null,
      warnings: [],
      usedEqualSplitFallback: false,
    };
  }

  if (splitRule.type === "EXACT") {
    const entries = Object.entries(splitRule.amounts);
    if (entries.length === 0) throw new SplitValidationError("EXACT split needs at least one member amount.");
    const sum = entries.reduce((total, [, amount]) => total + amount, 0);
    if (sum !== amountCents) {
      throw new SplitValidationError(
        `EXACT split amounts sum to ${sum} cents but the expense is ${amountCents} cents.`
      );
    }
    return {
      shares: entries.map(([memberId, owedAmount]) => ({ memberId, owedAmount })),
      incomeRatioSnapshot: null,
      warnings: [],
      usedEqualSplitFallback: false,
    };
  }

  if (splitRule.type === "PERCENTAGE") {
    const entries = Object.entries(splitRule.percentages);
    if (entries.length === 0) throw new SplitValidationError("PERCENTAGE split needs at least one member percentage.");
    const sumPct = entries.reduce((total, [, pct]) => total + pct, 0);
    if (Math.abs(sumPct - 100) > 1e-9) {
      throw new SplitValidationError(`PERCENTAGE split must sum to 100, got ${sumPct}.`);
    }
    const ratios = new Map(entries.map(([memberId, pct]) => [memberId, new Decimal(pct).dividedBy(100)]));
    return {
      shares: allocateByRatio(amountCents, ratios),
      incomeRatioSnapshot: null,
      warnings: [],
      usedEqualSplitFallback: false,
    };
  }

  if (splitRule.type === "EQUAL") {
    const activeMembers = members.filter((m) => m.active);
    if (activeMembers.length === 0) throw new SplitValidationError("Cannot split EQUAL with no active members.");
    const ratios = new Map(activeMembers.map((m) => [m.id, new Decimal(1).dividedBy(activeMembers.length)]));
    return {
      shares: allocateByRatio(amountCents, ratios),
      incomeRatioSnapshot: null,
      warnings: [],
      usedEqualSplitFallback: false,
    };
  }

  // PROPORTIONAL (default): freeze the ratio in effect on the expense's date.
  const { shares: incomeShares, warnings, usedEqualSplitFallback } = computeIncomeShares(members, incomeRecords, expenseDate);
  const snapshot: Record<MemberId, number> = {};
  for (const [memberId, ratio] of incomeShares) snapshot[memberId] = ratio.toNumber();

  return {
    shares: allocateByRatio(amountCents, incomeShares),
    incomeRatioSnapshot: snapshot,
    warnings,
    usedEqualSplitFallback,
  };
}

/**
 * The JSON blob persisted on Expense.incomeRatioSnapshot — the one place
 * that shape is assembled, so every write site (create, update,
 * income-edit recalculation, seed) stores the same structure. Prisma's
 * generated `Json` input type doesn't structurally accept a plain named
 * interface (it wants InputJsonObject's index signature), so write sites
 * cast this through `Prisma.InputJsonValue` — see buildStoredIncomeRatioSnapshot's
 * call sites in actions.ts/seed.ts.
 */
export interface StoredIncomeRatioSnapshot {
  ratios: Record<MemberId, number>;
  usedEqualSplitFallback: boolean;
  warnings: IncomeShareWarning[];
}

/**
 * Builds the snapshot to persist for one expense's computed shares — null
 * for non-PROPORTIONAL splits, since there's no income ratio to freeze.
 * This is what makes a fallback visible later, on the Expenses screen,
 * not just in the moment it happened on the Dashboard.
 */
export function buildStoredIncomeRatioSnapshot(result: ExpenseShareResult): StoredIncomeRatioSnapshot | null {
  if (!result.incomeRatioSnapshot) return null;
  return {
    ratios: result.incomeRatioSnapshot,
    usedEqualSplitFallback: result.usedEqualSplitFallback,
    warnings: result.warnings,
  };
}

export interface ExpenseForBalance {
  id: string;
  paidByMemberId: MemberId;
  shares: MemberShare[];
  /** SOLO expenses (isShared=false) never touch household balances. */
  isShared: boolean;
}

export interface SettlementForBalance {
  fromMemberId: MemberId;
  toMemberId: MemberId;
  amountCents: number;
}

/**
 * Net pairwise balance per member: positive means the household owes this
 * member money (net creditor), negative means this member owes the
 * household (net debtor). Settlements are applied here, but expense
 * reports/spending totals must never read Settlement rows directly — see
 * the spec's "never mixed into expense/spending reports" rule.
 */
export function computeBalances(
  expenses: ExpenseForBalance[],
  settlements: SettlementForBalance[]
): Map<MemberId, Decimal> {
  const balances = new Map<MemberId, Decimal>();
  const add = (memberId: MemberId, delta: Decimal) => {
    balances.set(memberId, (balances.get(memberId) ?? new Decimal(0)).plus(delta));
  };

  for (const expense of expenses) {
    if (!expense.isShared) continue;
    for (const share of expense.shares) {
      if (share.memberId === expense.paidByMemberId) continue; // payer already covered their own share
      add(expense.paidByMemberId, new Decimal(share.owedAmount));
      add(share.memberId, new Decimal(share.owedAmount).negated());
    }
  }

  for (const settlement of settlements) {
    add(settlement.fromMemberId, new Decimal(settlement.amountCents));
    add(settlement.toMemberId, new Decimal(settlement.amountCents).negated());
  }

  return balances;
}

export interface SuggestedTransfer {
  fromMemberId: MemberId;
  toMemberId: MemberId;
  amountCents: number;
}

/**
 * Greedy debt simplification ("settle up"): repeatedly matches the
 * largest creditor with the largest debtor. This is the same heuristic
 * Splitwise itself uses — simple, deterministic, and minimizes the
 * transfer count in the overwhelmingly common case, though it is not
 * formally guaranteed to be globally optimal for every possible balance
 * configuration across many members.
 */
export function simplifySettlements(balances: Map<MemberId, Decimal>): SuggestedTransfer[] {
  const EPSILON = new Decimal(0.5); // balances are integer cents; treat sub-cent noise as zero

  type Party = { memberId: MemberId; amount: Decimal };
  const creditors: Party[] = [];
  const debtors: Party[] = [];

  for (const [memberId, balance] of balances) {
    if (balance.greaterThan(EPSILON)) creditors.push({ memberId, amount: balance });
    else if (balance.lessThan(EPSILON.negated())) debtors.push({ memberId, amount: balance.negated() });
  }

  const byAmountDesc = (a: Party, b: Party) => {
    const cmp = b.amount.comparedTo(a.amount);
    return cmp !== 0 ? cmp : a.memberId.localeCompare(b.memberId);
  };
  creditors.sort(byAmountDesc);
  debtors.sort(byAmountDesc);

  const transfers: SuggestedTransfer[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci];
    const debtor = debtors[di];
    const amount = Decimal.min(creditor.amount, debtor.amount);

    if (amount.greaterThan(0)) {
      transfers.push({
        fromMemberId: debtor.memberId,
        toMemberId: creditor.memberId,
        amountCents: amount.round().toNumber(),
      });
    }

    creditor.amount = creditor.amount.minus(amount);
    debtor.amount = debtor.amount.minus(amount);

    if (creditor.amount.lessThanOrEqualTo(EPSILON)) ci++;
    if (debtor.amount.lessThanOrEqualTo(EPSILON)) di++;
  }

  return transfers;
}

export interface SettlementPreview {
  fromBalanceBeforeCents: number;
  toBalanceBeforeCents: number;
  fromBalanceAfterCents: number;
  toBalanceAfterCents: number;
  /** True when amountCents exceeds what fromMember currently owes overall (their balance is positive, or less negative than -amountCents). */
  isOverpayment: boolean;
  /** How much of amountCents goes beyond what was actually owed; 0 when isOverpayment is false. */
  overpaidByCents: number;
}

/**
 * Previews the effect of a proposed settlement (fromMember pays toMember
 * amountCents) against CURRENT balances, without writing anything.
 * "Overpayment" is judged against fromMember's own global balance — how
 * much they owe overall, not a pairwise ledger with toMember specifically
 * (this app only tracks a global per-member balance, not a full pairwise
 * matrix; for a 2-person household the two are the same thing). Allowed,
 * never blocked — the caller decides whether to surface this as a
 * confirmation step.
 */
export function previewSettlement(
  balances: Map<MemberId, Decimal>,
  fromMemberId: MemberId,
  toMemberId: MemberId,
  amountCents: number
): SettlementPreview {
  const fromBefore = (balances.get(fromMemberId) ?? new Decimal(0)).round().toNumber();
  const toBefore = (balances.get(toMemberId) ?? new Decimal(0)).round().toNumber();
  const owedByFrom = Math.max(0, -fromBefore);
  const overpaidByCents = Math.max(0, amountCents - owedByFrom);

  return {
    fromBalanceBeforeCents: fromBefore,
    toBalanceBeforeCents: toBefore,
    fromBalanceAfterCents: fromBefore + amountCents,
    toBalanceAfterCents: toBefore - amountCents,
    isOverpayment: amountCents > owedByFrom,
    overpaidByCents,
  };
}

function assertAmount(amountCents: number): void {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new SplitValidationError(`Expense amount must be a non-negative integer number of cents, got ${amountCents}`);
  }
}
