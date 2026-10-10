import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  allocateByRatio,
  computeBalances,
  computeExpenseShares,
  computeIncomeShares,
  previewSettlement,
  simplifySettlements,
  SplitValidationError,
  type MemberInput,
  type IncomeRecordInput,
} from "./splitting";

const A = "member-a";
const B = "member-b";
const C = "member-c";

function month(y: number, m: number): Date {
  return new Date(Date.UTC(y, m - 1, 1));
}

const members: MemberInput[] = [
  { id: A, active: true },
  { id: B, active: true },
];

describe("worked example from the spec", () => {
  // A earns 3000 net, B earns 2000 net. Shares: A 60%, B 40%.
  // A pays 1000 rent (PROPORTIONAL). B owes A 400.
  // B pays 150 groceries (PROPORTIONAL). A owes B 90.
  // Net: B owes A 310.
  const income: IncomeRecordInput[] = [
    { memberId: A, month: month(2026, 1), netAmount: 300000 },
    { memberId: B, month: month(2026, 1), netAmount: 200000 },
  ];

  it("computes 60/40 income shares", () => {
    const { shares, warnings } = computeIncomeShares(members, income, month(2026, 1));
    expect(shares.get(A)!.toNumber()).toBeCloseTo(0.6, 10);
    expect(shares.get(B)!.toNumber()).toBeCloseTo(0.4, 10);
    expect(warnings).toEqual([]);
  });

  it("splits rent 60/40 so B owes A 400 (of a 1000 rent)", () => {
    const rentCents = 100000; // $1000.00
    const { shares } = computeExpenseShares(rentCents, A, { type: "PROPORTIONAL" }, members, income, month(2026, 1));
    const bShare = shares.find((s) => s.memberId === B)!;
    const aShare = shares.find((s) => s.memberId === A)!;
    expect(bShare.owedAmount).toBe(40000); // $400.00
    expect(aShare.owedAmount).toBe(60000); // $600.00
    expect(aShare.owedAmount + bShare.owedAmount).toBe(rentCents);
  });

  it("splits groceries 60/40 so A owes B 90 (of a 150 groceries bill)", () => {
    const groceriesCents = 15000; // $150.00
    const { shares } = computeExpenseShares(groceriesCents, B, { type: "PROPORTIONAL" }, members, income, month(2026, 1));
    const aShare = shares.find((s) => s.memberId === A)!;
    const bShare = shares.find((s) => s.memberId === B)!;
    expect(aShare.owedAmount).toBe(9000); // $90.00
    expect(bShare.owedAmount).toBe(6000); // $60.00
  });

  it("nets out to B owing A 310", () => {
    const rent = computeExpenseShares(100000, A, { type: "PROPORTIONAL" }, members, income, month(2026, 1));
    const groceries = computeExpenseShares(15000, B, { type: "PROPORTIONAL" }, members, income, month(2026, 1));

    const balances = computeBalances(
      [
        { id: "rent", paidByMemberId: A, shares: rent.shares, isShared: true },
        { id: "groceries", paidByMemberId: B, shares: groceries.shares, isShared: true },
      ],
      []
    );

    expect(balances.get(A)!.toNumber()).toBe(31000); // A is owed $310.00 net
    expect(balances.get(B)!.toNumber()).toBe(-31000); // B owes $310.00 net

    const transfers = simplifySettlements(balances);
    expect(transfers).toEqual([{ fromMemberId: B, toMemberId: A, amountCents: 31000 }]);
  });
});

