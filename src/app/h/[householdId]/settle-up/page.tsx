import { getBalances, getHousehold, listSettlements } from "@/lib/queries";
import { describeBalance, formatCents } from "@/lib/money";
import { SettlementForm } from "@/components/settlement-form";
import { DeleteSettlementButton } from "@/components/delete-settlement-button";

export default async function SettleUpPage({ params }: { params: Promise<{ householdId: string }> }) {
  const { householdId } = await params;
  const [household, balances, settlements] = await Promise.all([
    getHousehold(householdId),
    getBalances(householdId),
    listSettlements(householdId),
  ]);
  if (!household) return null;

  const members = household.members.filter((m) => m.active);

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Balances</h2>
        <p className="mt-1 text-xs text-slate-400">
          Cumulative across every month ever recorded, net of every settlement below — never scoped to a single
          month.
        </p>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {balances.byMember.map((m) => (
            <li key={m.memberId} className="flex items-center justify-between rounded-md bg-slate-50 px-4 py-2">
              <span className="font-medium text-slate-800">{m.name}</span>
              <span
                className={`font-semibold ${m.balanceCents > 0 ? "text-emerald-600" : m.balanceCents < 0 ? "text-red-600" : "text-slate-500"}`}
              >
                {describeBalance(m.balanceCents)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {balances.suggestedTransfers.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Suggested transfers</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {balances.suggestedTransfers.map((t, i) => (
              <li key={i} className="flex items-center justify-between rounded-md bg-slate-50 px-4 py-2">
                <span>
                  <span className="font-medium text-slate-800">{t.fromName}</span> pays{" "}
                  <span className="font-medium text-slate-800">{t.toName}</span>
                </span>
                <span className="font-semibold text-slate-900">{formatCents(t.amountCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SettlementForm householdId={householdId} members={members} />

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-medium uppercase tracking-wide text-slate-400">
          Settlement history
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">From</th>
              <th className="px-4 py-2 font-medium">To</th>
              <th className="px-4 py-2 font-medium">Note</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2 text-right font-medium">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {settlements.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No settlements recorded yet.
                </td>
              </tr>
            )}
            {settlements.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="px-4 py-2 text-slate-500">
                  {s.date.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}
                </td>
                <td className="px-4 py-2 font-medium text-slate-800">{s.fromMember.name}</td>
                <td className="px-4 py-2 font-medium text-slate-800">{s.toMember.name}</td>
                <td className="px-4 py-2 text-slate-500">{s.note ?? "—"}</td>
                <td className="px-4 py-2 text-right font-medium text-slate-900">{formatCents(s.amount)}</td>
                <td className="px-4 py-2 text-right">
                  <DeleteSettlementButton settlementId={s.id} householdId={householdId} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
