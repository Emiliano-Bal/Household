"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMember, createCategory } from "@/lib/actions";

export function MemberQuickAdd({ householdId }: { householdId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    if (!name) {
      setError("Enter a name.");
      return;
    }
    startTransition(async () => {
      await createMember({ householdId, name, email: email || undefined });
      router.refresh();
      (document.getElementById("member-quick-add") as HTMLFormElement | null)?.reset();
    });
  }

  return (
    <form id="member-quick-add" action={onSubmit} className="flex flex-wrap items-end gap-2">
      {error && <p className="w-full rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700">{error}</p>}
      <input name="name" placeholder="Member name" required className={smallInputClass} />
      <input name="email" placeholder="Email (optional)" className={smallInputClass} />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {isPending ? "Adding..." : "Add member"}
      </button>
    </form>
  );
}

export function CategoryQuickAdd({ householdId }: { householdId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);
    const name = String(formData.get("name") ?? "").trim();
    const kind = String(formData.get("kind") ?? "VARIABLE") as "FIXED" | "VARIABLE" | "SAVINGS";
    if (!name) {
      setError("Enter a category name.");
      return;
    }
    startTransition(async () => {
      await createCategory(householdId, name, kind);
      router.refresh();
      (document.getElementById("category-quick-add") as HTMLFormElement | null)?.reset();
    });
  }

  return (
    <form id="category-quick-add" action={onSubmit} className="flex flex-wrap items-end gap-2">
      {error && <p className="w-full rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700">{error}</p>}
      <input name="name" placeholder="Category name" required className={smallInputClass} />
      <select name="kind" defaultValue="VARIABLE" className={smallInputClass}>
        <option value="FIXED">Fixed</option>
        <option value="VARIABLE">Variable</option>
        <option value="SAVINGS">Savings</option>
      </select>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {isPending ? "Adding..." : "Add category"}
      </button>
    </form>
  );
}

const smallInputClass = "rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-emerald-500 focus:outline-none";
