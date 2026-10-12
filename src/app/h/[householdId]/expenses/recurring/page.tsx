import { listRecurringExpenses, listCategories, getHousehold } from "@/lib/queries";
import { formatCents } from "@/lib/money";
import { monthStart } from "@/lib/month";
import { MonthNav } from "@/components/month-nav";
import { RecurringForm } from "@/components/recurring-form";
import { GenerateRecurringButton } from "@/components/generate-recurring-button";
import type { SplitRule } from "@/lib/splitting";
import { describeRecurrence, nextOccurrence, type RecurringExpenseInput } from "@/lib/recurring";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function parseMonth(value: string | undefined): Date {
  if (!value) return monthStart(new Date());
  const [y, m] = value.split("-").map(Number);
  if (!y || !m) return monthStart(new Date());
  return new Date(Date.UTC(y, m - 1, 1));
}

function splitRuleLabel(rule: SplitRule): string {
  switch (rule.type) {
    case "PROPORTIONAL":
      return "Proportional";
    case "EQUAL":
      return "Equal";
    case "EXACT":
      return "Exact amounts";
    case "PERCENTAGE":
      return "Percentages";
    case "SOLO":
      return "Solo";
  }
}

export default async function RecurringPage({
  params,
  searchParams,
}: {
  params: Promise<{ householdId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { householdId } = await params;
  const { month: monthParam } = await searchParams;
  const month = parseMonth(monthParam);

  const [household, categories, recurring] = await Promise.all([
    getHousehold(householdId),
    listCategories(householdId),
    listRecurringExpenses(householdId),
  ]);
  if (!household) return null;

  const members = household.members.filter((m) => m.active);
  // Next-due is relative to real "now", not the month being viewed —
  // "when does this fire next" is a question about today.
  const today = new Date();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <MonthNav householdId={householdId} month={month} basePath="/expenses/recurring" />
        <GenerateRecurringButton householdId={householdId} month={month} />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="px-4 py-2 font-medium">Label</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 font-medium">Repeats</th>
              <th className="px-4 py-2 font-medium">Next due</th>
              <th className="px-4 py-2 font-medium">Paid by</th>
              <th className="px-4 py-2 font-medium">Split</th>
              <th className="px-4 py-2 font-medium">Active range</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {recurring.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  No recurring expenses yet.
                </td>
              </tr>
            )}
            {recurring.map((r) => {
              const asRule: RecurringExpenseInput = {
                id: r.id,
                categoryId: r.categoryId,
                label: r.label,
                amount: r.amount,
                frequency: r.frequency,
                interval: r.interval,
                dayOfMonth: r.dayOfMonth,
                dayOfWeek: r.dayOfWeek,
                startMonth: r.startMonth,
                endMonth: r.endMonth,
                paidByMemberId: r.paidByMemberId,
                splitRule: r.splitRule as SplitRule,
                active: r.active,
              };
              const next = nextOccurrence(asRule, today);
              return (
              <tr key={r.id} className={`border-t border-slate-100 ${r.active ? "" : "opacity-50"}`}>
                <td className="px-4 py-2 font-medium text-slate-800">{r.label}</td>
                <td className="px-4 py-2 text-slate-500">{r.category.name}</td>
                <td className="px-4 py-2 text-slate-500">{describeRecurrence(asRule)}</td>
                <td className="px-4 py-2 text-slate-600">
                  {next ? (
                    dateFormat.format(next)
                  ) : (
                    <span className="text-slate-400">{r.active ? "—" : "paused"}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-500">{r.paidBy.name}</td>
                <td className="px-4 py-2 text-slate-500">{splitRuleLabel(r.splitRule as SplitRule)}</td>
                <td className="px-4 py-2 text-slate-500">
                  {r.startMonth.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })} –{" "}
                  {r.endMonth ? r.endMonth.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "ongoing"}
                </td>
                <td className="px-4 py-2 text-right font-medium text-slate-900">{formatCents(r.amount)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <RecurringForm householdId={householdId} members={members} categories={categories} />
    </div>
  );
}
