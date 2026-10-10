import type { CategoryKind } from "@prisma/client";

/**
 * The starter category set every new household gets, so the expense form is
 * usable immediately instead of presenting an empty dropdown.
 *
 * `kind` is what drives the fixed/variable/savings breakdown on the
 * dashboard, so each entry is classified the way a typical household would:
 * FIXED for commitments that recur at a near-constant amount, VARIABLE for
 * discretionary or fluctuating spending, SAVINGS for money set aside rather
 * than consumed.
 *
 * This is deliberately a short, generic list — households are expected to
 * add their own via CategoryQuickAdd, and a long list is harder to pick from
 * than it is useful.
 */
export const DEFAULT_CATEGORIES: { name: string; kind: CategoryKind }[] = [
  // Fixed commitments.
  { name: "Rent / Mortgage", kind: "FIXED" },
  { name: "Electricity & Gas", kind: "FIXED" },
  { name: "Water", kind: "FIXED" },
  { name: "Internet & Phone", kind: "FIXED" },
  { name: "Insurance", kind: "FIXED" },
  { name: "Subscriptions", kind: "FIXED" },

  // Day-to-day, fluctuating.
  { name: "Groceries", kind: "VARIABLE" },
  { name: "Eating Out", kind: "VARIABLE" },
  { name: "Transport", kind: "VARIABLE" },
  { name: "Health & Pharmacy", kind: "VARIABLE" },
  { name: "Home & Supplies", kind: "VARIABLE" },
  { name: "Personal Care", kind: "VARIABLE" },
  { name: "Entertainment", kind: "VARIABLE" },
  { name: "Clothing", kind: "VARIABLE" },
  { name: "Travel", kind: "VARIABLE" },
  { name: "Other", kind: "VARIABLE" },

  // Set aside, not consumed.
  { name: "Savings", kind: "SAVINGS" },
];
