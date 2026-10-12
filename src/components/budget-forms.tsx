"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBudgetLimit } from "@/lib/actions";

/**
 * One category's standing limit. Saves on blur as well as on submit,
 * because the natural way to fill this list is to type a number and tab to
 * the next row rather than pressing Enter on each.
 */
export function BudgetLimitInput({
  householdId,
  categoryId,
  categoryName,
  limitCents,
}: {
  householdId: string;
  categoryId: string;
  categoryName: string;
  limitCents: number | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const initial = limitCents === null ? "" : (limitCents / 100).toFixed(2);
  const [value, setValue] = useState(initial);

  // Re-sync when the saved value changes under us, so the box shows what
  // was actually stored rather than the raw keystrokes: type "500,5" and
  // this corrects the field to "500.50" once the server confirms it.
  // Adjusting state during render is React's own pattern for this; the
  // alternative, an effect, would paint the stale value first.
  const [lastSaved, setLastSaved] = useState(limitCents);
  if (limitCents !== lastSaved) {
    setLastSaved(limitCents);
    setValue(initial);
  }

  function save(raw: string) {
    const trimmed = raw.trim();
    if (trimmed === initial) return; // unchanged — don't spend a round trip on a tab-through
    setError(null);

    startTransition(async () => {
      // Empty means "no limit on this category", which is not the same as
      // a limit of zero; the action stores null rather than 0.
      const amount = trimmed === "" ? null : Math.round(Number(trimmed.replace(",", ".")) * 100);
      if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
        setError("Enter a non-negative amount.");
        setValue(initial);
        return;
      }
      const result = await setBudgetLimit({ householdId, categoryId, amount });
      if (!result.ok) {
        setError(result.error);
        setValue(initial);
        return;
      }
      router.refresh();
    });
  }

  return (
    <form action={() => save(value)} className="flex flex-col items-end">
      <div className="flex items-center gap-2">
        <input
          name="amount"
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={(e) => save(e.target.value)}
          disabled={isPending}
          placeholder="no limit"
          aria-label={`Monthly limit for ${categoryName}`}
          className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
        />
        {isPending && <span className="text-xs text-slate-400">…</span>}
      </div>
      {error && <span className="mt-1 max-w-48 text-right text-xs text-red-600">{error}</span>}
    </form>
  );
}
