import {
  computeBalances,
  computeExpenseShares,
  type ExpenseForBalance,
  type IncomeRecordInput,
  type MemberId,
  type MemberInput,
  type MemberShare,
  type SettlementForBalance,
} from "./splitting";

export interface StoredProportionalExpense {
  id: string;
  date: Date;
  amountCents: number;
  paidByMemberId: MemberId;
  storedShares: MemberShare[];
}

export interface IncomeEditImpact {
  expenseId: string;
  oldShares: MemberShare[];
  newShares: MemberShare[];
}

/**
 * Editing a past month's IncomeRecord must not silently change already-
 * materialized ExpenseShare rows for PROPORTIONAL expenses — the spec's
 * "flag affected expenses and ask the user to confirm a recalculation"
 * rule. Call this BEFORE persisting the income edit, with
 * `incomeRecordsWithEdit` already containing the proposed change (and
 * everything else unchanged): it recomputes every candidate expense's
 * shares under the new numbers and reports which ones would actually
 * change. An empty result means it's safe to save the income edit with
 * no further confirmation — nothing downstream depends on that month's
 * ratio.
 *
 * `expenses` should be every PROPORTIONAL expense whose date could
 * plausibly have used the edited month's income — in practice, every
 * PROPORTIONAL expense in the household dated on/after the edited month,
 * since the fallback-to-prior-month rule means a later month with no
 * income of its own could be borrowing this one's ratio.
 */
export function findIncomeEditImpact(
  expenses: StoredProportionalExpense[],
  members: MemberInput[],
  incomeRecordsWithEdit: IncomeRecordInput[]
): IncomeEditImpact[] {
  const impacted: IncomeEditImpact[] = [];

  for (const expense of expenses) {
    const { shares: newShares } = computeExpenseShares(
      expense.amountCents,
      expense.paidByMemberId,
      { type: "PROPORTIONAL" },
      members,
      incomeRecordsWithEdit,
      expense.date
    );

    if (!sameShares(expense.storedShares, newShares)) {
      impacted.push({ expenseId: expense.id, oldShares: expense.storedShares, newShares });
    }
  }

  return impacted;
}

function sameShares(a: MemberShare[], b: MemberShare[]): boolean {
  if (a.length !== b.length) return false;
  const byMember = new Map(a.map((s) => [s.memberId, s.owedAmount]));
  return b.every((s) => byMember.get(s.memberId) === s.owedAmount);
}

export interface SettlementImpact {
  memberId: MemberId;
  /** Household-wide balance for this member right now, with the OLD (currently stored) shares. */
  balanceBeforeCents: number;
  /** What that same balance would become if the flagged expenses were recalculated to the NEW shares. */
  balanceAfterCents: number;
  /** Every existing settlement this member is a party to — these are what "warn, don't block" is protecting: real money that already changed hands, computed against the old numbers. */
  relatedSettlementsCents: number;
}

/**
 * Balances are global and cumulative across every expense in the
 * household (see computeBalances) — a settlement recorded against
 * "whatever the balance was" has no idea which specific expense or
 * month it was paying down. So recalculating ANY expense's shares can
 * retroactively change a balance real money already settled, and
 * nothing before this function ever checked for that.
 *
 * `allExpenses` must be every shared expense in the household with
 * their CURRENTLY STORED shares (not just the ones this income edit
 * would affect) — the "before" balance needs the whole picture.
 * `newSharesByExpenseId` carries the recomputed shares for just the
 * expenses `findIncomeEditImpact` flagged; every other expense's shares
 * are assumed unchanged for the "after" projection.
 *
 * Only reports members who are a party to at least one existing
 * Settlement — if nobody has ever recorded a real payment, there's
 * nothing a recalculation could retroactively invalidate, so the
 * ordinary share-diff warning is enough on its own.
 */
export function findSettlementImpact(
  allExpenses: ExpenseForBalance[],
  newSharesByExpenseId: Map<string, MemberShare[]>,
  settlements: SettlementForBalance[]
): SettlementImpact[] {
  if (settlements.length === 0 || newSharesByExpenseId.size === 0) return [];

  const membersWithSettlements = new Set<MemberId>();
  for (const s of settlements) {
    membersWithSettlements.add(s.fromMemberId);
    membersWithSettlements.add(s.toMemberId);
  }

  const before = computeBalances(allExpenses, settlements);
  const projected = allExpenses.map((e) => {
    const newShares = newSharesByExpenseId.get(e.id);
    return newShares ? { ...e, shares: newShares } : e;
  });
  const after = computeBalances(projected, settlements);

  const impacted: SettlementImpact[] = [];
  for (const memberId of membersWithSettlements) {
    const beforeCents = before.get(memberId)?.round().toNumber() ?? 0;
    const afterCents = after.get(memberId)?.round().toNumber() ?? 0;
    if (beforeCents === afterCents) continue;

    const relatedSettlementsCents = settlements
      .filter((s) => s.fromMemberId === memberId || s.toMemberId === memberId)
      .reduce((sum, s) => sum + s.amountCents, 0);

    impacted.push({ memberId, balanceBeforeCents: beforeCents, balanceAfterCents: afterCents, relatedSettlementsCents });
  }

  return impacted;
}
