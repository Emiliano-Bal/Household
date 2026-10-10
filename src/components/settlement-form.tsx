"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSettlement, getSettlementPreview } from "@/lib/actions";
import { describeBalance, formatCents } from "@/lib/money";

interface Preview {
  fromBalanceBeforeCents: number;
  toBalanceBeforeCents: number;
  fromBalanceAfterCents: number;
  toBalanceAfterCents: number;
  isOverpayment: boolean;
  overpaidByCents: number;
}

export function SettlementForm({
  householdId,
  members,
}: {
  householdId: string;
  members: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fromMemberId, setFromMemberId] = useState(members[0]?.id ?? "");
  const [toMemberId, setToMemberId] = useState(members[1]?.id ?? members[0]?.id ?? "");
  const [pendingPreview, setPendingPreview] = useState<Preview | null>(null);
  const [pendingPayload, setPendingPayload] = useState<{ amountCents: number; date: string; note?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function nameFor(id: string): string {
    return members.find((m) => m.id === id)?.name ?? id;
  }

  function resetForm() {
    (document.getElementById("settlement-form") as HTMLFormElement | null)?.reset();
    setPendingPreview(null);
    setPendingPayload(null);
  }

  async function submitSettlement(amountCents: number, date: string, note: string | undefined) {
    const result = await createSettlement({
      householdId,
      fromMemberId,
      toMemberId,
      amount: amountCents,
      date: date ? new Date(date) : undefined,
      note,
    });
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    router.refresh();
    resetForm();
    return true;
  }

  async function onSubmit(formData: FormData) {
    setError(null);

    if (fromMemberId === toMemberId) {
      setError("Payer and payee must be different members.");
      return;
    }

    const rawAmount = String(formData.get("amount") ?? "");
    const amountCents = Math.round(Number(rawAmount) * 100);
    if (!rawAmount.trim() || !Number.isFinite(amountCents) || amountCents <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }

    const date = String(formData.get("date") ?? "");
    const note = String(formData.get("note") ?? "").trim() || undefined;

    startTransition(async () => {
      const preview = await getSettlementPreview(householdId, fromMemberId, toMemberId, amountCents);
      if (preview.isOverpayment) {
        setPendingPreview(preview);
        setPendingPayload({ amountCents, date, note });
      } else {
        await submitSettlement(amountCents, date, note);
      }
    });
  }

  function confirmOverpayment() {
    if (!pendingPayload) return;
    startTransition(async () => {
      await submitSettlement(pendingPayload.amountCents, pendingPayload.date, pendingPayload.note);
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Record a settlement</h2>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <form id="settlement-form" action={onSubmit} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Payer
          <select value={fromMemberId} onChange={(e) => setFromMemberId(e.target.value)} className={inputClass}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Payee
          <select value={toMemberId} onChange={(e) => setToMemberId(e.target.value)} className={inputClass}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Amount
          <input name="amount" type="number" step="0.01" min="0.01" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Date
          <input name="date" type="date" defaultValue={today} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Note (optional)
          <input name="note" placeholder="Venmo, cash, etc." className={inputClass} />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {isPending ? "Recording..." : "Record"}
        </button>
      </form>

      {pendingPreview && pendingPayload && (
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
          <p className="text-sm font-bold text-amber-800">
            ⚠ This is more than {nameFor(fromMemberId)} currently owes — by{" "}
            {formatCents(pendingPreview.overpaidByCents)}. Recording it will flip the balance:
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-amber-900">
            <li>
              <span className="font-semibold">{nameFor(fromMemberId)}</span> will go from{" "}
              {describeBalance(pendingPreview.fromBalanceBeforeCents)} to{" "}
              <span className="font-semibold">{describeBalance(pendingPreview.fromBalanceAfterCents)}</span>.
            </li>
            <li>
              <span className="font-semibold">{nameFor(toMemberId)}</span> will go from{" "}
              {describeBalance(pendingPreview.toBalanceBeforeCents)} to{" "}
              <span className="font-semibold">{describeBalance(pendingPreview.toBalanceAfterCents)}</span>.
            </li>
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={resetForm}
              disabled={isPending}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmOverpayment}
              disabled={isPending}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
            >
              Record anyway
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const inputClass = "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none";