describe("split rules", () => {
  const income: IncomeRecordInput[] = [
    { memberId: A, month: month(2026, 1), netAmount: 300000 },
    { memberId: B, month: month(2026, 1), netAmount: 200000 },
  ];

  it("EQUAL splits evenly regardless of income", () => {
    const { shares } = computeExpenseShares(10000, A, { type: "EQUAL" }, members, income, month(2026, 1));
    expect(shares).toEqual(
      expect.arrayContaining([
        { memberId: A, owedAmount: 5000 },
        { memberId: B, owedAmount: 5000 },
      ])
    );
  });

  it("EXACT uses the given per-member amounts when they sum correctly", () => {
    const { shares } = computeExpenseShares(
      10000,
      A,
      { type: "EXACT", amounts: { [A]: 7000, [B]: 3000 } },
      members,
      income,
      month(2026, 1)
    );
    expect(shares).toEqual([{ memberId: A, owedAmount: 7000 }, { memberId: B, owedAmount: 3000 }]);
  });

  it("EXACT rejects amounts that don't sum to the expense total", () => {
    expect(() =>
      computeExpenseShares(10000, A, { type: "EXACT", amounts: { [A]: 7000, [B]: 2000 } }, members, income, month(2026, 1))
    ).toThrow(SplitValidationError);
  });

  it("PERCENTAGE allocates by the given percentages", () => {
    const { shares } = computeExpenseShares(
      10000,
      A,
      { type: "PERCENTAGE", percentages: { [A]: 70, [B]: 30 } },
      members,
      income,
      month(2026, 1)
    );
    expect(shares).toEqual(
      expect.arrayContaining([
        { memberId: A, owedAmount: 7000 },
        { memberId: B, owedAmount: 3000 },
      ])
    );
  });

  it("PERCENTAGE rejects percentages that don't sum to 100", () => {
    expect(() =>
      computeExpenseShares(10000, A, { type: "PERCENTAGE", percentages: { [A]: 70, [B]: 20 } }, members, income, month(2026, 1))
    ).toThrow(SplitValidationError);
  });

  it("SOLO assigns the full amount to the payer and nothing to anyone else", () => {
    const { shares } = computeExpenseShares(10000, A, { type: "SOLO" }, members, income, month(2026, 1));
    expect(shares).toEqual([{ memberId: A, owedAmount: 10000 }]);
  });

  it("SOLO expenses are excluded from household balances", () => {
    const { shares } = computeExpenseShares(10000, A, { type: "SOLO" }, members, income, month(2026, 1));
    const balances = computeBalances([{ id: "e1", paidByMemberId: A, shares, isShared: false }], []);
    expect(balances.size).toBe(0);
  });
});

describe("remainder cent allocation", () => {
  it("shares always sum exactly to the original amount, never drifting from rounding", () => {
    // $100.01 split 1/3 / 1/3 / 1/3 doesn't divide evenly into cents.
    const ratios = new Map([
      [A, new Decimal(1).dividedBy(3)],
      [B, new Decimal(1).dividedBy(3)],
      [C, new Decimal(1).dividedBy(3)],
    ]);
    const shares = allocateByRatio(10001, ratios);
    const total = shares.reduce((sum, s) => sum + s.owedAmount, 0);
    expect(total).toBe(10001);
  });

  it("gives the leftover cent to the largest fractional remainder (here, that happens to coincide with the largest ratio)", () => {
    const ratios = new Map([
      [A, new Decimal("0.6")],
      [B, new Decimal("0.4")],
    ]);
    // 101 cents at 60/40 floors to 60/40 with 1 cent left over (remainders: A=0.6, B=0.4).
    const shares = allocateByRatio(101, ratios);
    expect(shares).toEqual(
      expect.arrayContaining([
        { memberId: A, owedAmount: 61 },
        { memberId: B, owedAmount: 40 },
      ])
    );
  });

  it("largest-remainder (Hamilton): leftover cents go to the biggest remainders, NOT necessarily the biggest ratio", () => {
    // Ratios 50/25/25 of 3 cents: exact = 1.5 / 0.75 / 0.75, floors = 1/0/0,
    // leftover = 2. A has the biggest RATIO but the smallest REMAINDER
    // (0.5); B and C have smaller ratios but the two largest remainders
    // (0.75 each). Under the old "winner takes all" rule A would have
    // absorbed both leftover cents (3/0/0) — Hamilton instead gives one
    // each to B and C.
    const ratios = new Map([
      [A, new Decimal("0.5")],
      [B, new Decimal("0.25")],
      [C, new Decimal("0.25")],
    ]);
    const shares = allocateByRatio(3, ratios);
    expect(shares).toEqual(
      expect.arrayContaining([
        { memberId: A, owedAmount: 1 },
        { memberId: B, owedAmount: 1 },
        { memberId: C, owedAmount: 1 },
      ])
    );
  });

  it("breaks exact remainder ties by larger ratio, then by memberId ascending, independent of map insertion order", () => {
    const ratiosOrderA = new Map([
      [B, new Decimal("0.5")],
      [A, new Decimal("0.5")],
    ]);
    const ratiosOrderB = new Map([
      [A, new Decimal("0.5")],
      [B, new Decimal("0.5")],
    ]);
    // 1 odd cent with a perfect 50/50 tie (equal remainder AND equal ratio) — A wins both times regardless of insertion order.
    expect(allocateByRatio(1, ratiosOrderA)).toEqual(
      expect.arrayContaining([{ memberId: A, owedAmount: 1 }, { memberId: B, owedAmount: 0 }])
    );
    expect(allocateByRatio(1, ratiosOrderB)).toEqual(
      expect.arrayContaining([{ memberId: A, owedAmount: 1 }, { memberId: B, owedAmount: 0 }])
    );
  });

  it("no member ever receives more than one cent above their exact floor", () => {
    const ratios = new Map([
      [A, new Decimal("0.34")],
      [B, new Decimal("0.33")],
      [C, new Decimal("0.33")],
    ]);
    for (let amountCents = 1; amountCents <= 20; amountCents++) {
      const shares = allocateByRatio(amountCents, ratios);
      for (const share of shares) {
        const ratio = ratios.get(share.memberId)!;
        const floor = new Decimal(amountCents).times(ratio).floor().toNumber();
        expect(share.owedAmount).toBeGreaterThanOrEqual(floor);
        expect(share.owedAmount).toBeLessThanOrEqual(floor + 1);
      }
    }
  });
});

