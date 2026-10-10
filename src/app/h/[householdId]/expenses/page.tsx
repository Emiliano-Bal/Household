import Link from "next/link";
import { listExpenses, listCategories, getHousehold, getExpense } from "@/lib/queries";
import { formatCents, formatPercent } from "@/lib/money";
import { monthStart, monthKey } from "@/lib/month";
import { MonthNav } from "@/components/month-nav";
import { ExpenseForm } from "@/components/expense-form";
import { CategoryQuickAdd } from "@/components/household-setup";
import type { SplitRule, StoredIncomeRatioSnapshot } from "@/lib/splitting";

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

export default async function ExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ householdId: string }>;
  searchParams: Promise<{ month?: string; categoryId?: string; paidBy?: string; shared?: string; expenseId?: string }>;
}) {
  const { householdId } = await params;
  const sp = await searchParams;
  const month = parseMonth(sp.month);
  const monthStr = monthKey(month);

  const [household, categories] = await Promise.all([getHousehold(householdId), listCategories(householdId)]);
  if (!household) return null;

  const members = household.members.filter((m) => m.active);
  const shared = sp.shared === "shared" || sp.shared === "personal" ? sp.shared : "all";

  const [expenses, selected] = await Promise.all([
    listExpenses(householdId, {
      month,
      categoryId: sp.categoryId || undefined,
      paidByMemberId: sp.paidBy || undefined,
      shared,
    }),
    sp.expenseId ? getExpense(sp.expenseId) : null,
  ]);

  return (
    <div className="flex flex-col gap-6">
      <MonthNav householdId={householdId} month={month} basePath="/expenses" />

      <form method="get" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="month" value={monthStr} />
        <select name="categoryId" defaultValue={sp.categoryId ?? ""} className={filterClass}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="paidBy" defaultValue={sp.paidBy ?? ""} className={filterClass}>
          <option value="">Anyone</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select name="shared" defaultValue={shared} className={filterClass}>
          <option value="all">Shared + personal</option>
          <option value="shared">Shared only</option>
          <option value="personal">Personal only</option>
        </select>
        <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
          Apply filters
        </button>
      </form>

      <div className="flex gap-6">
        <div className="flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Label</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Paid by</th>
                <th className="px-4 py-2 font-medium">Split</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No expenses match these filters.
                  </td>
                </tr>
              )}
              {expenses.map((expense) => (
                <tr key={expense.id} className={`border-t border-slate-100 ${selected?.id === expense.id ? "bg-emerald-50" : ""}`}>
                  <td className="px-4 py-2 text-slate-500">
                    {expense.date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/h/${householdId}/expenses?month=${monthStr}&expenseId=${expense.id}`}
                      className="font-medium text-slate-800 hover:text-emerald-600"
                    >
                      {expense.label}
                    </Link>
                    {!expense.isShared && (
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">personal</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-500">{expense.category?.name ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-500">{expense.paidBy.name}</td>
                  <td className="px-4 py-2 text-slate-500">{splitRuleLabel(expense.splitRule as SplitRule)}</td>
                  <td className="px-4 py-2 text-right font-medium text-slate-900">{formatCents(expense.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected && (
          <aside className="w-80 shrink-0 rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between">
              <h3 className="font-semibold text-slate-900">{selected.label}</h3>
              <Link href={`/h/${householdId}/expenses?month=${monthStr}`} className="text-xs text-slate-400 hover:text-slate-600">
                Close
              </Link>
            </div>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{formatCents(selected.amount)}</p>
            <dl className="mt-4 flex flex-col gap-2 text-sm">
              <Row label="Date" value={selected.date.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })} />
              <Row label="Category" value={selected.category?.name ?? "—"} />
              <Row label="Paid by" value={selected.paidBy.name} />
              <Row label="Split rule" value={splitRuleLabel(selected.splitRule as SplitRule)} />
              <Row label="Shared" value={selected.isShared ? "Yes" : "No — personal"} />
            </dl>

            {selected.incomeRatioSnapshot && (() => {
              const snapshot = selected.incomeRatioSnapshot as unknown as StoredIncomeRatioSnapshot;
              return (
                <div className="mt-4 rounded-md bg-slate-50 p-3 text-xs text-slate-500">
                  <p className="font-medium text-slate-600">Income ratio used</p>
                  {Object.entries(snapshot.ratios).map(([memberId, ratio]) => {
                    const member = selected.shares.find((s) => s.memberId === memberId)?.member;
                    return (
                      <p key={memberId}>
                        {member?.name ?? memberId}: {formatPercent(ratio * 100)}
                      </p>
                    );
                  })}

                  {snapshot.usedEqualSplitFallback && (
                    <p className="mt-2 font-medium text-red-600">
                      Equal-split fallback — nobody had any income on record as of this expense&apos;s date.
                    </p>
                  )}
                  {!snapshot.usedEqualSplitFallback &&
                    snapshot.warnings.map((w) => {
                      const member = selected.shares.find((s) => s.memberId === w.memberId)?.member;
                      return (
                        <p key={w.memberId} className="mt-1 font-medium text-amber-600">
                          {member?.name ?? w.memberId}:{" "}
                          {w.type === "PRIOR_MONTH_FALLBACK"
                            ? `used ${w.fallbackMonth}'s income`
                            : "had no income on record"}
                        </p>
                      );
                    })}
                </div>
              );
            })()}

            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Share breakdown</p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {selected.shares.map((share) => (
                  <li key={share.memberId} className="flex justify-between">
                    <span className="text-slate-600">{share.member.name}</span>
                    <span className="font-medium text-slate-900">{formatCents(share.owedAmount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        )}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 px-4 py-3">
        <span className="text-xs text-slate-400">
          {categories.length === 0 ? "No categories yet — add one to classify fixed/variable/savings spending." : "Need another category?"}
        </span>
        <CategoryQuickAdd householdId={householdId} />
      </div>

      {/* Every expense needs a payer, so with no members the form below
          renders but can never submit — say so instead of letting the
          "Paid by" dropdown just sit there empty. */}
      {members.length === 0 ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Add a household member before recording expenses — every expense has to be attributed to
          whoever paid it. You can add members from the{" "}
          <Link href={`/h/${householdId}`} className="font-medium underline">
            Dashboard
          </Link>
          .
        </p>
      ) : (
        <ExpenseForm householdId={householdId} members={members} categories={categories} defaultMonth={month} />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-700">{value}</span>
    </div>
  );
}

const filterClass = "rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none";
