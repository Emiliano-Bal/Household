import Link from "next/link";
import { listIncomeForMonth, getHousehold } from "@/lib/queries";
import { formatCents } from "@/lib/money";
import { monthStart, monthKey } from "@/lib/month";
import { MonthNav } from "@/components/month-nav";
import { IncomeForm } from "@/components/income-form";
import { CopyLastMonthButton } from "@/components/copy-last-month-button";

function parseMonth(value: string | undefined): Date {
  if (!value) return monthStart(new Date());
  const [y, m] = value.split("-").map(Number);
  if (!y || !m) return monthStart(new Date());
  return new Date(Date.UTC(y, m - 1, 1));
}

export default async function IncomePage({
  params,
  searchParams,
}: {
  params: Promise<{ householdId: string }>;
  searchParams: Promise<{ month?: string; editId?: string }>;
}) {
  const { householdId } = await params;
  const { month: monthParam, editId } = await searchParams;
  const month = parseMonth(monthParam);
  const monthStr = monthKey(month);

  const [household, records] = await Promise.all([getHousehold(householdId), listIncomeForMonth(householdId, month)]);
  if (!household) return null;

  const members = household.members.filter((m) => m.active);
  const total = records.reduce((sum, r) => sum + r.netAmount, 0);
  const editingRecord = editId ? records.find((r) => r.id === editId) ?? null : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <MonthNav householdId={householdId} month={month} basePath="/income" />
        <CopyLastMonthButton householdId={householdId} month={month} />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="px-4 py-2 font-medium">Member</th>
              <th className="px-4 py-2 font-medium">Source</th>
              <th className="px-4 py-2 text-right font-medium">Net amount</th>
              <th className="px-4 py-2 text-right font-medium">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                  No income recorded for this month yet.
                </td>
              </tr>
            )}
            {records.map((r) => (
              <tr key={r.id} className={`border-t border-slate-100 ${editingRecord?.id === r.id ? "bg-amber-50" : ""}`}>
                <td className="px-4 py-2 font-medium text-slate-800">{r.member.name}</td>
                <td className="px-4 py-2 text-slate-500">{r.source}</td>
                <td className="px-4 py-2 text-right font-medium text-slate-900">{formatCents(r.netAmount)}</td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/h/${householdId}/income?month=${monthStr}&editId=${r.id}`}
                    className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
          {records.length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50">
                <td colSpan={3} className="px-4 py-2 text-right text-xs font-medium uppercase text-slate-400">
                  Total
                </td>
                <td className="px-4 py-2 text-right font-semibold text-slate-900">{formatCents(total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <IncomeForm
        householdId={householdId}
        members={members}
        month={month}
        editingRecord={editingRecord ? { id: editingRecord.id, memberId: editingRecord.memberId, netAmount: editingRecord.netAmount, source: editingRecord.source } : null}
      />
    </div>
  );
}