describe("allocateByRatio property test (1000 random cases)", () => {
  it("always sums exactly to the amount, and across many runs no member is systematically favored for the leftover cent(s)", () => {
    // Fixed 4-member group every trial (only the ratios and amount vary)
    // so every id gets the exact same number of opportunities to win a
    // leftover cent — a prerequisite for comparing win counts at all.
    // An earlier version of this test varied the group size per trial,
    // which silently gave the later ids fewer opportunities than the
    // earlier ones and produced a spurious failure unrelated to the
    // algorithm; fixed group size removes that confound.
    const memberIds = ["m1", "m2", "m3", "m4"];
    const winCounts = new Map<string, number>(memberIds.map((id) => [id, 0]));
    let totalWins = 0;

    for (let trial = 0; trial < 1000; trial++) {
      const amountCents = 1 + Math.floor(Math.random() * 1_000_000);

      // Random ratios, randomly shuffled onto member ids each trial so no
      // id is correlated with ratio size across the 1000 trials.
      const rawRatios = memberIds.map(() => Math.random() + 1e-9);
      const total = rawRatios.reduce((a, b) => a + b, 0);
      const shuffledIds = [...memberIds].sort(() => Math.random() - 0.5);
      const ratios = new Map(shuffledIds.map((id, i) => [id, new Decimal(rawRatios[i]).dividedBy(total)]));

      const shares = allocateByRatio(amountCents, ratios);

      // Property 1: shares always sum exactly to the original amount.
      const sum = shares.reduce((s, share) => s + share.owedAmount, 0);
      expect(sum).toBe(amountCents);

      // Property 2: nobody gets more than one cent above their exact floor.
      for (const [memberId, ratio] of ratios) {
        const floor = new Decimal(amountCents).times(ratio).floor().toNumber();
        const actual = shares.find((s) => s.memberId === memberId)!.owedAmount;
        expect(actual).toBeGreaterThanOrEqual(floor);
        expect(actual).toBeLessThanOrEqual(floor + 1);
        if (actual > floor) {
          winCounts.set(memberId, winCounts.get(memberId)! + 1);
          totalWins++;
        }
      }
    }

    // Property 3: no systematic favoritism. With ratios randomly shuffled
    // onto ids every trial and every id participating in all 1000 trials,
    // each id's share of total "won an extra cent" events should land
    // near 1/4 of the total. Generous tolerance (0.5x to 1.5x the
    // expected share) to avoid flaking on random variance while still
    // catching a real bug (e.g. tie-breaking on array index instead of
    // memberId, which would skew heavily toward one id).
    const expectedShare = totalWins / memberIds.length;
    for (const [memberId, count] of winCounts) {
      expect(count, `memberId ${memberId} win count`).toBeGreaterThan(expectedShare * 0.5);
      expect(count, `memberId ${memberId} win count`).toBeLessThan(expectedShare * 1.5);
    }
  });
});

