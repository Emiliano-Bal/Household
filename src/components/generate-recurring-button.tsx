"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateRecurringForMonth } from "@/lib/actions";

export function GenerateRecurringButton({ householdId, month }: { householdId: string; month: Date }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      const { createdCount, dueCount } = await generateRecurringForMonth(householdId, month);
      setResult(
        dueCount === 0
          ? "No recurring expenses are due this month."
          : createdCount === 0
            ? "Already generated — nothing new to create."
            : `Created ${createdCount} of ${dueCount} due expense${dueCount === 1 ? "" : "s"}.`
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
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {isPending ? "Generating..." : "Generate this month"}
      </button>
      {result && <span className="text-sm text-slate-500">{result}</span>}
    </div>
  );
}
