// Integration test against a REAL database — requires DATABASE_URL to
// point at a reachable, migrated Postgres. Run with `npm run test:db`.
//
// Proves the fix for the NULL-duplicate hole: IncomeRecord.source is now
// non-nullable with a default of "General" instead of nullable, so two
// income records for the same member/month with NO source supplied both
// resolve to "General" and collide on the unique constraint for real —
// unlike the old nullable column, where Postgres treated NULL as distinct
// from NULL and let exactly this duplicate through silently.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./db";

describe("IncomeRecord uniqueness with no source supplied (real DB)", () => {
  let householdId: string;
  let memberId: string;
  const month = new Date(Date.UTC(2026, 7, 1));

  beforeAll(async () => {
    const household = await prisma.household.create({ data: { name: "__test__ income record uniqueness" } });
    householdId = household.id;
    const member = await prisma.member.create({ data: { householdId, name: "Test" } });
    memberId = member.id;
  });

  afterAll(async () => {
    await prisma.household.delete({ where: { id: householdId } });
    await prisma.$disconnect();
  });

  it("defaults an omitted source to 'General'", async () => {
    const record = await prisma.incomeRecord.create({ data: { memberId, month, netAmount: 100000 } });
    expect(record.source).toBe("General");
  });

  it("rejects a second no-source income record for the same member/month — both resolve to 'General' and collide", async () => {
    await expect(prisma.incomeRecord.create({ data: { memberId, month, netAmount: 999999 } })).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("still allows a second record for the same member/month when an explicit, different source is given", async () => {
    const record = await prisma.incomeRecord.create({ data: { memberId, month, netAmount: 50000, source: "Freelance" } });
    expect(record.source).toBe("Freelance");

    const all = await prisma.incomeRecord.findMany({ where: { memberId, month } });
    expect(all).toHaveLength(2); // the "General" one from the first test, plus this "Freelance" one
  });

  it("still rejects a duplicate explicit source, same as before", async () => {
    await expect(
      prisma.incomeRecord.create({ data: { memberId, month, netAmount: 1, source: "Freelance" } })
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