describe("income fallback to a prior month", () => {
  it("falls back to the most recent prior month and warns PRIOR_MONTH_FALLBACK when a member has no record for the requested month", () => {
    const income: IncomeRecordInput[] = [
      { memberId: A, month: month(2026, 1), netAmount: 300000 },
      { memberId: B, month: month(2026, 1), netAmount: 200000 },
      // B has no February record — should fall back to January's 200000.
      { memberId: A, month: month(2026, 2), netAmount: 300000 },
    ];

    const { shares, warnings, usedEqualSplitFallback } = computeIncomeShares(members, income, month(2026, 2));
    expect(shares.get(A)!.toNumber()).toBeCloseTo(0.6, 10);
    expect(shares.get(B)!.toNumber()).toBeCloseTo(0.4, 10);
    expect(warnings).toEqual([
      { memberId: B, requestedMonth: "2026-02", type: "PRIOR_MONTH_FALLBACK", fallbackMonth: "2026-01" },
    ]);
    // A has real income this month, so this is NOT a household-wide
    // equal-split fallback — just B individually borrowing a prior month.
    expect(usedEqualSplitFallback).toBe(false);
  });

  it("warns NO_INCOME_ON_RECORD (fallbackMonth null) when a member has never had any income on record", () => {
    const income: IncomeRecordInput[] = [{ memberId: A, month: month(2026, 1), netAmount: 300000 }];
    const { warnings, usedEqualSplitFallback } = computeIncomeShares(members, income, month(2026, 1));
    expect(warnings).toEqual([
      { memberId: B, requestedMonth: "2026-01", type: "NO_INCOME_ON_RECORD", fallbackMonth: null },
    ]);
    // A still has real income, so the household total isn't zero — this
    // is an individual gap, not an equal-split fallback.
    expect(usedEqualSplitFallback).toBe(false);
  });

  it("sets usedEqualSplitFallback and falls back to an equal split when NOBODY has any income on record", () => {
    const { shares, warnings, usedEqualSplitFallback } = computeIncomeShares(members, [], month(2026, 1));
    expect(shares.get(A)!.toNumber()).toBe(0.5);
    expect(shares.get(B)!.toNumber()).toBe(0.5);
    expect(usedEqualSplitFallback).toBe(true);
    expect(warnings).toEqual(
      expect.arrayContaining([
        { memberId: A, requestedMonth: "2026-01", type: "NO_INCOME_ON_RECORD", fallbackMonth: null },
        { memberId: B, requestedMonth: "2026-01", type: "NO_INCOME_ON_RECORD", fallbackMonth: null },
      ])
    );
  });

  it("does NOT set usedEqualSplitFallback merely because one member is on prior-month fallback — only when the household total is zero", () => {
    const income: IncomeRecordInput[] = [
      { memberId: A, month: month(2026, 1), netAmount: 300000 },
      { memberId: A, month: month(2026, 2), netAmount: 300000 },
      // B has income in January only; by February B falls back to it.
      { memberId: B, month: month(2026, 1), netAmount: 200000 },
    ];
    const { usedEqualSplitFallback } = computeIncomeShares(members, income, month(2026, 2));
    expect(usedEqualSplitFallback).toBe(false);
  });

  it("propagates usedEqualSplitFallback through computeExpenseShares for PROPORTIONAL, but never for other split rules", () => {
    const proportional = computeExpenseShares(10000, A, { type: "PROPORTIONAL" }, members, [], month(2026, 1));
    expect(proportional.usedEqualSplitFallback).toBe(true);

    const equalRule = computeExpenseShares(10000, A, { type: "EQUAL" }, members, [], month(2026, 1));
    expect(equalRule.usedEqualSplitFallback).toBe(false);

    const solo = computeExpenseShares(10000, A, { type: "SOLO" }, members, [], month(2026, 1));
    expect(solo.usedEqualSplitFallback).toBe(false);
  });

  it("excludes inactive members from the ratio entirely", () => {
    const withInactive: MemberInput[] = [...members, { id: C, active: false }];
    const income: IncomeRecordInput[] = [
      { memberId: A, month: month(2026, 1), netAmount: 300000 },
      { memberId: B, month: month(2026, 1), netAmount: 200000 },
      { memberId: C, month: month(2026, 1), netAmount: 1000000 },
    ];
    const { shares } = computeIncomeShares(withInactive, income, month(2026, 1));
    expect(shares.has(C)).toBe(false);
    expect(shares.get(A)!.toNumber()).toBeCloseTo(0.6, 10);
  });
});

