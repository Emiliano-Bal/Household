"use client";

import type { CategoryKind } from "@prisma/client";

export interface CategoryOption {
  id: string;
  name: string;
  kind: CategoryKind;
}

// listCategories() returns one flat alphabetical list, which interleaves
// commitments with discretionary spending ("Clothing, Electricity & Gas,
// Entertainment, ..."). Grouping restores the fixed/variable/savings
// distinction the dashboard is built around, in that reading order.
const GROUPS: { kind: CategoryKind; label: string }[] = [
  { kind: "FIXED", label: "Fixed" },
  { kind: "VARIABLE", label: "Variable" },
  { kind: "SAVINGS", label: "Savings" },
];

export function CategorySelect({
  categories,
  placeholder,
  required,
  defaultValue,
  className,
}: {
  categories: CategoryOption[];
  /** Label for the empty option — the "no category" affordance differs per form. */
  placeholder: string;
  required?: boolean;
  defaultValue?: string;
  className?: string;
}) {
  return (
    <select name="categoryId" required={required} defaultValue={defaultValue} className={className}>
      <option value="">{placeholder}</option>
      {GROUPS.map(({ kind, label }) => {
        const inGroup = categories.filter((c) => c.kind === kind);
        if (inGroup.length === 0) return null;
        return (
          <optgroup key={kind} label={label}>
            {inGroup.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
