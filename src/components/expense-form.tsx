"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createExpense, updateExpense, getExpenseChangeImpact, type ExpenseChangeImpact } from "@/lib/actions";
import { monthKey } from "@/lib/month";
import { formatCents, describeBalance } from "@/lib/money";
import { CategorySelect, type CategoryOption } from "@/components/category-select";

type SplitType = "PROPORTIONAL" | "EQUAL" | "EXACT" | "PERCENTAGE" | "SOLO";

interface MemberOption {
  id: string;
  name: string;
}

export interface EditingExpense {
  id: string;
  label: string;
  amountCents: number;
  /** "YYYY-MM-DD". */
  date: string;
  categoryId: string | null;
  paidByMemberId: string;
  splitType: SplitType;
  isShared: boolean;
  exactAmountsCents: Record<string, number>;
  percentages: Record<string, number>;
}

interface PendingSave {
  payload: Parameters<typeof updateExpense>[0];
  impact: ExpenseChangeImpact[];
}
export function ExpenseForm({
  householdId,
  members,
  categories,
  defaultMonth,
  editingExpense,
  onCancelEdit,
}: {
  householdId: string;
  members: MemberOption[];
  categories: CategoryOption[];
  defaultMonth: Date;
  /** When set, the form edits this expense instead of creating a new one. */
  editingExpense?: EditingExpense | null;
  onCancelEdit?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [splitType, setSplitType] = useState<SplitType>(editingExpense?.splitType ?? "PROPORTIONAL");
  const [paidBy, setPaidBy] = useState(editingExpense?.paidByMemberId ?? members[0]?.id ?? "");
  const [isShared, setIsShared] = useState(editingExpense?.isShared ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const defaultDate = editingExpense?.date ?? `${monthKey(defaultMonth)}-01`;
  const isEditing = Boolean(editingExpense);

  // Switching which expense is being edited has to reset the controlled
  // fields; they are seeded from props and React keeps state otherwise.
  const [lastEditedId, setLastEditedId] = useState(editingExpense?.id ?? null);
  if ((editingExpense?.id ?? null) !== lastEditedId) {
    setLastEditedId(editingExpense?.id ?? null);
    setSplitType(editingExpense?.splitType ?? "PROPORTIONAL");
    setPaidBy(editingExpense?.paidByMemberId ?? members[0]?.id ?? "");
    setIsShared(editingExpense?.isShared ?? true);
    setPendingSave(null);
    setError(null);
  }

  function handleSplitTypeChange(next: SplitType) {
    setSplitType(next);
    setIsShared(next !== "SOLO");
  }

  async function onSubmit(formData: FormData) {
    setError(null);
    const label = String(formData.get("label") ?? "").trim();
    const amount = Math.round(Number(formData.get("amount") ?? 0) * 100);
    const date = new Date(String(formData.get("date") ?? defaultDate));
    const categoryId = String(formData.get("categoryId") ?? "") || undefined;

    if (!label || !amount) {
      setError("Label and a non-zero amount are required.");
      return;
    }

    let splitRule: Record<string, unknown> = { type: splitType };
    if (splitType === "EXACT") {
      const amounts: Record<string, number> = {};
      for (const member of members) {
        amounts[member.id] = Math.round(Number(formData.get(`exact-${member.id}`) ?? 0) * 100);
      }
      splitRule = { type: "EXACT", amounts };
    } else if (splitType === "PERCENTAGE") {
      const percentages: Record<string, number> = {};
      for (const member of members) {
        percentages[member.id] = Number(formData.get(`pct-${member.id}`) ?? 0);
      }
      splitRule = { type: "PERCENTAGE", percentages };
    }

    startTransition(async () => {
      try {
        if (editingExpense) {
          const payload = {
            id: editingExpense.id,
            householdId,
            date,
            label,
            amount,
            categoryId,
            paidByMemberId: paidBy,
            splitRule: splitRule as never,
            isShared,
          };
          // Check what this would do to already-settled balances before
          // writing anything. Warn, never block.
          const impact = await getExpenseChangeImpact({
            householdId,
            expenseId: editingExpense.id,
            proposed: { amount, date, paidByMemberId: paidBy, splitRule: splitRule as never, isShared },
          });
          if (impact.length > 0) {
            setPendingSave({ payload, impact });
            return;
          }
          await updateExpense(payload);
          router.refresh();
          onCancelEdit?.();
          return;
        }

        await createExpense({
          householdId,
          date,
          label,
          amount,
          categoryId,
          paidByMemberId: paidBy,
          splitRule: splitRule as never,
          isShared,
        });
        router.refresh();
        (document.getElementById("expense-form") as HTMLFormElement | null)?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save expense.");
      }
    });
  }

  function confirmSave() {
    if (!pendingSave) return;
    startTransition(async () => {
      try {
        await updateExpense(pendingSave.payload);
        setPendingSave(null);
        router.refresh();
        onCancelEdit?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save expense.");
      }
    });
  }

  return (
    <form
      id="expense-form"
      action={onSubmit}
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          {isEditing ? `Edit “${editingExpense!.label}”` : "Quick-add expense"}
        </h2>
        {isEditing && onCancelEdit && (
          <button type="button" onClick={onCancelEdit} className="text-xs text-slate-400 hover:text-slate-600">
            Cancel edit
          </button>
        )}
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {pendingSave && (
        <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4">
          <p className="text-sm font-bold text-red-800">
            ⚠ This expense is in a period that has already been settled
            {pendingSave.impact[0] && ` (${formatCents(pendingSave.impact[0].relatedSettlementsCents)} paid)`}. Saving
            changes these balances:
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-red-800">
            {pendingSave.impact.map((i) => (
              <li key={i.memberId}>
                <span className="font-semibold">{i.memberName}</span> goes from {describeBalance(i.balanceBeforeCents)}{" "}
                to <span className="font-semibold">{describeBalance(i.balanceAfterCents)}</span>.
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setPendingSave(null)}
              disabled={isPending}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Cancel, leave it alone
            </button>
            <button
              type="button"
              onClick={confirmSave}
              disabled={isPending}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Save anyway"}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <input
          name="label"
          placeholder="Label (e.g. Rent)"
          required
          aria-label="Label"
          defaultValue={editingExpense?.label}
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
          defaultValue={editingExpense ? (editingExpense.amountCents / 100).toFixed(2) : undefined}
          className={inputClass}
        />
        <input name="date" type="date" defaultValue={defaultDate} aria-label="Date" className={inputClass} />
        <CategorySelect
          categories={categories}
          placeholder="No category"
          defaultValue={editingExpense?.categoryId ?? undefined}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
          <select
            value={splitType}
            onChange={(e) => handleSplitTypeChange(e.target.value as SplitType)}
            className={inputClass}
          >
            <option value="PROPORTIONAL">Proportional (by income)</option>
            <option value="EQUAL">Equal</option>
            <option value="EXACT">Exact amounts</option>
            <option value="PERCENTAGE">Percentages</option>
            <option value="SOLO">Solo (personal)</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} disabled={splitType === "SOLO"} />
          Shared expense (counts toward balances)
        </label>
      </div>

      {splitType === "EXACT" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {members.map((m) => (
            <label key={m.id} className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              {m.name}&apos;s amount
              <input
                name={`exact-${m.id}`}
                type="number"
                step="0.01"
                min="0"
                defaultValue={
                  editingExpense?.exactAmountsCents[m.id] !== undefined
                    ? (editingExpense.exactAmountsCents[m.id] / 100).toFixed(2)
                    : undefined
                }
                className={inputClass}
              />
            </label>
          ))}
        </div>
      )}

      {splitType === "PERCENTAGE" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {members.map((m) => (
            <label key={m.id} className="flex flex-col gap-1 text-xs font-medium text-slate-500">
              {m.name}&apos;s %
              <input
                name={`pct-${m.id}`}
                type="number"
                step="0.1"
                min="0"
                max="100"
                defaultValue={editingExpense?.percentages[m.id]}
                className={inputClass}
              />
            </label>
          ))}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {isPending ? "Saving..." : isEditing ? "Save changes" : "Add expense"}
      </button>
    </form>
  );
}

const inputClass =
  "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none";
