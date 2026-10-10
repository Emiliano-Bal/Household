"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { copyLastMonthIncome } from "@/lib/actions";

export function CopyLastMonthButton({ householdId, month }: { householdId: string; month: Date }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      const { copiedCount } = await copyLastMonthIncome(householdId, month);
      setResult(copiedCount === 0 ? "Nothing new to copy." : `Copied ${copiedCount} income record${copiedCount === 1 ? "" : "s"}.`);
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
        {isPending ? "Copying..." : "Copy last month"}
      </button>
      {result && <span className="text-sm text-slate-500">{result}</span>}
    </div>
  );
}
