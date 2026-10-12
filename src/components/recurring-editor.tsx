"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { RecurringForm, type EditingRecurring } from "@/components/recurring-form";
import type { CategoryOption } from "@/components/category-select";

/** Keeps the page a server component; edit mode lives in the `edit` param. */
export function RecurringEditor({
  householdId,
  members,
  categories,
  editingRule,
}: {
  householdId: string;
  members: { id: string; name: string }[];
  categories: CategoryOption[];
  editingRule?: EditingRecurring | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function cancelEdit() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("edit");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <RecurringForm
      householdId={householdId}
      members={members}
      categories={categories}
      editingRule={editingRule}
      onCancelEdit={editingRule ? cancelEdit : undefined}
    />
  );
}
