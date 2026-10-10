"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSettlement } from "@/lib/actions";

export function RecordSettlementButton({
  householdId,
  fromMemberId,
  toMemberId,
  amountCents,
}: {
  householdId: string;
  fromMemberId: string;
  toMemberId: string;
  amountCents: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function handleClick() {
    startTransition(async () => {
      await createSettlement({ householdId, fromMemberId, toMemberId, amount: amountCents });
      setDone(true);
      router.refresh();
    });
  }

  if (done) return <span className="text-xs font-medium text-emerald-600">Recorded</span>;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
    >
      {isPending ? "Recording..." : "Mark as paid"}
    </button>
  );
}
