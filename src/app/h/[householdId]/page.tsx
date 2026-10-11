import Link from "next/link";
import { getDashboardData, getHousehold, getBalances } from "@/lib/queries";
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

  const [household, dashboard, balances] = await Promise.all([
    getHousehold(householdId),
    getDashboardData(householdId, month),
    getBalances(householdId),
  ]);

  if (!household) return null;

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

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Leftover / unallocated</h2>
        <p className={`mt-1 text-2xl font-semibold ${dashboard.leftoverCents < 0 ? "text-red-600" : "text-emerald-600"}`}>
          {formatCents(dashboard.leftoverCents)}
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-medium uppercase tracking-wide text-slate-400">
          Per member
        </h2>
        <table className="w-full text-sm">
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
