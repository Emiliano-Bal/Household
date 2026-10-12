import Link from "next/link";
import { formatCents, formatPercent } from "@/lib/money";
import { monthKey } from "@/lib/month";
import { RunwayChart } from "@/components/runway-chart";
import type { MonthRunway } from "@/lib/queries";

/**
 * The month as a countdown, as a Dashboard section rather than its own
 * route: start from income, subtract each day's spending, and say what is
 * left and whether the pace gets to payday.
 */
export function CountdownWidget({ householdId, runway }: { householdId: string; runway: MonthRunway }) {
  const over = runway.remainingCents < 0;
  const monthStr = monthKey(runway.month);
  const spentPercent =
    runway.startingCents > 0
      ? (runway.spentToDateCents / runway.startingCents) * 100
      : runway.spentToDateCents > 0
        ? 100
        : 0;
  const paceTarget = runway.startingCents - runway.evenDailyCents * runway.elapsedDays;
  const vsPaceCents = runway.remainingCents - paceTarget;
  const spentDays = runway.days.filter((d) => d.spentCents > 0);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          {over ? "Over budget this month" : runway.isCurrentMonth ? "Left to spend this month" : "Left at month end"}
        </h2>
        <p className="text-xs text-slate-400">
          Starts at the month&apos;s income; every expense subtracts on the day it is dated.
        </p>
      </div>

      {runway.startingCents === 0 ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No income on record for {monthStr}, so there is nothing to count down from. Add it on the{" "}
          <Link href={`/h/${householdId}/income?month=${monthStr}`} className="font-medium underline">
            Income
          </Link>{" "}
          screen.
        </p>
      ) : (
        <>
          <p className={`mt-1 text-4xl font-semibold tracking-tight ${over ? "text-red-600" : "text-emerald-600"}`}>
            {formatCents(Math.abs(runway.remainingCents))}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {formatCents(runway.spentToDateCents)} spent of {formatCents(runway.startingCents)}
            {runway.isCurrentMonth && (
              <>
                {" · "}
                <span className="font-medium text-slate-700">
                  {runway.daysRemaining} day{runway.daysRemaining === 1 ? "" : "s"}
                </span>{" "}
                to go
              </>
            )}
          </p>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${over ? "bg-red-500" : spentPercent >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${Math.min(100, spentPercent)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-slate-400">{formatPercent(spentPercent, undefined, 0)} of income spent</p>

          {runway.isCurrentMonth && (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Mini
                label="Safe per day"
                value={runway.safeDailyCents === null ? "—" : formatCents(Math.max(0, runway.safeDailyCents))}
                sub={runway.daysRemaining > 0 ? `over ${runway.daysRemaining} days` : "month is over"}
                tone={runway.safeDailyCents !== null && runway.safeDailyCents < 0 ? "bad" : "neutral"}
              />
              <Mini
                label="Spending per day"
                value={runway.averageDailySpendCents === null ? "—" : formatCents(runway.averageDailySpendCents)}
                sub={`even pace ${formatCents(runway.evenDailyCents)}`}
                tone={
                  runway.averageDailySpendCents !== null && runway.averageDailySpendCents > runway.evenDailyCents
                    ? "bad"
                    : "good"
                }
              />
              <Mini
                label={vsPaceCents < 0 ? "Behind pace" : "Ahead of pace"}
                value={formatCents(Math.abs(vsPaceCents))}
                sub={`day ${runway.elapsedDays} of ${runway.daysInMonth}`}
                tone={vsPaceCents < 0 ? "bad" : "good"}
              />
              <Mini
                label={
                  runway.projectedEndCents !== null && runway.projectedEndCents < 0
                    ? "Projected shortfall"
                    : "Projected leftover"
                }
                value={runway.projectedEndCents === null ? "—" : formatCents(Math.abs(runway.projectedEndCents))}
                sub="if this pace holds"
                tone={runway.projectedEndCents !== null && runway.projectedEndCents < 0 ? "bad" : "good"}
              />
            </div>
          )}

          {runway.projectedEndCents !== null && runway.projectedEndCents < 0 && runway.isCurrentMonth && !over && (
            <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Still in the black today, but at {formatCents(runway.averageDailySpendCents ?? 0)} a day this month ends{" "}
              {formatCents(Math.abs(runway.projectedEndCents))} short. Spending{" "}
              {formatCents(Math.max(0, runway.safeDailyCents ?? 0))} a day or less for the remaining{" "}
              {runway.daysRemaining} day{runway.daysRemaining === 1 ? "" : "s"} keeps it level.
            </p>
          )}

          <div className="mt-4">
            <RunwayChart
              days={runway.days}
              startingCents={runway.startingCents}
              elapsedDays={runway.elapsedDays}
              evenDailyCents={runway.evenDailyCents}
            />
          </div>

          {/* Collapsed rather than dropped: the chart's values have to stay
              reachable without hovering, but a full table would dominate a
              section that is one of several on this page. */}
          {spentDays.length > 0 && (
            <details className="mt-3 border-t border-slate-100 pt-3">
              <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">
                Days with spending ({spentDays.length})
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-400">
                      <th className="py-1.5 pr-4 font-medium">Day</th>
                      <th className="py-1.5 pr-4 text-right font-medium">Spent</th>
                      <th className="py-1.5 text-right font-medium">Left after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spentDays.map((d) => (
                      <tr key={d.day} className="border-t border-slate-100">
                        <td className="py-1.5 pr-4 text-slate-600">
                          {d.day}
                          {runway.biggestDay?.day === d.day && (
                            <span className="ml-2 text-xs text-slate-400">biggest day</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums text-slate-600">{formatCents(d.spentCents)}</td>
                        <td
                          className={`py-1.5 text-right font-medium tabular-nums ${
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
            </details>
          )}
        </>
      )}
    </section>
  );
}

function Mini({
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
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-0.5 font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
