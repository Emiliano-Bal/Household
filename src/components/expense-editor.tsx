"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ExpenseForm, type EditingExpense } from "@/components/expense-form";
import { deleteExpense, getExpenseChangeImpact, type ExpenseChangeImpact } from "@/lib/actions";
import { describeBalance, formatCents } from "@/lib/money";
import type { CategoryOption } from "@/components/category-select";

/**
 * Thin client wrapper so the page can stay a server component: edit mode
 * is driven by the `edit` search param, and cancelling just clears it.
 */
export function ExpenseEditor({
  householdId,
  members,
  categories,
  defaultMonth,
  editingExpense,
}: {
  householdId: string;
  members: { id: string; name: string }[];
  categories: CategoryOption[];
  defaultMonth: Date;
  editingExpense?: EditingExpense | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function cancelEdit() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("edit");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <ExpenseForm
      householdId={householdId}
      members={members}
      categories={categories}
      defaultMonth={defaultMonth}
      editingExpense={editingExpense}
      onCancelEdit={editingExpense ? cancelEdit : undefined}
    />
  );
}

/**
 * Two-step delete. The first click asks for confirmation and, if the
 * expense sits in a period that has already been settled, shows the
 * concrete before/after balances rather than a generic "are you sure".
 */
export function DeleteExpenseButton({
  householdId,
  expenseId,
  label,
  compact,
}: {
  householdId: string;
  expenseId: string;
  label: string;
  /** Table-row placement: the trigger is a plain link-sized button and the confirm floats over the row. */
  compact?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [impact, setImpact] = useState<ExpenseChangeImpact[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function startConfirm() {
    setError(null);
    startTransition(async () => {
      // `proposed: null` models the deletion.
      const found = await getExpenseChangeImpact({ householdId, expenseId, proposed: null });
      setImpact(found);
      setConfirming(true);
    });
  }

  function doDelete() {
    startTransition(async () => {
      const result = await deleteExpense(expenseId, householdId);
      if (!result.ok) {
        setError(result.error);
        setConfirming(false);
        return;
      }
      setConfirming(false);
      // Stay on the month being cleaned up. Only the params that point at
      // the row just deleted are dropped — pushing to a bare /expenses
      // would silently throw someone tidying up March back to today.
      const next = new URLSearchParams(searchParams.toString());
      for (const key of ["expenseId", "edit"]) {
        if (next.get(key) === expenseId) next.delete(key);
      }
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={startConfirm}
          disabled={isPending}
          aria-label={`Delete ${label}`}
          className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {isPending ? "Checking..." : "Delete"}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  const settled = impact && impact.length > 0;

  return (
    <div
      className={`rounded-lg border p-3 text-left ${settled ? "border-red-400 bg-red-50" : "border-slate-300 bg-slate-50"} ${
        // In a table cell the confirm would squeeze the column, so it is
        // lifted out of the flow and given a readable width of its own.
        compact ? "absolute right-2 z-10 w-80 shadow-lg" : ""
      }`}
    >
      <p className={`text-sm font-medium ${settled ? "text-red-800" : "text-slate-700"}`}>
        Delete &ldquo;{label}&rdquo;?
      </p>

      {settled ? (
        <>
          <p className="mt-1 text-sm font-bold text-red-800">
            ⚠ This expense is in a period that has already been settled
            {impact![0] && ` (${formatCents(impact![0].relatedSettlementsCents)} paid)`}. Deleting changes these
            balances:
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-red-800">
            {impact!.map((i) => (
              <li key={i.memberId}>
                <span className="font-semibold">{i.memberName}</span> goes from {describeBalance(i.balanceBeforeCents)}{" "}
                to <span className="font-semibold">{describeBalance(i.balanceAfterCents)}</span>.
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-xs text-slate-500">
          Its share rows go with it. No settlement is affected, so no balance that has already been paid will change.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Keep it
        </button>
        <button
          type="button"
          onClick={doDelete}
          disabled={isPending}
          className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {isPending ? "Deleting..." : "Delete anyway"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
