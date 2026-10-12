import {
  computeBalances,
  type ExpenseForBalance,
  type MemberId,
  type MemberShare,
  type SettlementForBalance,
} from "./splitting";

/**
 * What editing or deleting one expense would do to a member's balance,
 * for members who are party to a real recorded Settlement.
 *
 * Mirrors the income-edit warning: changing history after money has
 * actually changed hands can leave a settled balance wrong, so the user
 * is shown the concrete before/after and allowed to proceed anyway. This
 * warns; it never blocks.
 */
export interface ExpenseChangeImpact {
  memberId: MemberId;
  balanceBeforeCents: number;
  balanceAfterCents: number;
  /** Total already settled by this member, in either direction — the money that may now be wrong. */
  relatedSettlementsCents: number;
}

/**
 * The expense as it would be after the edit, or null to model deleting it.
 * Separate from ExpenseForBalance so a caller cannot forget the id.
 */
export type ProposedExpense = Omit<ExpenseForBalance, "id"> | null;

/**
 * Kept as a pure function over already-loaded rows rather than a query,
 * so the arithmetic is unit-testable without a database — the same shape
 * as findSettlementImpact, but able to model removal and a change of
 * payer, neither of which a shares-only projection can express.
 */
export function findExpenseChangeImpact(
  allExpenses: ExpenseForBalance[],
  expenseId: string,
  proposed: ProposedExpense,
  settlements: SettlementForBalance[]
): ExpenseChangeImpact[] {
  // With nothing ever settled there is no real payment a change could
  // invalidate, so there is nothing to warn about.
  if (settlements.length === 0) return [];

  const membersWithSettlements = new Set<MemberId>();
  for (const s of settlements) {
    membersWithSettlements.add(s.fromMemberId);
    membersWithSettlements.add(s.toMemberId);
  }

  const before = computeBalances(allExpenses, settlements);

  const projectedExpenses =
    proposed === null
      ? allExpenses.filter((e) => e.id !== expenseId)
      : allExpenses.map((e) => (e.id === expenseId ? { ...proposed, id: expenseId } : e));

  const after = computeBalances(projectedExpenses, settlements);

  const impacted: ExpenseChangeImpact[] = [];
  for (const memberId of membersWithSettlements) {
    const balanceBeforeCents = before.get(memberId)?.round().toNumber() ?? 0;
    const balanceAfterCents = after.get(memberId)?.round().toNumber() ?? 0;
    if (balanceBeforeCents === balanceAfterCents) continue;

    impacted.push({
      memberId,
      balanceBeforeCents,
      balanceAfterCents,
      relatedSettlementsCents: settlements
        .filter((s) => s.fromMemberId === memberId || s.toMemberId === memberId)
        .reduce((sum, s) => sum + s.amountCents, 0),
    });
  }

  return impacted;
}

/** Convenience for the delete path, where there is no proposed replacement. */
export function findExpenseDeletionImpact(
  allExpenses: ExpenseForBalance[],
  expenseId: string,
  settlements: SettlementForBalance[]
): ExpenseChangeImpact[] {
  return findExpenseChangeImpact(allExpenses, expenseId, null, settlements);
}

/** Re-exported so callers don't need a second import for the share type. */
export type { MemberShare };
