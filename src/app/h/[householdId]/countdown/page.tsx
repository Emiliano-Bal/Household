import Link from "next/link";
import { getMonthRunway, getHousehold } from "@/lib/queries";
import { formatCents, formatPercent } from "@/lib/money";
import { monthStart, monthKey } from "@/lib/month";
import { MonthNav } from "@/components/month-nav";
import { RunwayChart } from "@/components/runway-chart";

function parseMonth(value: string | undefined): Date {
  if (!value) return monthStart(new Date());
  const [y, m] = value.split("-").map(Number);
  if (!y || !m) return monthStart(new Date());
  return new Date(Date.UTC(y, m - 1, 1));
}

export default async function CountdownPage({
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

  const [household, runway] = await Promise.all([getHousehold(householdId), getMonthRunway(householdId, month)]);
  if (!household) return null;

  const over = runway.remainingCents < 0;
  const spentPercent =
    runway.startingCents > 0 ? (runway.spentToDateCents / runway.startingCents) * 100 : runway.spentToDateCents > 0 ? 100 : 0;
  // Ahead/behind the even-pace line as of today.
  const paceTarget = runway.startingCents - runway.evenDailyCents * runway.elapsedDays;
  const vsPaceCents = runway.remainingCents - paceTarget;

  const spentDays = runway.days.filter((d) => d.spentCents > 0);

  return (
    <div className="flex flex-col gap-6">
      <MonthNav householdId={householdId} month={month} basePath="/countdown" />

      {runway.startingCents === 0 ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No income on record for {monthStr}, so there is nothing to count down from. Add it on the{" "}
          <Link href={`/h/${householdId}/income?month=${monthStr}`} className="font-medium underline">
            Income
          </Link>{" "}
          screen and this will fill in.
        </p>
      ) : null}

      {/* Hero figure: the one number this view leads with. */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {over ? "Over budget this month" : runway.isCurrentMonth ? "Left to spend this month" : "Left at month end"}
        </p>
        <p
          className={`mt-1 text-5xl font-semibold tracking-tight ${over ? "text-red-600" : "text-emerald-600"}`}
        >
          {formatCents(Math.abs(runway.remainingCents))}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          {formatCents(runway.spentToDateCents)} spent of {formatCents(runway.startingCents)}
          {runway.isCurrentMonth && (
            <>
              {" · "}
              <span className="font-medium text-slate-700">
                {runway.daysRemaining} day{runway.daysRemaining === 1 ? "" : "s"}
              </span>{" "}
              until the end of the month
            </>
          )}
        </p>

        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${over ? "bg-red-500" : spentPercent >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
            style={{ width: `${Math.min(100, spentPercent)}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-400">{formatPercent(spentPercent, undefined, 0)} of income spent</p>
      </section>

      {runway.isCurrentMonth && runway.startingCents > 0 && (
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Safe to spend per day"
            value={runway.safeDailyCents === null ? "—" : formatCents(Math.max(0, runway.safeDailyCents))}
            sub={runway.daysRemaining > 0 ? `over ${runway.daysRemaining} days left` : "month is over"}
            tone={runway.safeDailyCents !== null && runway.safeDailyCents < 0 ? "bad" : "neutral"}
          />
          <StatCard
            label="Spending per day so far"
            value={runway.averageDailySpendCents === null ? "—" : formatCents(runway.averageDailySpendCents)}
            sub={`even pace is ${formatCents(runway.evenDailyCents)}`}
            tone={
              runway.averageDailySpendCents !== null && runway.averageDailySpendCents > runway.evenDailyCents
                ? "bad"
                : "good"
            }
          />
          <StatCard
            label={vsPaceCents < 0 ? "Behind even pace" : "Ahead of even pace"}
            value={formatCents(Math.abs(vsPaceCents))}
            sub={`day ${runway.elapsedDays} of ${runway.daysInMonth}`}
            tone={vsPaceCents < 0 ? "bad" : "good"}
          />
          <StatCard
            label={
              runway.projectedEndCents !== null && runway.projectedEndCents < 0 ? "Projected shortfall" : "Projected leftover"
            }
            value={runway.projectedEndCents === null ? "—" : formatCents(Math.abs(runway.projectedEndCents))}
            sub="if this pace holds"
            tone={runway.projectedEndCents !== null && runway.projectedEndCents < 0 ? "bad" : "good"}
          />
        </section>
      )}

      {runway.projectedEndCents !== null && runway.projectedEndCents < 0 && runway.isCurrentMonth && !over && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Still in the black today, but at {formatCents(runway.averageDailySpendCents ?? 0)} a day this month ends{" "}
          {formatCents(Math.abs(runway.projectedEndCents))} short. Spending{" "}
          {formatCents(Math.max(0, runway.safeDailyCents ?? 0))} a day or less for the remaining {runway.daysRemaining} day
          {runway.daysRemaining === 1 ? "" : "s"} keeps it level.
        </p>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
            Running balance through {monthStr}
          </h2>
          <p className="text-xs text-slate-400">
            Starts at the month&apos;s income; every expense subtracts on the day it is dated.
          </p>
        </div>
        <div className="mt-4">
          <RunwayChart
            days={runway.days}
            startingCents={runway.startingCents}
            elapsedDays={runway.elapsedDays}
            evenDailyCents={runway.evenDailyCents}
          />
        </div>
      </section>

      {/* The table keeps every value the chart shows reachable without hovering. */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-medium uppercase tracking-wide text-slate-400">
          Days with spending
        </h2>
        {spentDays.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-400">Nothing spent in {monthStr} yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="px-5 py-2 font-medium">Day</th>
                  <th className="px-5 py-2 text-right font-medium">Spent</th>
                  <th className="px-5 py-2 text-right font-medium">Left after</th>
                </tr>
              </thead>
              <tbody>
                {spentDays.map((d) => (
                  <tr key={d.day} className="border-t border-slate-100">
                    <td className="px-5 py-2 text-slate-600">
                      {d.day}
                      {runway.biggestDay?.day === d.day && (
                        <span className="ml-2 text-xs text-slate-400">biggest day</span>
                      )}
                    </td>
                    <td className="px-5 py-2 text-right text-slate-600 tabular-nums">{formatCents(d.spentCents)}</td>
                    <td
                      className={`px-5 py-2 text-right font-medium tabular-nums ${
                        d.remainingCents < 0 ? "text-red-600" : "text-slate-800"
                      }`}
                    >
                      {formatCents(d.remainingCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-slate-400">
        Counts every expense dated in {monthStr}, personal ones included — this tracks money leaving the household,
        not how it splits between members. For one person&apos;s side of it, open their tab above.
      </p>
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
