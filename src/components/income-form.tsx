"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getIncomeEditImpact, saveIncomeRecord } from "@/lib/actions";
import { describeBalance, formatCents } from "@/lib/money";
import { monthKey } from "@/lib/month";
import type { MemberShare } from "@/lib/splitting";

interface Impact {
  expenseId: string;
  oldShares: MemberShare[];
  newShares: MemberShare[];
}

interface SettlementImpact {
  memberId: string;
  balanceBeforeCents: number;
  balanceAfterCents: number;
  relatedSettlementsCents: number;
}

export interface EditingIncomeRecord {
  id: string;
  memberId: string;
  netAmount: number;
  source: string;
}

export function IncomeForm({
  householdId,
  members,
  month,
  editingRecord,
}: {
  householdId: string;
  members: { id: string; name: string }[];
  month: Date;
  /** When set, the form edits this existing record (recordId threaded to saveIncomeRecord) instead of creating a new one. */
  editingRecord?: EditingIncomeRecord | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [memberId, setMemberId] = useState(editingRecord?.memberId ?? members[0]?.id ?? "");
  const [pendingImpact, setPendingImpact] = useState<Impact[] | null>(null);
  const [pendingSettlementImpact, setPendingSettlementImpact] = useState<SettlementImpact[]>([]);
  const [pendingPayload, setPendingPayload] = useState<{ netAmount: number; source?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recordId = editingRecord?.id;
  const hasSettlementImpact = pendingSettlementImpact.length > 0;

  function nameFor(id: string): string {
    return members.find((m) => m.id === id)?.name ?? id;
  }

  function exitEditMode() {
    router.push(`/h/${householdId}/income?month=${monthKey(month)}`);
  }

  async function onSubmit(formData: FormData) {
    setError(null);
    const netAmount = Math.round(Number(formData.get("netAmount") ?? 0) * 100);
    const source = String(formData.get("source") ?? "").trim() || undefined;
    if (!netAmount) {
      setError("Enter a non-zero net amount.");
      return;
    }

    startTransition(async () => {
      const { expenseImpact, settlementImpact } = await getIncomeEditImpact({ householdId, memberId, month, netAmount, recordId });
      if (expenseImpact.length === 0) {
        const result = await saveIncomeRecord({ householdId, memberId, month, netAmount, source, recordId, recalculate: false });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
        if (recordId) exitEditMode();
        else (document.getElementById("income-form") as HTMLFormElement | null)?.reset();
      } else {
        setPendingImpact(expenseImpact);
        setPendingSettlementImpact(settlementImpact);
        setPendingPayload({ netAmount, source });
      }
    });
  }

  function confirm(recalculate: boolean) {
    if (!pendingPayload) return;
    startTransition(async () => {
      const result = await saveIncomeRecord({ householdId, memberId, month, ...pendingPayload, recordId, recalculate });
      setPendingImpact(null);
      setPendingSettlementImpact([]);
      setPendingPayload(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      if (recordId) exitEditMode();
      else (document.getElementById("income-form") as HTMLFormElement | null)?.reset();
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          {editingRecord ? "Update income" : "Add income"}
        </h2>
        {editingRecord && (
          <button type="button" onClick={exitEditMode} className="text-xs text-slate-400 hover:text-slate-600">
            Cancel edit
          </button>
        )}
      </div>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <form id="income-form" action={onSubmit} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Member
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            disabled={Boolean(editingRecord)}
            className={inputClass}
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Net amount
          <input
            name="netAmount"
            type="number"
            step="0.01"
            min="0.01"
            required
            defaultValue={editingRecord ? (editingRecord.netAmount / 100).toFixed(2) : undefined}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Source (optional)
          <input
            name="source"
            placeholder="Salary"
            defaultValue={editingRecord?.source}
            disabled={Boolean(editingRecord)}
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {isPending ? "Saving..." : editingRecord ? "Update" : "Save"}
        </button>
      </form>

      {pendingImpact && pendingImpact.length > 0 && (
        <div className="flex flex-col gap-3">
          {hasSettlementImpact && (
            <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4">
              <p className="text-sm font-bold text-red-800">
                ⚠ Warning: {formatCents(pendingSettlementImpact[0].relatedSettlementsCents)} has already been
                settled between {pendingSettlementImpact.map((s) => nameFor(s.memberId)).join(" and ")}.
                Recalculating will change those past balances.
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-red-800">
                {pendingSettlementImpact.map((s) => (
                  <li key={s.memberId}>
                    <span className="font-semibold">{nameFor(s.memberId)}</span> will go from{" "}
                    {describeBalance(s.balanceBeforeCents)} to{" "}
                    <span className="font-semibold">{describeBalance(s.balanceAfterCents)}</span>.
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-800">
              This changes the income ratio used for {pendingImpact.length} already-recorded expense
              {pendingImpact.length === 1 ? "" : "s"}. &quot;Save only&quot; updates this income record and leaves
              those expenses&apos; shares exactly as they are; &quot;Save and recalculate&quot; rewrites them to
              match the new ratio.
            </p>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {pendingImpact.map((entry) => (
                <li key={entry.expenseId} className="rounded-md bg-white p-3">
                  <p className="font-medium text-slate-700">Expense {entry.expenseId}</p>
                  <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-slate-500">
                    <div>
                      <p className="font-medium text-slate-400">Old shares</p>
                      {entry.oldShares.map((s) => (
                        <p key={s.memberId}>
                          {nameFor(s.memberId)}: {formatCents(s.owedAmount)}
                        </p>
                      ))}
                    </div>
                    <div>
                      <p className="font-medium text-slate-400">New shares</p>
                      {entry.newShares.map((s) => (
                        <p key={s.memberId}>
                          {nameFor(s.memberId)}: {formatCents(s.owedAmount)}
                        </p>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              {/* "Save only" is the safe default; it's the visually primary
                  (filled) button whenever a settlement is at stake, and
                  "Save and recalculate" becomes the muted, secondary one — the
                  opposite of their styling when no settlement is affected. */}
              <button
                type="button"
                onClick={() => confirm(false)}
                disabled={isPending}
                className={
                  hasSettlementImpact
                    ? "rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                    : "rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
                }
              >
                Save only, keep old balances
              </button>
              <button
                type="button"
                onClick={() => confirm(true)}
                disabled={isPending}
                className={
                  hasSettlementImpact
                    ? "rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                    : "rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
                }
              >
                Save and recalculate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputClass = "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none";
