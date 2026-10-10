"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSavingsGoal, addSavingsContribution } from "@/lib/actions";

export function NewGoalForm({ householdId }: { householdId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);
    const name = String(formData.get("name") ?? "").trim();
    const targetAmount = Math.round(Number(formData.get("targetAmount") ?? 0) * 100);
    const targetDateRaw = String(formData.get("targetDate") ?? "");

    if (!name || !targetAmount) {
      setError("Name and a non-zero target amount are required.");
      return;
    }

    startTransition(async () => {
      await createSavingsGoal({
        householdId,
        name,
        targetAmount,
        targetDate: targetDateRaw ? new Date(targetDateRaw) : null,
      });
      router.refresh();
      (document.getElementById("new-goal-form") as HTMLFormElement | null)?.reset();
    });
  }

  return (
    <form id="new-goal-form" action={onSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-5">
      {error && <p className="w-full rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
        Goal name
        <input name="name" placeholder="Emergency fund" required className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
        Target amount
        <input name="targetAmount" type="number" step="0.01" min="0.01" required className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
        Target date (optional)
        <input name="targetDate" type="date" className={inputClass} />
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {isPending ? "Saving..." : "New goal"}
      </button>
    </form>
  );
}

export function ContributionForm({
  householdId,
  goalId,
  members,
}: {
  householdId: string;
  goalId: string;
  members: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [isJoint, setIsJoint] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);
    const amount = Math.round(Number(formData.get("amount") ?? 0) * 100);
    if (!amount) {
      setError("Enter a non-zero amount.");
      return;
    }
    startTransition(async () => {
      await addSavingsContribution(householdId, {
        goalId,
        memberId,
        month: new Date(),
        amount,
        isJoint,
      });
      router.refresh();
      (document.getElementById(`contribution-form-${goalId}`) as HTMLFormElement | null)?.reset();
    });
  }

  return (
    <form id={`contribution-form-${goalId}`} action={onSubmit} className="flex flex-wrap items-end gap-2">
      {error && <p className="w-full rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700">{error}</p>}
      <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className={smallInputClass}>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <input name="amount" type="number" step="0.01" min="0.01" placeholder="Amount" required className={smallInputClass} />
      <label className="flex items-center gap-1 text-xs text-slate-500">
        <input type="checkbox" checked={isJoint} onChange={(e) => setIsJoint(e.target.checked)} />
        Joint
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {isPending ? "Adding..." : "Add"}
      </button>
    </form>
  );
}

const inputClass = "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none";
const smallInputClass = "rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-emerald-500 focus:outline-none";
