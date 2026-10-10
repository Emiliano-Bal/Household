import { describe, expect, it } from "vitest";
import { findIncomeEditImpact, findSettlementImpact } from "./income-impact";
import { computeExpenseShares, type IncomeRecordInput, type MemberInput } from "./splitting";

const A = "member-a";
const B = "member-b";

function month(y: number, m: number): Date {
  return new Date(Date.UTC(y, m - 1, 1));
}

const members: MemberInput[] = [
  { id: A, active: true },
  { id: B, active: true },
];

describe("findIncomeEditImpact", () => {
  it("flags a PROPORTIONAL expense whose stored shares no longer match a recomputation", () => {
    const originalIncome: IncomeRecordInput[] = [
      { memberId: A, month: month(2026, 1), netAmount: 300000 },
      { memberId: B, month: month(2026, 1), netAmount: 200000 },
    ];
    const { shares: storedShares } = computeExpenseShares(
      100000,
      A,
      { type: "PROPORTIONAL" },
      members,
      originalIncome,
      month(2026, 1)
    );

    // B's January income is edited upward after the fact, from 200000 to 400000.
    const editedIncome: IncomeRecordInput[] = [
      { memberId: A, month: month(2026, 1), netAmount: 300000 },
      { memberId: B, month: month(2026, 1), netAmount: 400000 },
    ];

    const impact = findIncomeEditImpact(
      [{ id: "rent", date: month(2026, 1), amountCents: 100000, paidByMemberId: A, storedShares }],
      members,
      editedIncome
    );

    expect(impact).toHaveLength(1);
    expect(impact[0].expenseId).toBe("rent");
    expect(impact[0].oldShares).toEqual(expect.arrayContaining([{ memberId: B, owedAmount: 40000 }]));
    // B's new ratio is 400000/700000 ≈ 0.5714, so B owes floor(100000*4/7)=57142
    // plus the leftover cent (B now has the larger ratio) = 57143; A gets the rest.
    expect(impact[0].newShares).toEqual(
      expect.arrayContaining([
        { memberId: B, owedAmount: 57143 },
        { memberId: A, owedAmount: 42857 },
      ])
    );
  });

  it("does not flag an expense whose recomputed shares are unchanged", () => {
    const income: IncomeRecordInput[] = [
      { memberId: A, month: month(2026, 1), netAmount: 300000 },
      { memberId: B, month: month(2026, 1), netAmount: 200000 },
    ];
    const { shares: storedShares } = computeExpenseShares(
      100000,
      A,
      { type: "PROPORTIONAL" },
      members,
      income,
      month(2026, 1)
    );

    const impact = findIncomeEditImpact(
      [{ id: "rent", date: month(2026, 1), amountCents: 100000, paidByMemberId: A, storedShares }],
      members,
      income // identical — nothing changed
    );

    expect(impact).toEqual([]);
  });

  it("does not flag an expense from an unrelated earlier month when a later month's income changes", () => {
    const income: IncomeRecordInput[] = [
      { memberId: A, month: month(2026, 1), netAmount: 300000 },
      { memberId: B, month: month(2026, 1), netAmount: 200000 },
      { memberId: A, month: month(2026, 2), netAmount: 300000 },
      { memberId: B, month: month(2026, 2), netAmount: 200000 },
    ];
    const { shares: januaryShares } = computeExpenseShares(
      100000,
      A,
      { type: "PROPORTIONAL" },
      members,
      income,
      month(2026, 1)
    );

    // February's income changes; January's own income records are untouched.
    const editedIncome = income.map((r) =>
      r.memberId === B && r.month.getTime() === month(2026, 2).getTime() ? { ...r, netAmount: 999999 } : r
    );

    const impact = findIncomeEditImpact(
      [{ id: "january-rent", date: month(2026, 1), amountCents: 100000, paidByMemberId: A, storedShares: januaryShares }],
      members,
      editedIncome
    );

    expect(impact).toEqual([]);
  });
});

describe("findSettlementImpact", () => {
  // The exact scenario found live: A/B 60/40, A pays 1000 rent, B already
  // settled their 400 share in full (balance is 0 both ways). B's income
  // is then edited so the ratio becomes ~42.857/57.143 — recalculating
  // would retroactively change what B's "already settled" payment covers.
  const rentShares = [{ memberId: "A", owedAmount: 60000 }, { memberId: "B", owedAmount: 40000 }];
  const newRentShares = [{ memberId: "A", owedAmount: 42857 }, { memberId: "B", owedAmount: 57143 }];
  const allExpenses = [{ id: "rent", paidByMemberId: "A", shares: rentShares, isShared: true }];
  const settlements = [{ fromMemberId: "B", toMemberId: "A", amountCents: 40000 }];

  it("reports the before/after balance swing for both parties to the settlement", () => {
    const impact = findSettlementImpact(allExpenses, new Map([["rent", newRentShares]]), settlements);

    expect(impact).toEqual(
      expect.arrayContaining([
        { memberId: "A", balanceBeforeCents: 0, balanceAfterCents: 17143, relatedSettlementsCents: 40000 },
        { memberId: "B", balanceBeforeCents: 0, balanceAfterCents: -17143, relatedSettlementsCents: 40000 },
      ])
    );
  });

  it("reports nothing when there are no settlements at all — ordinary share-diff warning is enough", () => {
    const impact = findSettlementImpact(allExpenses, new Map([["rent", newRentShares]]), []);
    expect(impact).toEqual([]);
  });

  it("reports nothing when the recalculation wouldn't actually change anyone's balance", () => {
    const impact = findSettlementImpact(allExpenses, new Map([["rent", rentShares]]), settlements); // "new" shares identical to old
    expect(impact).toEqual([]);
  });

  it("ignores a settlement between members who aren't affected by this recalculation", () => {
    const unrelatedSettlements = [{ fromMemberId: "C", toMemberId: "D", amountCents: 5000 }];
    const impact = findSettlementImpact(allExpenses, new Map([["rent", newRentShares]]), unrelatedSettlements);
    expect(impact).toEqual([]);
  });
});
