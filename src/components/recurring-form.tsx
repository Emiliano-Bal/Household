"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createRecurringExpense, updateRecurringExpense } from "@/lib/actions";
import { monthKey } from "@/lib/month";
import { CategorySelect, type CategoryOption } from "@/components/category-select";

type SplitType = "PROPORTIONAL" | "EQUAL" | "EXACT" | "PERCENTAGE" | "SOLO";
type Frequency = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const INTERVAL_UNIT: Record<Frequency, string> = {
  WEEKLY: "week(s)",
  MONTHLY: "month(s)",
  QUARTERLY: "quarter(s)",
  YEARLY: "year(s)",
};

export interface EditingRecurring {
  id: string;
  label: string;
  amountCents: number;
  categoryId: string;
  frequency: Frequency;
  interval: number;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  /** "YYYY-MM". */
  startMonth: string;
  endMonth: string | null;
  paidByMemberId: string;
  splitType: SplitType;
  exactAmountsCents: Record<string, number>;
  percentages: Record<string, number>;
}

export function RecurringForm({
  householdId,
  members,
  categories,
  editingRule,
  onCancelEdit,
}: {
  householdId: string;
  members: { id: string; name: string }[];
  categories: CategoryOption[];
  editingRule?: EditingRecurring | null;
  onCancelEdit?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [splitType, setSplitType] = useState<SplitType>(editingRule?.splitType ?? "PROPORTIONAL");
  const [paidBy, setPaidBy] = useState(editingRule?.paidByMemberId ?? members[0]?.id ?? "");
  const [frequency, setFrequency] = useState<Frequency>(editingRule?.frequency ?? "MONTHLY");
  const isEditing = Boolean(editingRule);

  // Re-seed the controlled fields when the edited rule changes.
  const [lastEditedId, setLastEditedId] = useState(editingRule?.id ?? null);
  if ((editingRule?.id ?? null) !== lastEditedId) {
    setLastEditedId(editingRule?.id ?? null);
    setSplitType(editingRule?.splitType ?? "PROPORTIONAL");
    setPaidBy(editingRule?.paidByMemberId ?? members[0]?.id ?? "");
    setFrequency(editingRule?.frequency ?? "MONTHLY");
  }
  const [error, setError] = useState<string | null>(null);
  const defaultStartMonth = `${monthKey(new Date())}-01`;
  // Weekly rules are placed by weekday; the rest by day of month. Showing
  // both at once invites filling in the one that will be ignored.
  const isWeekly = frequency === "WEEKLY";

  async function onSubmit(formData: FormData) {
    setError(null);
    const label = String(formData.get("label") ?? "").trim();
    const amount = Math.round(Number(formData.get("amount") ?? 0) * 100);
    const dayOfMonth = Number(formData.get("dayOfMonth") ?? 1);
    const startMonth = new Date(String(formData.get("startMonth") ?? defaultStartMonth));
    const endMonthRaw = String(formData.get("endMonth") ?? "");
    const categoryId = String(formData.get("categoryId") ?? "");
    const interval = Math.max(1, Number(formData.get("interval") ?? 1));
    const dayOfWeekRaw = String(formData.get("dayOfWeek") ?? "");

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
        const payload = {
          householdId,
          categoryId,
          label,
          amount,
          frequency,
          interval,
          dayOfMonth: isWeekly ? null : dayOfMonth,
          dayOfWeek: isWeekly ? Number(dayOfWeekRaw || 1) : null,
          startMonth,
          endMonth: endMonthRaw ? new Date(endMonthRaw) : null,
          paidByMemberId: paidBy,
          splitRule: splitRule as never,
        };

        if (editingRule) {
          // Only the rule changes. Expenses it already generated are left
          // alone — repricing settled history because a template changed
          // is exactly what this app avoids everywhere else.
          const result = await updateRecurringExpense({ ...payload, id: editingRule.id });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          router.refresh();
          onCancelEdit?.();
          return;
        }

        await createRecurringExpense(payload);
        router.refresh();
        (document.getElementById("recurring-form") as HTMLFormElement | null)?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save recurring expense.");
      }
    });
  }

  return (
    <form id="recurring-form" action={onSubmit} className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          {isEditing ? `Edit “${editingRule!.label}”` : "New recurring expense"}
        </h2>
        {isEditing && onCancelEdit && (
          <button type="button" onClick={onCancelEdit} className="text-xs text-slate-400 hover:text-slate-600">
            Cancel edit
          </button>
        )}
      </div>
      {isEditing && (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Changes apply to future generations only. Expenses this rule has already created keep the amount, date and
          split they were created with.
        </p>
      )}
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <input
          name="label"
          placeholder="Label (e.g. Rent)"
          required
          aria-label="Label"
          defaultValue={editingRule?.label}
          className={inputClass}
        />
        <input
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          placeholder="Amount"
          required
          aria-label="Amount"
          defaultValue={editingRule ? (editingRule.amountCents / 100).toFixed(2) : undefined}
          className={inputClass}
        />
        <CategorySelect
          categories={categories}
          placeholder="Category"
          required
          defaultValue={editingRule?.categoryId}
          className={inputClass}
        />
        <select
          name="frequency"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as Frequency)}
          aria-label="Frequency"
          className={inputClass}
        >
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="QUARTERLY">Quarterly</option>
          <option value="YEARLY">Yearly</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {isWeekly ? (
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            Day of week
            <select name="dayOfWeek" defaultValue={editingRule?.dayOfWeek ?? 1} aria-label="Day of week" className={inputClass}>
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            Day of month
            <input
              name="dayOfMonth"
              type="number"
              min={1}
              max={31}
              defaultValue={editingRule?.dayOfMonth ?? 1}
              aria-label="Day of month"
              className={inputClass}
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Repeat every
          <div className="flex items-center gap-2">
            <input
              name="interval"
              type="number"
              min={1}
              max={52}
              defaultValue={editingRule?.interval ?? 1}
              aria-label="Repeat interval"
              className={`${inputClass} w-20`}
            />
            <span className="text-xs text-slate-400">{INTERVAL_UNIT[frequency]}</span>
          </div>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Starts
          <input name="startMonth" type="month" defaultValue={editingRule?.startMonth ?? monthKey(new Date())} aria-label="Start month" className={inputClass} />
          {(frequency === "QUARTERLY" || frequency === "YEARLY") && (
            <span className="text-xs font-normal text-slate-400">
              {frequency === "QUARTERLY" ? "and every 3rd month after" : "and the same month each year"}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Ends (optional)
          <input name="endMonth" type="month" defaultValue={editingRule?.endMonth ?? undefined} aria-label="End month" className={inputClass} />
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
        {isPending ? "Saving..." : isEditing ? "Save changes" : "Add recurring expense"}
      </button>
    </form>
  );
}

const inputClass = "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none";
