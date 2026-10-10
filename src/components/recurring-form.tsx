"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createRecurringExpense } from "@/lib/actions";
import { monthKey } from "@/lib/month";

type SplitType = "PROPORTIONAL" | "EQUAL" | "EXACT" | "PERCENTAGE" | "SOLO";

export function RecurringForm({
  householdId,
  members,
  categories,
}: {
  householdId: string;
  members: { id: string; name: string }[];
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [splitType, setSplitType] = useState<SplitType>("PROPORTIONAL");
  const [paidBy, setPaidBy] = useState(members[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const defaultStartMonth = `${monthKey(new Date())}-01`;

  async function onSubmit(formData: FormData) {
    setError(null);
    const label = String(formData.get("label") ?? "").trim();
    const amount = Math.round(Number(formData.get("amount") ?? 0) * 100);
    const dayOfMonth = Number(formData.get("dayOfMonth") ?? 1);
    const startMonth = new Date(String(formData.get("startMonth") ?? defaultStartMonth));
    const endMonthRaw = String(formData.get("endMonth") ?? "");
    const categoryId = String(formData.get("categoryId") ?? "");

    if (!label || !amount || !categoryId) {
      setError("Label, amount, and category are required.");
      return;
    }

    let splitRule: Record<string, unknown> = { type: splitType };
    if (splitType === "EXACT") {
      const amounts: Record<string, number> = {};
      for (const member of members) amounts[member.id] = Math.round(Number(formData.get(`exact-${member.id}`) ?? 0) * 100);
      splitRule = { type: "EXACT", amounts };
    } else if (splitType === "PERCENTAGE") {
      const percentages: Record<string, number> = {};
      for (const member of members) percentages[member.id] = Number(formData.get(`pct-${member.id}`) ?? 0);
      splitRule = { type: "PERCENTAGE", percentages };
    }

    startTransition(async () => {
      try {
        await createRecurringExpense({
          householdId,
          categoryId,
          label,
          amount,
          dayOfMonth,
          startMonth,
          endMonth: endMonthRaw ? new Date(endMonthRaw) : null,
          paidByMemberId: paidBy,
          splitRule: splitRule as never,
        });
        router.refresh();
        (document.getElementById("recurring-form") as HTMLFormElement | null)?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save recurring expense.");
      }
    });
  }

  return (
    <form id="recurring-form" action={onSubmit} className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">New recurring expense</h2>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <input name="label" placeholder="Label (e.g. Rent)" required className={inputClass} />
        <input name="amount" type="number" step="0.01" min="0.01" placeholder="Amount" required className={inputClass} />
        <select name="categoryId" required className={inputClass}>
          <option value="">Category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input name="dayOfMonth" type="number" min={1} max={31} defaultValue={1} placeholder="Day of month" className={inputClass} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Starts
          <input name="startMonth" type="month" defaultValue={monthKey(new Date())} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Ends (optional)
          <input name="endMonth" type="month" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Paid by
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)} className={inputClass}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Split rule
          <select value={splitType} onChange={(e) => setSplitType(e.target.value as SplitType)} className={inputClass}>
            <option value="PROPORTIONAL">Proportional (by income)</option>
            <option value="EQUAL">Equal</option>
            <option value="EXACT">Exact amounts</option>
            <option value="PERCENTAGE">Percentages</option>
            <option value="SOLO">Solo (personal)</option>
          </select>
        </label>
      </div>

      {splitType === "EXACT" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {members.map((m) => (
            <label key={m.id} className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              {m.name}&apos;s amount
              <input name={`exact-${m.id}`} type="number" step="0.01" min="0" className={inputClass} />
            </label>
          ))}
        </div>
      )}
      {splitType === "PERCENTAGE" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {members.map((m) => (
            <label key={m.id} className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              {m.name}&apos;s %
              <input name={`pct-${m.id}`} type="number" step="0.1" min="0" max="100" className={inputClass} />
            </label>
          ))}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {isPending ? "Saving..." : "Add recurring expense"}
      </button>
    </form>
  );
}

const inputClass = "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none";
