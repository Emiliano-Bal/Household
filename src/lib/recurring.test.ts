import { describe, expect, it } from "vitest";
import { materializeRecurringExpense, recurringExpensesDueForMonth, type RecurringExpenseInput } from "./recurring";

function month(y: number, m: number): Date {
  return new Date(Date.UTC(y, m - 1, 1));
}

const baseRecurring: RecurringExpenseInput = {
  id: "rec-1",
  categoryId: "cat-1",
  label: "Rent",
  amount: 100000,
  dayOfMonth: 1,
  startMonth: month(2026, 1),
  endMonth: null,
  paidByMemberId: "member-a",
  splitRule: { type: "PROPORTIONAL" },
  active: true,
};

describe("recurringExpensesDueForMonth", () => {
  it("includes an active recurring expense within its start/end range", () => {
    const due = recurringExpensesDueForMonth([baseRecurring], month(2026, 3));
    expect(due).toHaveLength(1);
  });

  it("excludes a recurring expense before its startMonth", () => {
    const due = recurringExpensesDueForMonth([{ ...baseRecurring, startMonth: month(2026, 6) }], month(2026, 3));
    expect(due).toHaveLength(0);
  });

  it("excludes a recurring expense after its endMonth", () => {
    const due = recurringExpensesDueForMonth([{ ...baseRecurring, endMonth: month(2026, 2) }], month(2026, 3));
    expect(due).toHaveLength(0);
  });

  it("excludes an inactive recurring expense", () => {
    const due = recurringExpensesDueForMonth([{ ...baseRecurring, active: false }], month(2026, 3));
    expect(due).toHaveLength(0);
  });
});

describe("materializeRecurringExpense", () => {
  it("places the expense on dayOfMonth within the target month", () => {
    const draft = materializeRecurringExpense({ ...baseRecurring, dayOfMonth: 15 }, month(2026, 3));
    expect(draft.date.toISOString()).toBe("2026-03-15T00:00:00.000Z");
    expect(draft.generatedForMonth.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("clamps dayOfMonth to the last real day of a shorter month instead of overflowing", () => {
    // February 2026 (not a leap year) has 28 days.
    const draft = materializeRecurringExpense({ ...baseRecurring, dayOfMonth: 31 }, month(2026, 2));
    expect(draft.date.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("carries the recurringExpenseId and splitRule through to the draft", () => {
    const draft = materializeRecurringExpense(baseRecurring, month(2026, 3));
    expect(draft.recurringExpenseId).toBe("rec-1");
    expect(draft.splitRule).toEqual({ type: "PROPORTIONAL" });
    expect(draft.amount).toBe(100000);
  });
});
