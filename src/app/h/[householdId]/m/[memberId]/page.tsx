import Link from "next/link";
import { notFound } from "next/navigation";
import { getMemberDashboardData } from "@/lib/queries";
import { describeBalance, formatCents, formatPercent } from "@/lib/money";
import { monthStart, monthKey } from "@/lib/month";
import { MonthNav } from "@/components/month-nav";

function parseMonth(value: string | undefined): Date {
  if (!value) return monthStart(new Date());
  const [y, m] = value.split("-").map(Number);
  if (!y || !m) return monthStart(new Date());
  return new Date(Date.UTC(y, m - 1, 1));
}

const dateFormat = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", timeZone: "UTC" });

export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ householdId: string; memberId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { householdId, memberId } = await params;
  const { month: monthParam } = await searchParams;
  const month = parseMonth(monthParam);

  const data = await getMemberDashboardData(householdId, memberId, month);
  if (!data) notFound();

  const { member, summary, shareByKind, incomeRecords, shares, paidWithoutShare, settlements, savingsContributions } = data;
  const monthStr = monthKey(month);

  // A non-zero resolved income with no rows for this month means
  // computeIncomeShares carried a prior month forward.
  const incomeCarriedForward = incomeRecords.length === 0 && summary.incomeCents > 0;

  return (
    <div className="flex flex-col gap-8">
      <MonthNav householdId={householdId} month={month} basePath={`/m/${memberId}`} />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {member.name}
            {!member.active && <span className="ml-2 text-sm font-normal text-slate-400">(inactive)</span>}
          </h1>
          {member.email && <p className="text-sm text-slate-400">{member.email}</p>}
        </div>
        <Link href={`/h/${householdId}?month=${monthStr}`} className="text-xs font-medium text-slate-400 hover:text-slate-600">
          Household dashboard &rarr;
        </Link>
      </div>

      {!member.active && (
        <p className="rounded-lg border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-600">
          This member is inactive, so they are left out of this month&apos;s income split and fair-share
          calculation. Their past expenses and outstanding balance below are unaffected.
        </p>
      )}

      {incomeCarriedForward && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No income recorded for {monthStr}. The {formatCents(summary.incomeCents)} below is carried forward from
          an earlier month — add a record on the{" "}
          <Link href={`/h/${householdId}/income?month=${monthStr}`} className="font-medium underline">
            Income
          </Link>{" "}
          screen to make this month&apos;s split exact.
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <StatCard
          label="Income"
          value={formatCents(summary.incomeCents)}
          sub={`${formatPercent(summary.incomeSharePercent)} of household`}
        />
        <StatCard
          label="Fair share"
          value={formatCents(summary.fairContributionCents)}
          sub="what they owe this month"
        />
        <StatCard label="Actually paid" value={formatCents(summary.actuallyPaidCents)} sub="expenses they covered" />
        <StatCard
          label="This month"
          value={describeBalance(summary.thisMonthBalanceCents)}
          sub="paid minus fair share"
          tone={summary.thisMonthBalanceCents > 0 ? "good" : summary.thisMonthBalanceCents < 0 ? "bad" : "neutral"}
        />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Total outstanding</h2>
        <p
          className={`mt-1 text-2xl font-semibold ${
            summary.balanceCents > 0 ? "text-emerald-600" : summary.balanceCents < 0 ? "text-red-600" : "text-slate-500"
          }`}
        >
          {describeBalance(summary.balanceCents)}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Cumulative across every month ever recorded, net of settlements — not just {monthStr}.
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Fair share by type</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Row label="Fixed" value={formatCents(shareByKind.fixedCents)} />
          <Row label="Variable" value={formatCents(shareByKind.variableCents)} />
          <Row label="Savings" value={formatCents(shareByKind.savingsCents)} />
          <Row label="Uncategorized" value={formatCents(shareByKind.uncategorizedCents)} />
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-medium uppercase tracking-wide text-slate-400">
          Income this month
        </h2>
        {incomeRecords.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-400">No income recorded for {monthStr}.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="px-5 py-2 font-medium">Source</th>
                <th className="px-5 py-2 text-right font-medium">Net amount</th>
              </tr>
            </thead>
            <tbody>
              {incomeRecords.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 text-slate-700">{r.source}</td>
                  <td className="px-5 py-3 text-right text-slate-700">{formatCents(r.netAmountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-medium uppercase tracking-wide text-slate-400">
          Their share of this month&apos;s expenses
        </h2>
        {shares.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-400">No expenses this month give {member.name} a share.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-5 py-2 font-medium">Expense</th>
                  <th className="px-5 py-2 font-medium">Category</th>
                  <th className="px-5 py-2 font-medium">Paid by</th>
                  <th className="px-5 py-2 text-right font-medium">Total</th>
                  <th className="px-5 py-2 text-right font-medium">Their share</th>
                </tr>
              </thead>
              <tbody>
                {shares.map((s) => (
                  <tr key={s.expenseId} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-5 py-3 text-slate-500">{dateFormat.format(s.date)}</td>
                    <td className="px-5 py-3 font-medium text-slate-800">
                      {s.label}
                      {!s.isShared && <span className="ml-2 text-xs font-normal text-slate-400">personal</span>}
                    </td>
                    <td className="px-5 py-3 text-slate-500">{s.categoryName ?? "—"}</td>
                    <td className="px-5 py-3 text-slate-500">{s.paidByThisMember ? "Themselves" : s.paidByName}</td>
                    <td className="px-5 py-3 text-right text-slate-500">{formatCents(s.totalCents)}</td>
                    <td className="px-5 py-3 text-right font-medium text-slate-800">{formatCents(s.owedCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50">
                  <td colSpan={5} className="px-5 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">
                    Total fair share
                  </td>
                  <td className="px-5 py-2 text-right font-semibold text-slate-900">
                    {formatCents(summary.fairContributionCents)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {paidWithoutShare.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white">
          <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-medium uppercase tracking-wide text-slate-400">
            Paid for, but owes no share
          </h2>
          <p className="px-5 pt-3 text-xs text-slate-400">
            Expenses {member.name} covered where the split assigns them nothing — a solo expense paid on someone
            else&apos;s behalf. These still count toward &quot;Actually paid&quot; above.
          </p>
          <ul className="flex flex-col divide-y divide-slate-100 px-5 py-3 text-sm">
            {paidWithoutShare.map((e) => (
              <li key={e.expenseId} className="flex items-center justify-between py-2">
                <span className="text-slate-700">
                  <span className="mr-2 text-slate-400">{dateFormat.format(e.date)}</span>
                  {e.label}
                </span>
                <span className="font-medium text-slate-800">{formatCents(e.totalCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {savingsContributions.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white">
          <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-medium uppercase tracking-wide text-slate-400">
            Savings contributions this month
          </h2>
          <ul className="flex flex-col divide-y divide-slate-100 px-5 py-3 text-sm">
            {savingsContributions.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <span className="text-slate-700">
                  {c.goalName}
                  {c.isJoint && <span className="ml-2 text-xs text-slate-400">joint</span>}
                </span>
                <span className="font-medium text-slate-800">{formatCents(c.amountCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-medium uppercase tracking-wide text-slate-400">
          Settlements
        </h2>
        {settlements.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-400">No transfers recorded involving {member.name}.</p>
        ) : (
          <>
            <p className="px-5 pt-3 text-xs text-slate-400">
              All months, newest first — balances are cumulative, so showing only {monthStr} would misrepresent
              what has actually been settled.
            </p>
            <ul className="flex flex-col divide-y divide-slate-100 px-5 py-3 text-sm">
              {settlements.map((st) => (
                <li key={st.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-slate-700">
                    <span className="mr-2 text-slate-400">{dateFormat.format(st.date)}</span>
                    {st.direction === "paid" ? "Paid " : "Received from "}
                    <span className="font-medium text-slate-800">{st.counterpartName}</span>
                    {st.note && <span className="ml-2 text-xs text-slate-400">{st.note}</span>}
                  </span>
                  <span className={`font-medium ${st.direction === "paid" ? "text-red-600" : "text-emerald-600"}`}>
                    {st.direction === "paid" ? "−" : "+"}
                    {formatCents(st.amountCents)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="font-medium text-slate-800">{value}</p>
    </div>
  );
}
