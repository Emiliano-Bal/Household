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

export const createRecurringExpenseSchema = z
  .object({
    householdId: z.string().min(1),
    categoryId: z.string().min(1),
    label: z.string().min(1),
    amount: z.number().int().positive(),
    frequency: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
    interval: z.number().int().min(1).max(52).default(1),
    // 29-31 is allowed and kept as written; it is clamped per month when
    // occurrences are read, so "the 31st" still means the 31st.
    dayOfMonth: z.number().int().min(1).max(31).nullable(),
    // 0 = Sunday .. 6 = Saturday.
    dayOfWeek: z.number().int().min(0).max(6).nullable(),
    startMonth: z.coerce.date(),
    endMonth: z.coerce.date().nullable(),
    paidByMemberId: z.string().min(1),
    splitRule: splitRuleSchema,
  })
  // A rule that cannot say when it fires would silently generate nothing,
  // so the mismatch is rejected at the boundary instead.
  .refine((d) => (d.frequency === "WEEKLY" ? d.dayOfWeek !== null : d.dayOfMonth !== null), {
    message: "Weekly rules need a day of the week; the others need a day of the month.",
    path: ["dayOfMonth"],
  });

// createRecurringExpenseSchema is a ZodEffects (it has a .refine), so it
// has no .extend — the id is intersected on instead.
export const updateRecurringExpenseSchema = z.intersection(
  createRecurringExpenseSchema,
  z.object({ id: z.string().min(1) })
);

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

// amount null means "stop limiting this category"; 0 is a real limit of
// zero, which is a meaningful thing to set. The two are kept distinct.
export const setBudgetLimitSchema = z.object({
  householdId: z.string().min(1),
  categoryId: z.string().min(1),
  amount: z.number().int().min(0).nullable(),
});
