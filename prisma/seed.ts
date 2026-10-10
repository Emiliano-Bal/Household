// Seeds one demo household that reproduces the worked example from the
// spec exactly, so you can open the Dashboard and see the numbers you
// already know are right: A earns 3000, B earns 2000 (60/40 split), A
// pays 1000 rent, B pays 150 groceries, net result: B owes A 310.
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildStoredIncomeRatioSnapshot, computeExpenseShares } from "../src/lib/splitting";
import { monthStart } from "../src/lib/month";
import { formatCents } from "../src/lib/money";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });

async function main() {
  const existing = await prisma.household.findFirst({ where: { name: "Demo Household" } });
  if (existing) {
    console.log(`"Demo Household" already exists (${existing.id}) — skipping seed. Delete it first to reseed.`);
    return;
  }

  const household = await prisma.household.create({ data: { name: "Demo Household", baseCurrency: "EUR" } });

  const memberA = await prisma.member.create({ data: { householdId: household.id, name: "A", email: "a@example.com" } });
  const memberB = await prisma.member.create({ data: { householdId: household.id, name: "B", email: "b@example.com" } });

  const month = monthStart(new Date());

  await prisma.incomeRecord.createMany({
    data: [
      { memberId: memberA.id, month, netAmount: 300000, source: "Salary" },
      { memberId: memberB.id, month, netAmount: 200000, source: "Salary" },
    ],
  });

  const fixedCategory = await prisma.category.create({ data: { householdId: household.id, name: "Fixed", kind: "FIXED" } });
  const variableCategory = await prisma.category.create({ data: { householdId: household.id, name: "Variable", kind: "VARIABLE" } });
  await prisma.category.create({ data: { householdId: household.id, name: "Savings", kind: "SAVINGS" } });

  const members = [{ id: memberA.id, active: true }, { id: memberB.id, active: true }];
  const incomeRecords = [
    { memberId: memberA.id, month, netAmount: 300000 },
    { memberId: memberB.id, month, netAmount: 200000 },
  ];

  const rentShares = computeExpenseShares(100000, memberA.id, { type: "PROPORTIONAL" }, members, incomeRecords, month);
  await prisma.expense.create({
    data: {
      householdId: household.id,
      date: month,
      label: "Rent",
      amount: 100000,
      categoryId: fixedCategory.id,
      paidByMemberId: memberA.id,
      splitRule: { type: "PROPORTIONAL" },
      isShared: true,
      incomeRatioSnapshot: (buildStoredIncomeRatioSnapshot(rentShares) as Prisma.InputJsonValue | null) ?? undefined,
      shares: { create: rentShares.shares.map((s) => ({ memberId: s.memberId, owedAmount: s.owedAmount })) },
    },
  });

  const groceriesShares = computeExpenseShares(15000, memberB.id, { type: "PROPORTIONAL" }, members, incomeRecords, month);
  await prisma.expense.create({
    data: {
      householdId: household.id,
      date: month,
      label: "Groceries",
      amount: 15000,
      categoryId: variableCategory.id,
      paidByMemberId: memberB.id,
      splitRule: { type: "PROPORTIONAL" },
      isShared: true,
      incomeRatioSnapshot: (buildStoredIncomeRatioSnapshot(groceriesShares) as Prisma.InputJsonValue | null) ?? undefined,
      shares: { create: groceriesShares.shares.map((s) => ({ memberId: s.memberId, owedAmount: s.owedAmount })) },
    },
  });

  await prisma.savingsGoal.create({
    data: { householdId: household.id, name: "Emergency fund", targetAmount: 500000 },
  });

  console.log(`Seeded "${household.name}" (${household.id}) — rent ${formatCents(100000)} by A, groceries ${formatCents(15000)} by B, both PROPORTIONAL.`);
  console.log(`Expect: B owes A ${formatCents(31000)} net on the Dashboard.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
