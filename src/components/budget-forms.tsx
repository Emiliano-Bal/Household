"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBudget, clearBudget, copyLastMonthBudget } from "@/lib/actions";

/**
 * One row's amount input. Saves on blur as well as on submit, because the
 * natural way to fill a budget table is to type a number and tab to the
 * next row — never pressing Enter at all.
 */
export function BudgetAmountInput({
  householdId,
  categoryId,
  month,
  budgetedCents,
}: {
  householdId: string;
  categoryId: string;
  /** "YYYY-MM-DD" (the 1st) — kept as a string so the server action gets a stable value. */
  month: string;
  budgetedCents: number | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const initial = budgetedCents === null ? "" : (budgetedCents / 100).toFixed(2);
  const [value, setValue] = useState(initial);

  function save(raw: string) {
    const trimmed = raw.trim();
    // Unchanged — don't spend a round trip on a tab-through.
    if (trimmed === initial) return;
    setError(null);

    startTransition(async () => {
      if (trimmed === "") {
        // Empty means "no budget for this category", which is not the same
        // as budgeting zero — so remove the row rather than storing 0.
        await clearBudget(householdId, categoryId, new Date(month));
        router.refresh();
        return;
      }
      const amount = Math.round(Number(trimmed.replace(",", ".")) * 100);
      if (!Number.isFinite(amount) || amount < 0) {
        setError("Enter a non-negative amount.");
        setValue(initial);
        return;
      }
      const result = await setBudget({ householdId, categoryId, month: new Date(month), amount });
      if (!result.ok) {
        setError(result.error);
        setValue(initial);
        return;
      }
      router.refresh();
    });
  }

  return (
    <form
      action={() => save(value)}
      className="flex items-center justify-end gap-2"
      // Enter submits; blur below covers tabbing away without submitting.
    >
      <div className="flex flex-col items-end">
        <input
          name="amount"
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={(e) => save(e.target.value)}
          disabled={isPending}
          placeholder="—"
          aria-label="Budget amount"
          className="w-24 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
        />
        {error && <span className="mt-1 text-xs text-red-600">{error}</span>}
      </div>
      {isPending && <span className="text-xs text-slate-400">…</span>}
    </form>
  );
}

export function CopyLastMonthBudgetButton({ householdId, month }: { householdId: string; month: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      const { copiedCount, skippedCount } = await copyLastMonthBudget(householdId, new Date(month));
      setResult(
        copiedCount === 0
          ? skippedCount > 0
            ? "Every category from last month already has a budget here."
            : "Last month had no budget to copy."
          : `Copied ${copiedCount} budget${copiedCount === 1 ? "" : "s"}${skippedCount > 0 ? `, left ${skippedCount} already set` : ""}.`
      );
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"
      >
        {isPending ? "Copying..." : "Copy last month's budget"}
      </button>
      {result && <span className="text-sm text-slate-500">{result}</span>}
    </div>
  );
}
