"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteRecurringExpense, setRecurringExpenseActive } from "@/lib/actions";

/**
 * Delete a recurring rule. Expenses it already generated are kept by
 * default — they are real spending that really happened, and deleting
 * the template says something about the future, not the past. The dialog
 * says so explicitly and offers the opt-out.
 */
export function DeleteRecurringButton({
  householdId,
  recurringId,
  label,
  generatedCount,
}: {
  householdId: string;
  recurringId: string;
  label: string;
  generatedCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [alsoDelete, setAlsoDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function doDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteRecurringExpense(recurringId, householdId, { alsoDeleteGenerated: alsoDelete });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
      >
        Delete
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-300 bg-slate-50 p-3 text-left">
      <p className="text-sm font-medium text-slate-800">Delete the rule &ldquo;{label}&rdquo;?</p>
      <p className="mt-1 text-xs text-slate-500">
        {generatedCount === 0 ? (
          <>It has not generated any expenses yet, so nothing else is affected.</>
        ) : (
          <>
            The <span className="font-medium text-slate-700">{generatedCount}</span> expense
            {generatedCount === 1 ? "" : "s"} it has already generated{" "}
            <span className="font-medium text-slate-700">will be kept</span> — they stay in your history and keep
            counting toward balances. Only the rule stops.
          </>
        )}
      </p>

      {generatedCount > 0 && (
        <label className="mt-2 flex items-start gap-2 text-xs text-red-700">
          <input
            type="checkbox"
            checked={alsoDelete}
            onChange={(e) => setAlsoDelete(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Also delete those {generatedCount} expense{generatedCount === 1 ? "" : "s"}. This removes real recorded
            spending and will change balances.
          </span>
        </label>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setAlsoDelete(false);
          }}
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
          {isPending ? "Deleting..." : alsoDelete ? "Delete rule and expenses" : "Delete rule only"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Pausing is the reversible alternative to deleting, so it sits beside it. */
export function ToggleRecurringActiveButton({
  householdId,
  recurringId,
  active,
}: {
  householdId: string;
  recurringId: string;
  active: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await setRecurringExpenseActive(recurringId, householdId, !active);
          router.refresh();
        })
      }
      className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
    >
      {isPending ? "…" : active ? "Pause" : "Resume"}
    </button>
  );
}
