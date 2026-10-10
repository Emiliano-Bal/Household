"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSettlement } from "@/lib/actions";

export function DeleteSettlementButton({ settlementId, householdId }: { settlementId: string; householdId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await deleteSettlement(settlementId, householdId);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      {isPending ? "Deleting..." : "Delete"}
    </button>
  );
}
