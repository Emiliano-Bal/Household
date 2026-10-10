import { z } from "zod";

export const splitRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PROPORTIONAL") }),
  z.object({ type: z.literal("EQUAL") }),
  z.object({ type: z.literal("EXACT"), amounts: z.record(z.string(), z.number().int()) }),
  z.object({ type: z.literal("PERCENTAGE"), percentages: z.record(z.string(), z.number()) }),
  z.object({ type: z.literal("SOLO") }),
]);

export const createExpenseSchema = z.object({
  householdId: z.string().min(1),
  date: z.coerce.date(),
  label: z.string().min(1),
  amount: z.number().int().positive(),
  categoryId: z.string().min(1).optional(),
  paidByMemberId: z.string().min(1),
  splitRule: splitRuleSchema,
  isShared: z.boolean(),
});

export const updateExpenseSchema = createExpenseSchema.extend({
  id: z.string().min(1),
});

export const createRecurringExpenseSchema = z.object({
  householdId: z.string().min(1),
  categoryId: z.string().min(1),
  label: z.string().min(1),
  amount: z.number().int().positive(),
  dayOfMonth: z.number().int().min(1).max(31),
  startMonth: z.coerce.date(),
  endMonth: z.coerce.date().nullable(),
  paidByMemberId: z.string().min(1),
  splitRule: splitRuleSchema,
});

export const incomeRecordSchema = z.object({
  memberId: z.string().min(1),
  month: z.coerce.date(),
  netAmount: z.number().int().nonnegative(),
  source: z.string().optional(),
});

export const createMemberSchema = z.object({
  householdId: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
});

export const createSavingsGoalSchema = z.object({
  householdId: z.string().min(1),
  name: z.string().min(1),
  targetAmount: z.number().int().positive(),
  targetDate: z.coerce.date().nullable(),
});

export const createSavingsContributionSchema = z.object({
  goalId: z.string().min(1),
  memberId: z.string().min(1),
  month: z.coerce.date(),
  amount: z.number().int().positive(),
  isJoint: z.boolean(),
});

export const createSettlementSchema = z
  .object({
    householdId: z.string().min(1),
    fromMemberId: z.string().min(1),
    toMemberId: z.string().min(1),
    amount: z.number().int().positive(),
    date: z.coerce.date().optional(),
    note: z.string().optional(),
  })
  .refine((data) => data.fromMemberId !== data.toMemberId, {
    message: "Payer and payee must be different members.",
    path: ["toMemberId"],
  });
