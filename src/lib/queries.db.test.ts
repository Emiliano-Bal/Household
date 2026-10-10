// Integration test against a REAL database — requires DATABASE_URL to
// point at a reachable Postgres with the schema migrated (npm run
// db:migrate). Not part of `npm test` (which stays DB-free and always
// green); run explicitly with `npm run test:db`.
//
// Asserts getDashboardData's per-member incomeCents comes from the exact
// same resolution as computeIncomeShares — the whole point of fix #2 is
// that there is no second, hand-rolled fallback implementation to drift
// out of sync with the first.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./db";
import { getDashboardData } from "./queries";
import { computeIncomeShares } from "./splitting";
import { monthStart, addMonths } from "./month";

describe("getDashboardData income resolution (real DB)", () => {
  let householdId: string;
  let memberWithIncomeId: string;
  let memberWithoutIncomeId: string;
  const priorMonth = monthStart(new Date(2026, 0, 1));
  const targetMonth = addMonths(priorMonth, 1);

  beforeAll(async () => {
    const household = await prisma.household.create({ data: { name: "__test__ income resolution" } });
    householdId = household.id;

    const memberWithIncome = await prisma.member.create({ data: { householdId, name: "HasIncome" } });
    const memberWithoutIncome = await prisma.member.create({ data: { householdId, name: "NoIncomeThisMonth" } });
    memberWithIncomeId = memberWithIncome.id;
    memberWithoutIncomeId = memberWithoutIncome.id;

    // Both members have income in the prior month; only one has a record
    // for the target month, so the other must fall back to the prior one.
    await prisma.incomeRecord.createMany({
      data: [
        { memberId: memberWithIncomeId, month: priorMonth, netAmount: 300000 },
        { memberId: memberWithoutIncomeId, month: priorMonth, netAmount: 200000 },
        { memberId: memberWithIncomeId, month: targetMonth, netAmount: 350000 },
        // deliberately no targetMonth record for memberWithoutIncomeId
      ],
    });
  });

  afterAll(async () => {
    await prisma.household.delete({ where: { id: householdId } });
    await prisma.$disconnect();
  });

  it("matches computeIncomeShares' resolvedIncome exactly for a member with no record this month", async () => {
    const dashboard = await getDashboardData(householdId, targetMonth);

    const { resolvedIncome } = computeIncomeShares(
      [
        { id: memberWithIncomeId, active: true },
        { id: memberWithoutIncomeId, active: true },
      ],
      [
        { memberId: memberWithIncomeId, month: priorMonth, netAmount: 300000 },
        { memberId: memberWithoutIncomeId, month: priorMonth, netAmount: 200000 },
        { memberId: memberWithIncomeId, month: targetMonth, netAmount: 350000 },
      ],
      targetMonth
    );

    const dashboardByMember = new Map(dashboard.perMember.map((m) => [m.memberId, m.incomeCents]));

    expect(dashboardByMember.get(memberWithIncomeId)).toBe(resolvedIncome.get(memberWithIncomeId)!.toNumber());
    expect(dashboardByMember.get(memberWithoutIncomeId)).toBe(resolvedIncome.get(memberWithoutIncomeId)!.toNumber());

    // Concretely: the fallback member should show last month's 200000,
    // not zero and not this month's (nonexistent) record.
    expect(dashboardByMember.get(memberWithoutIncomeId)).toBe(200000);
    expect(dashboardByMember.get(memberWithIncomeId)).toBe(350000);

    // And the dashboard should have surfaced the fallback as a warning.
    expect(dashboard.incomeWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memberId: memberWithoutIncomeId, fallbackMonth: expect.any(String) }),
      ])
    );
  });
});
