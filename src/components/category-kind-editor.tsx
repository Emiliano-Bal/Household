"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCategory } from "@/lib/actions";
import type { CategoryKind } from "@prisma/client";

/**
 * Change a category's kind in place. Kind is what decides whether a
 * category's spending is reported as Fixed, Variable or Savings — and
 * whether it can carry a budget limit — so a commitment filed as Variable
 * shows up in the wrong total until this is corrected.
 */
export function CategoryKindEditor({
  householdId,
  categoryId,
  categoryName,
  kind,
}: {
  householdId: string;
  categoryId: string;
  categoryName: string;
  kind: CategoryKind;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState<CategoryKind>(kind);
  const [error, setError] = useState<string | null>(null);

  // Re-sync if the saved kind changes under us.
  const [lastSaved, setLastSaved] = useState(kind);
  if (kind !== lastSaved) {
    setLastSaved(kind);
    setValue(kind);
  }

  function save(next: CategoryKind) {
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await updateCategory(householdId, categoryId, { kind: next });
      if (!result.ok) {
        setError(result.error);
        setValue(previous);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        value={value}
        disabled={isPending}
        aria-label={`Kind for ${categoryName}`}
        onChange={(e) => save(e.target.value as CategoryKind)}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none disabled:opacity-50"
      >
        <option value="FIXED">Fixed</option>
        <option value="VARIABLE">Variable</option>
        <option value="SAVINGS">Savings</option>
      </select>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
