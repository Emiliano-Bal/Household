import Link from "next/link";
import { getBudgetLimits, getHousehold, listCategories } from "@/lib/queries";
import { formatCents } from "@/lib/money";
import { monthStart, monthKey } from "@/lib/month";
import { BudgetLimitInput } from "@/components/budget-forms";
import { CategoryQuickAdd } from "@/components/household-setup";
import { CategoryKindEditor } from "@/components/category-kind-editor";

export default async function BudgetPage({ params }: { params: Promise<{ householdId: string }> }) {
  const { householdId } = await params;
  // Limits are standing, not per-month, so this screen has no month
  // navigation: editing sets the limit from the current month onward.
  const thisMonth = monthStart(new Date());

  const [household, limits, categories] = await Promise.all([
    getHousehold(householdId),
    getBudgetLimits(householdId, thisMonth),
    listCategories(householdId),
  ]);
  if (!household) return null;

  const totalCents = limits.reduce((sum, l) => sum + (l.limitCents ?? 0), 0);
  const limitedCount = limits.filter((l) => l.limitCents !== null).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Adjust budget limits</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          A limit is a monthly ceiling for a <span className="font-medium text-slate-700">variable</span> category —
          one you decide how much to spend on. Set it once and it applies every month; only the spending against it
          resets. Fixed commitments like rent and utilities are not listed here: the bill is what it is.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Spending against these limits lives on the{" "}
          <Link href={`/h/${householdId}?month=${monthKey(thisMonth)}`} className="font-medium underline">
            Dashboard
          </Link>
          .
        </p>
      </div>

      {limits.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
          This household has no variable categories yet, so there is nothing to limit. Add one below — a category has
          to be of kind <span className="font-medium">Variable</span> to get a limit.
        </p>
      ) : (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Variable categories</h2>
            <span className="text-xs text-slate-400">
              {limitedCount} of {limits.length} limited
            </span>
          </div>

          <table className="w-full text-sm">
            <tbody>
              {limits.map((limit) => (
                <tr key={limit.categoryId} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-5 py-2.5 font-medium text-slate-800">{limit.categoryName}</td>
                  <td className="w-48 px-5 py-2.5 text-right">
                    <BudgetLimitInput
                      householdId={householdId}
                      categoryId={limit.categoryId}
                      categoryName={limit.categoryName}
                      limitCents={limit.limitCents}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <td className="px-5 py-3 font-medium text-slate-700">Total budgeted per month</td>
                <td className="px-5 py-3 text-right text-base font-semibold text-slate-900">
                  {formatCents(totalCents)}
                </td>
              </tr>
            </tfoot>
          </table>

          <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-400">
            Leave a box empty for no limit. Changes apply from {monthKey(thisMonth)} onward — earlier months keep
            reporting against whatever limit they were measured by.
          </p>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">All categories</h2>
          <p className="mt-1 text-xs text-slate-400">
            A category&apos;s kind decides which total its spending lands in on the Dashboard — Fixed, Variable or
            Savings — and only Variable ones can carry a limit. If a standing commitment is showing up under variable
            spending, it is filed under a Variable category; change it here.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[26rem] text-sm">
            <tbody>
              {categories.map((category) => (
                <tr key={category.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-5 py-2 font-medium text-slate-800">{category.name}</td>
                  <td className="w-40 px-5 py-2 text-right">
                    <CategoryKindEditor
                      householdId={householdId}
                      categoryId={category.id}
                      categoryName={category.name}
                      kind={category.kind}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-400">
          Changing a kind reclassifies that category&apos;s spending in every month, past ones included. No money
          moves — only which total it is counted in.
        </p>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 px-4 py-3">
        <span className="text-xs text-slate-400">Need a category you don&apos;t see — &ldquo;Cinema&rdquo;, say?</span>
        <CategoryQuickAdd householdId={householdId} />
      </div>
    </div>
  );
}
