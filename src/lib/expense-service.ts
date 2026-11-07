import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { buildStoredIncomeRatioSnapshot, computeExpenseShares, type SplitRule } from "./splitting";
import { createExpenseSchema } from "./schemas";
import type { z } from "zod";

/**
 * Creating an expense, independent of who is asking.
 *
 * Lifted out of the `createExpense` server action so the Telegram webhook
 * can reuse it: actions.ts carries a "use server" directive, and a route
 * handler importing that module pulls in the whole server-action runtime
 * for no reason. The splitting itself was already shared — this only
 * moves the persistence around it.
 *
 * Deliberately does NOT call revalidatePath: cache invalidation is a
 * concern of the caller's context, and a webhook has no page to
 * revalidate at the moment it writes. The server action still does it.
 */
export async function membersAndIncomeFor(householdId: string) {
  const [members, incomeRecords] = await Promise.all([
    prisma.member.findMany({ where: { householdId } }),
    prisma.incomeRecord.findMany({ where: { member: { householdId } } }),
  ]);
  return {
    members: members.map((m) => ({ id: m.id, active: m.active })),
    incomeRecords: incomeRecords.map((r) => ({ memberId: r.memberId, month: r.month, netAmount: r.netAmount })),
  };
}

export async function createExpenseRecord(input: z.infer<typeof createExpenseSchema>) {
  const data = createExpenseSchema.parse(input);
  const { members, incomeRecords } = await membersAndIncomeFor(data.householdId);

  // Shares are priced by the ratio in effect on the expense's own date,
  // not today's — the same rule the web app follows.
  const shareResult = computeExpenseShares(
    data.amount,
    data.paidByMemberId,
    data.splitRule,
    members,
    incomeRecords,
    data.date
  );
  const storedSnapshot = buildStoredIncomeRatioSnapshot(shareResult);

  return prisma.expense.create({
    data: {
      householdId: data.householdId,
      date: data.date,
      label: data.label,
      amount: data.amount,
      categoryId: data.categoryId,
      paidByMemberId: data.paidByMemberId,
      splitRule: data.splitRule satisfies SplitRule,
      isShared: data.isShared,
      incomeRatioSnapshot: (storedSnapshot as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
      shares: { create: shareResult.shares.map((s) => ({ memberId: s.memberId, owedAmount: s.owedAmount })) },
    },
  });
}
