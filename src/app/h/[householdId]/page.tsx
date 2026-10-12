import Link from "next/link";
import { getDashboardData, getHousehold, getBalances, getBudgetStatus, getMonthRunway } from "@/lib/queries";
import { CountdownWidget } from "@/components/countdown-widget";
import { describeBalance, formatCents, formatPercent } from "@/lib/money";
import { monthStart, monthKey } from "@/lib/month";
import { MonthNav } from "@/components/month-nav";
import { RecordSettlementButton } from "@/components/record-settlement-button";
import { MemberQuickAdd } from "@/components/household-setup";

function parseMonth(value: string | undefined): Date {
  if (!value) return monthStart(new Date());
  const [y, m] = value.split("-").map(Number);
  if (!y || !m) return monthStart(new Date());
  return new Date(Date.UTC(y, m - 1, 1));
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ householdId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { householdId } = await params;
  const { month: monthParam } = await searchParams;
  const month = parseMonth(monthParam);

  const [household, dashboard, balances, budget, runway] = await Promise.all([
    getHousehold(householdId),
    getDashboardData(householdId, month),
    getBalances(householdId),
    getBudgetStatus(householdId, month),
    getMonthRunway(householdId, month),
  ]);

  if (!household) return null;

  // Never clamped: a negative figure is the point when the month overspent.
  const saved = dashboard.actualSavingsCents;

  return (
    <div className="flex flex-col gap-8">
      <MonthNav householdId={householdId} month={month} basePath="" />

      {dashboard.usedEqualSplitFallback && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          Nobody in this household has any income on record yet — shares below are an equal split, not
          income-weighted. Add income on the Income screen for real proportional splitting.
        </div>
      )}

      {dashboard.incomeWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">Income fallbacks in effect this month:</p>
          <ul className="mt-1 list-inside list-disc">
            {dashboard.incomeWarnings.map((w) => (
              <li key={w.memberId}>
                {w.memberName} —{" "}
                {w.type === "PRIOR_MONTH_FALLBACK"
                  ? `carried forward from ${w.fallbackMonth}`
                  : "no income on record at all"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {dashboard.overspend && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          Spending this month (
          {formatCents(dashboard.fixedCents + dashboard.variableCents + dashboard.savingsCents)}) exceeds income (
          {formatCents(dashboard.totalIncomeCents)}).
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Household income" value={formatCents(dashboard.totalIncomeCents)} />
        <StatCard
          label="Fixed expenses"
          value={formatCents(dashboard.fixedCents)}
          sub={percentOf(dashboard.fixedCents, dashboard.totalIncomeCents)}
        />
        <StatCard
          label="Variable expenses"
          value={formatCents(dashboard.variableCents)}
          sub={percentOf(dashboard.variableCents, dashboard.totalIncomeCents)}
        />
        <StatCard
          label="Savings"
          value={formatCents(dashboard.savingsCents)}
          sub={percentOf(dashboard.savingsCents, dashboard.totalIncomeCents)}
        />
      </section>

      <CountdownWidget householdId={householdId} runway={runway} />

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
            {saved < 0 ? "Overspent this month" : "Saved this month"}
          </h2>
          <span className="text-sm text-slate-400">income less everything that went out</span>
        </div>
        <p className={`mt-1 text-3xl font-semibold ${saved < 0 ? "text-red-600" : "text-emerald-600"}`}>
          {formatCents(saved)}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {dashboard.savingsRatePercent === null ? (
            "No income on record this month, so there is no rate to compute."
          ) : (
            <>
              Savings rate{" "}
              <span className={`font-medium ${saved < 0 ? "text-red-600" : "text-emerald-700"}`}>
                {formatPercent(dashboard.savingsRatePercent, undefined, 1)}
              </span>{" "}
              of {formatCents(dashboard.totalIncomeCents)} income
            </>
          )}
        </p>

        <dl className="mt-4 divide-y divide-slate-100 border-t border-slate-100 text-sm">
          <Line label="Income" value={formatCents(dashboard.totalIncomeCents)} />
          <Line label="Fixed expenses" value={`− ${formatCents(dashboard.fixedCents)}`} muted />
          <Line label="Variable expenses" value={`− ${formatCents(dashboard.variableCents)}`} muted />
          {dashboard.savingsCents > 0 && (
            <Line label="Savings-category expenses" value={`− ${formatCents(dashboard.savingsCents)}`} muted />
          )}
          <Line
            label="Goal contributions"
            value={`− ${formatCents(dashboard.goalContributionsCents)}`}
            muted
            hint="money committed to a savings goal — gone from this month's leftover"
          />
          <Line label={saved < 0 ? "Shortfall" : "Unallocated leftover"} value={formatCents(saved)} strong />
        </dl>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Breakdown label="Deliberate goal contributions" value={formatCents(dashboard.goalContributionsCents)} />
          <Breakdown label="Unallocated leftover" value={formatCents(saved)} tone={saved < 0 ? "bad" : "good"} />
          <Breakdown
            label="Total set aside"
            value={formatCents(dashboard.goalContributionsCents + saved)}
            hint="contributions plus whatever was left over"
          />
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Budget this month</h2>
          <Link href={`/h/${householdId}/expenses/budget`} className="text-xs font-medium text-slate-400 hover:text-slate-600">
            Adjust limits &rarr;
          </Link>
        </div>

        {budget.rows.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-400">
            No spending limits set yet.{" "}
            <Link href={`/h/${householdId}/expenses/budget`} className="font-medium text-slate-600 underline">
              Set one
            </Link>{" "}
            for a variable category — Groceries, Eating Out — and the month&apos;s progress against it shows here.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="px-5 py-2 font-medium">Category</th>
                  <th className="px-5 py-2 text-right font-medium">Spent</th>
                  <th className="px-5 py-2 text-right font-medium">Limit</th>
                  <th className="px-5 py-2 text-right font-medium">Left</th>
                  <th className="w-40 px-5 py-2 font-medium">Progress</th>
                </tr>
              </thead>
              <tbody>
                {budget.rows.map((row) => {
                  const over = row.remainingCents < 0;
                  return (
                    <tr key={row.categoryId} className="border-t border-slate-100">
                      <td className="px-5 py-2.5 font-medium text-slate-800">{row.categoryName}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-slate-600">{formatCents(row.spentCents)}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-slate-400">{formatCents(row.limitCents)}</td>
                      <td
                        className={`px-5 py-2.5 text-right font-medium tabular-nums ${over ? "text-red-600" : "text-emerald-600"}`}
                      >
                        {formatCents(row.remainingCents)}
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-full rounded-full ${over ? "bg-red-500" : row.usedPercent >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                              style={{ width: `${Math.min(100, row.usedPercent)}%` }}
                            />
                          </div>
                          <span className={`w-12 text-right text-xs ${over ? "font-medium text-red-600" : "text-slate-400"}`}>
                            {formatPercent(row.usedPercent, undefined, 0)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-medium">
                  <td className="px-5 py-3 text-slate-700">Total</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-900">{formatCents(budget.totalSpentCents)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-500">{formatCents(budget.totalLimitCents)}</td>
                  <td
                    className={`px-5 py-3 text-right tabular-nums ${budget.totalLimitCents - budget.totalSpentCents < 0 ? "text-red-600" : "text-emerald-600"}`}
                  >
                    {formatCents(budget.totalLimitCents - budget.totalSpentCents)}
                  </td>
                  <td className="px-5 py-3" />
                </tr>
              </tfoot>
            </table>
            </div>
            {budget.unlimitedVariableCents > 0 && (
              <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
                A further{" "}
                <span className="font-medium text-slate-700">{formatCents(budget.unlimitedVariableCents)}</span> went
                to variable categories with no limit set — not counted in the totals above, so an unlimited category
                can&apos;t make the month look on-budget.
              </p>
            )}
          </>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-medium uppercase tracking-wide text-slate-400">
          Per member
        </h2>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="px-5 py-2 font-medium">Member</th>
              <th className="px-5 py-2 font-medium">Income share</th>
              <th className="px-5 py-2 font-medium">Fair contribution</th>
              <th className="px-5 py-2 font-medium">Actually paid</th>
              <th className="px-5 py-2 font-medium">This month</th>
              <th className="px-5 py-2 font-medium">Total outstanding</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.perMember.map((m) => (
              <tr key={m.memberId} className="border-t border-slate-100">
                <td className="px-5 py-3 font-medium">
                  <Link
                    href={`/h/${householdId}/m/${m.memberId}?month=${monthKey(month)}`}
                    className="text-slate-800 underline decoration-slate-300 underline-offset-2 hover:text-emerald-700 hover:decoration-emerald-400"
                  >
                    {m.name}
                  </Link>
                </td>
                <td className="px-5 py-3 text-slate-600">
                  {formatCents(m.incomeCents)} ({formatPercent(m.incomeSharePercent)})
                </td>
                <td className="px-5 py-3 text-slate-600">{formatCents(m.fairContributionCents)}</td>
                <td className="px-5 py-3 text-slate-600">{formatCents(m.actuallyPaidCents)}</td>
                <td
                  className={`px-5 py-3 font-medium ${m.thisMonthBalanceCents > 0 ? "text-emerald-600" : m.thisMonthBalanceCents < 0 ? "text-red-600" : "text-slate-500"}`}
                  title="Just this month's expenses: actually paid minus fair contribution."
                >
                  {describeBalance(m.thisMonthBalanceCents)}
                </td>
                <td
                  className={`px-5 py-3 font-medium ${m.balanceCents > 0 ? "text-emerald-600" : m.balanceCents < 0 ? "text-red-600" : "text-slate-500"}`}
                  title="Cumulative across every month ever recorded, net of settlements."
                >
                  {describeBalance(m.balanceCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      {balances.suggestedTransfers.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Settle up</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {balances.suggestedTransfers.map((t, i) => (
              <li key={i} className="flex items-center justify-between rounded-md bg-slate-50 px-4 py-2">
                <span>
                  <span className="font-medium text-slate-800">{t.fromName}</span> pays{" "}
                  <span className="font-medium text-slate-800">{t.toName}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold text-slate-900">{formatCents(t.amountCents)}</span>
                  <RecordSettlementButton
                    householdId={householdId}
                    fromMemberId={t.fromMemberId}
                    toMemberId={t.toMemberId}
                    amountCents={t.amountCents}
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Household members</h2>
        <ul className="mt-2 flex flex-wrap gap-2 text-sm">
          {household.members.map((m) => (
            <li key={m.id}>
              <Link
                href={`/h/${householdId}/m/${m.id}?month=${monthKey(month)}`}
                className={`block rounded-full px-3 py-1 transition ${
                  m.active
                    ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    : "bg-slate-50 text-slate-400 hover:bg-slate-100"
                }`}
              >
                {m.name}
                {!m.active && " (inactive)"}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <MemberQuickAdd householdId={householdId} />
        </div>
      </section>

      <div className="flex gap-3">
        <Link
          href={`/h/${householdId}/expenses`}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Go to Expenses
        </Link>
        <Link
          href={`/h/${householdId}/income`}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Go to Income
        </Link>
      </div>
    </div>
  );
}

function Line({
  label,
  value,
  muted,
  strong,
  hint,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className={strong ? "font-medium text-slate-800" : "text-slate-500"}>
        {label}
        {hint && <span className="ml-2 text-xs text-slate-400">{hint}</span>}
      </dt>
      <dd className={`tabular-nums ${strong ? "font-semibold text-slate-900" : muted ? "text-slate-500" : "text-slate-700"}`}>
        {value}
      </dd>
    </div>
  );
}

function Breakdown({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  const toneClass = tone === "bad" ? "text-red-600" : tone === "good" ? "text-emerald-600" : "text-slate-900";
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function percentOf(part: number, total: number): string {
  if (!total) return `${formatPercent(0)} of income`;
  return `${formatPercent((part / total) * 100)} of income`;
}
