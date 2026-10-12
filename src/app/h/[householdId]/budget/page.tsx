import Link from "next/link";
import { getBudgetPlan, getHousehold } from "@/lib/queries";
import { formatCents, formatPercent } from "@/lib/money";
import { monthStart, monthKey } from "@/lib/month";
import { MonthNav } from "@/components/month-nav";
import { BudgetAmountInput, CopyLastMonthBudgetButton } from "@/components/budget-forms";
import { CategoryQuickAdd } from "@/components/household-setup";
import type { BudgetPlanRow } from "@/lib/queries";
import type { CategoryKind } from "@prisma/client";

function parseMonth(value: string | undefined): Date {
  if (!value) return monthStart(new Date());
  const [y, m] = value.split("-").map(Number);
  if (!y || !m) return monthStart(new Date());
  return new Date(Date.UTC(y, m - 1, 1));
}

const GROUPS: { kind: CategoryKind; label: string }[] = [
  { kind: "FIXED", label: "Fixed" },
  { kind: "VARIABLE", label: "Variable" },
  { kind: "SAVINGS", label: "Savings" },
];

export default async function BudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ householdId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { householdId } = await params;
  const { month: monthParam } = await searchParams;
  const month = parseMonth(monthParam);
  const monthStr = monthKey(month);
  const monthValue = `${monthStr}-01`;

  const [household, plan] = await Promise.all([getHousehold(householdId), getBudgetPlan(householdId, month)]);
  if (!household) return null;

  const budgetedCount = plan.rows.filter((r) => r.budgetedCents !== null).length;
  const planRemainingCents = plan.totalBudgetedCents - plan.totalActualCents;
  const unallocatedCents = plan.totalIncomeCents - plan.totalBudgetedCents;

  return (
    <div className="flex flex-col gap-6">
      <MonthNav householdId={householdId} month={month} basePath="/budget" />

      {plan.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
          This household has no categories yet, so there is nothing to budget. Add one below.
        </p>
      ) : budgetedCount === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
          <p className="font-medium text-slate-700">No budget set for {monthStr} yet.</p>
          <p className="mt-1">
            Type an amount next to any category below — &ldquo;300&rdquo; for Eating Out, &ldquo;500&rdquo; for
            Groceries. Leave a category blank to leave it unbudgeted.
          </p>
          {plan.previousMonthBudgetCount > 0 && (
            <div className="mt-3">
              <CopyLastMonthBudgetButton householdId={householdId} month={monthValue} />
            </div>
          )}
        </div>
      ) : null}

      {budgetedCount > 0 && (
        <>
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Budgeted" value={formatCents(plan.totalBudgetedCents)} sub={`${budgetedCount} categories`} />
            <StatCard
              label="Spent against plan"
              value={formatCents(plan.totalActualCents)}
              sub={
                plan.totalBudgetedCents > 0
                  ? `${formatPercent((plan.totalActualCents / plan.totalBudgetedCents) * 100, undefined, 0)} of budget`
                  : undefined
              }
            />
            <StatCard
              label={planRemainingCents < 0 ? "Over budget by" : "Left in budget"}
              value={formatCents(Math.abs(planRemainingCents))}
              tone={planRemainingCents < 0 ? "bad" : "good"}
            />
            <StatCard
              label={unallocatedCents < 0 ? "Budgeted over income" : "Income unallocated"}
              value={formatCents(Math.abs(unallocatedCents))}
              sub={`income ${formatCents(plan.totalIncomeCents)}`}
              tone={unallocatedCents < 0 ? "bad" : "neutral"}
            />
          </section>

          {unallocatedCents < 0 && (
            <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              This month&apos;s budget ({formatCents(plan.totalBudgetedCents)}) allocates more than the household
              earns ({formatCents(plan.totalIncomeCents)}). Something has to give — or income is missing from the{" "}
              <Link href={`/h/${householdId}/income?month=${monthStr}`} className="underline">
                Income
              </Link>{" "}
              screen.
            </p>
          )}
        </>
      )}

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Budget for {monthStr}</h2>
          {budgetedCount > 0 && plan.previousMonthBudgetCount > 0 && (
            <CopyLastMonthBudgetButton householdId={householdId} month={monthValue} />
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="px-5 py-2 font-medium">Category</th>
                <th className="px-5 py-2 text-right font-medium">Budget</th>
                <th className="px-5 py-2 text-right font-medium">Spent</th>
                <th className="px-5 py-2 text-right font-medium">Remaining</th>
                <th className="w-40 px-5 py-2 font-medium">Progress</th>
              </tr>
            </thead>
            {GROUPS.map(({ kind, label }) => {
              const rows = plan.rows.filter((r) => r.kind === kind);
              if (rows.length === 0) return null;
              return (
                <tbody key={kind}>
                  <tr className="bg-slate-50">
                    <td colSpan={5} className="px-5 py-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                      {label}
                    </td>
                  </tr>
                  {rows.map((row) => (
                    <BudgetRow key={row.categoryId} row={row} householdId={householdId} monthValue={monthValue} />
                  ))}
                </tbody>
              );
            })}
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-medium">
                <td className="px-5 py-3 text-slate-700">Total (budgeted categories)</td>
                <td className="px-5 py-3 text-right text-slate-900">{formatCents(plan.totalBudgetedCents)}</td>
                <td className="px-5 py-3 text-right text-slate-900">{formatCents(plan.totalActualCents)}</td>
                <td
                  className={`px-5 py-3 text-right ${planRemainingCents < 0 ? "text-red-600" : "text-emerald-600"}`}
                >
                  {formatCents(planRemainingCents)}
                </td>
                <td className="px-5 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>

        {(plan.unbudgetedActualCents > 0 || plan.uncategorizedActualCents > 0) && (
          <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
            <p className="font-medium text-slate-600">Spending outside the plan</p>
            <p className="mt-1">
              Not included in the totals above, so an unbudgeted category can&apos;t make the month look on-budget.
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {plan.unbudgetedActualCents > 0 && (
                <li>
                  In categories with no budget set:{" "}
                  <span className="font-medium text-slate-700">{formatCents(plan.unbudgetedActualCents)}</span>
                </li>
              )}
              {plan.uncategorizedActualCents > 0 && (
                <li>
                  On expenses with no category at all:{" "}
                  <span className="font-medium text-slate-700">{formatCents(plan.uncategorizedActualCents)}</span>
                </li>
              )}
            </ul>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 px-4 py-3">
        <span className="text-xs text-slate-400">Need a category you don&apos;t see — &ldquo;Cinema&rdquo;, say?</span>
        <CategoryQuickAdd householdId={householdId} />
      </div>
    </div>
  );
}

function BudgetRow({
  row,
  householdId,
  monthValue,
}: {
  row: BudgetPlanRow;
  householdId: string;
  monthValue: string;
}) {
  const over = row.remainingCents !== null && row.remainingCents < 0;
  const pct = row.usedPercent ?? 0;

  return (
    <tr className="border-t border-slate-100">
      <td className="px-5 py-2 font-medium text-slate-800">{row.categoryName}</td>
      <td className="px-5 py-2 text-right">
        <BudgetAmountInput
          householdId={householdId}
          categoryId={row.categoryId}
          month={monthValue}
          budgetedCents={row.budgetedCents}
        />
      </td>
      <td className="px-5 py-2 text-right text-slate-600">{formatCents(row.actualCents)}</td>
      <td
        className={`px-5 py-2 text-right font-medium ${
          row.remainingCents === null ? "text-slate-300" : over ? "text-red-600" : "text-emerald-600"
        }`}
      >
        {row.remainingCents === null ? "—" : formatCents(row.remainingCents)}
      </td>
      <td className="px-5 py-2">
        {row.budgetedCents === null ? (
          <span className="text-xs text-slate-300">not budgeted</span>
        ) : (
          <div className="flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${over ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <span className={`w-12 text-right text-xs ${over ? "font-medium text-red-600" : "text-slate-400"}`}>
              {formatPercent(pct, undefined, 0)}
            </span>
          </div>
        )}
      </td>
    </tr>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "neutral";
}) {
  const toneClass = tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-red-600" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