describe("simplifySettlements", () => {
  it("produces no transfers when everyone is already even", () => {
    const balances = new Map([[A, new Decimal(0)], [B, new Decimal(0)]]);
    expect(simplifySettlements(balances)).toEqual([]);
  });

  it("resolves a 3-way cycle in the minimum number of transfers a greedy match can find", () => {
    // A is owed 100 net, B owes 60, C owes 40.
    const balances = new Map([
      [A, new Decimal(10000)],
      [B, new Decimal(-6000)],
      [C, new Decimal(-4000)],
    ]);
    const transfers = simplifySettlements(balances);
    expect(transfers).toEqual([
      { fromMemberId: B, toMemberId: A, amountCents: 6000 },
      { fromMemberId: C, toMemberId: A, amountCents: 4000 },
    ]);
  });

  it("settlements recorded against a balance bring it back to zero", () => {
    const balances = computeBalances(
      [{ id: "e1", paidByMemberId: A, shares: [{ memberId: A, owedAmount: 0 }, { memberId: B, owedAmount: 31000 }], isShared: true }],
      [{ fromMemberId: B, toMemberId: A, amountCents: 31000 }]
    );
    expect(balances.get(A)!.toNumber()).toBe(0);
    expect(balances.get(B)!.toNumber()).toBe(0);
  });
});

describe("previewSettlement", () => {
  it("allows a payment that exactly matches the debt, with no overpayment", () => {
    const balances = new Map([[A, new Decimal(39000)], [B, new Decimal(-39000)]]); // A owed 390, B owes 390
    const preview = previewSettlement(balances, B, A, 39000);
    expect(preview.isOverpayment).toBe(false);
    expect(preview.overpaidByCents).toBe(0);
    expect(preview.fromBalanceAfterCents).toBe(0);
    expect(preview.toBalanceAfterCents).toBe(0);
  });

  // The spec's exact example: B owes 390, pays 500 — the balance should
  // flip to A owing B 110, flagged as an overpayment of 110.
  it("flags an overpayment and reports the flipped balance — B owes 390, pays 500, A ends up owing B 110", () => {
    const balances = new Map([[A, new Decimal(39000)], [B, new Decimal(-39000)]]);
    const preview = previewSettlement(balances, B, A, 50000);

    expect(preview.isOverpayment).toBe(true);
    expect(preview.overpaidByCents).toBe(11000);
    expect(preview.fromBalanceAfterCents).toBe(11000); // B is now OWED 110 (a net creditor)
    expect(preview.toBalanceAfterCents).toBe(-11000); // A now OWES 110
  });

  it("treats any payment at all as an overpayment when the payer isn't a debtor to begin with", () => {
    const balances = new Map([[A, new Decimal(0)], [B, new Decimal(0)]]); // already settled
    const preview = previewSettlement(balances, B, A, 1000);
    expect(preview.isOverpayment).toBe(true);
    expect(preview.overpaidByCents).toBe(1000);
  });

  it("treats a payment from the actual creditor (not the debtor) as fully an overpayment too", () => {
    // A is the one who is OWED money; A "paying" B is not settling any debt of A's.
    const balances = new Map([[A, new Decimal(39000)], [B, new Decimal(-39000)]]);
    const preview = previewSettlement(balances, A, B, 10000);
    expect(preview.isOverpayment).toBe(true);
    expect(preview.overpaidByCents).toBe(10000);
  });

  it("does not flag a partial payment within what's owed", () => {
    const balances = new Map([[A, new Decimal(59000)], [B, new Decimal(-59000)]]); // B owes 590
    const preview = previewSettlement(balances, B, A, 20000); // pays 200
    expect(preview.isOverpayment).toBe(false);
    expect(preview.fromBalanceAfterCents).toBe(-39000); // still owing 390
    expect(preview.toBalanceAfterCents).toBe(39000);
  });
});
