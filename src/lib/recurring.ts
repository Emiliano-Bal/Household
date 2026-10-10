import { monthStart, daysInMonth } from "./month";
import type { MemberId, SplitRule } from "./splitting";

export interface RecurringExpenseInput {
  id: string;
  categoryId: string;
  label: string;
  amount: number; // cents
  dayOfMonth: number;
  startMonth: Date;
  endMonth: Date | null;
  paidByMemberId: MemberId;
  splitRule: SplitRule;
  active: boolean;
}

export interface MaterializedExpenseDraft {
  recurringExpenseId: string;
  categoryId: string;
  label: string;
  amount: number;
  date: Date;
  paidByMemberId: MemberId;
  splitRule: SplitRule;
  generatedForMonth: Date;
}

/** Which recurring templates are due to generate an Expense for targetMonth. */
export function recurringExpensesDueForMonth(
  recurring: RecurringExpenseInput[],
  targetMonth: Date
): RecurringExpenseInput[] {
  const target = monthStart(targetMonth).getTime();
  return recurring.filter((r) => {
    if (!r.active) return false;
    if (monthStart(r.startMonth).getTime() > target) return false;
    if (r.endMonth && monthStart(r.endMonth).getTime() < target) return false;
    return true;
  });
}

/**
 * Builds the Expense this recurring template would produce for
 * targetMonth. dayOfMonth is clamped to the number of days actually in
 * that month (e.g. dayOfMonth=31 on a 30-day month lands on the 30th)
 * instead of overflowing into the next month.
 *
 * Does NOT write to the database or check for an existing row — the
 * caller is responsible for idempotency (query for an existing Expense
 * with this recurringExpenseId + generatedForMonth first, or rely on the
 * Expense @@unique([recurringExpenseId, generatedForMonth]) constraint).
 */
export function materializeRecurringExpense(
  recurring: RecurringExpenseInput,
  targetMonth: Date
): MaterializedExpenseDraft {
  const target = monthStart(targetMonth);
  const day = Math.min(Math.max(1, recurring.dayOfMonth), daysInMonth(target));
  const date = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), day));

  return {
    recurringExpenseId: recurring.id,
    categoryId: recurring.categoryId,
    label: recurring.label,
    amount: recurring.amount,
    date,
    paidByMemberId: recurring.paidByMemberId,
    splitRule: recurring.splitRule,
    generatedForMonth: target,
  };
}
