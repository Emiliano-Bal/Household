"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createHousehold } from "@/lib/actions";

export function CreateHouseholdForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);
    const name = String(formData.get("name") ?? "").trim();
    if (!name) {
      setError("Enter a household name.");
      return;
    }
    // No currency field: every amount in the app renders EUR/es-ES
    // regardless of what's stored here (see src/lib/money.ts).
    startTransition(async () => {
      const household = await createHousehold(name);
      router.push(`/h/${household.id}`);
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-2">
      {error && <p className="rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <input
          name="name"
          placeholder="e.g. Nano & Shelle"
          required
          disabled={isPending}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {isPending ? "Creating..." : "Create"}
        </button>
      </div>
    </form>
  );
}
