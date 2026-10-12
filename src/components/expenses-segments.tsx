"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// Expenses, Recurring and Budget are all "money going out", so they live
// under one tab as segments rather than three top-level tabs.
const SEGMENTS = [
  { href: "", label: "Expenses", hint: "the list" },
  { href: "/recurring", label: "Recurring", hint: "the rules" },
  { href: "/budget", label: "Budget", hint: "the limits" },
];

export function ExpensesSegments({ householdId }: { householdId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const base = `/h/${householdId}/expenses`;

  // Carry the month across segments so switching doesn't silently throw
  // the reader back to today. Budget is deliberately month-less, so it
  // never takes one.
  const month = searchParams.get("month");

  return (
    <nav className="flex flex-wrap gap-1 border-b border-slate-200" aria-label="Expenses sections">
      {SEGMENTS.map((segment) => {
        const full = `${base}${segment.href}`;
        const active = segment.href === "" ? pathname === base : pathname === full || pathname.startsWith(`${full}/`);
        const href = month && segment.href !== "/budget" ? `${full}?month=${month}` : full;
        return (
          <Link
            key={segment.label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              active
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900"
            }`}
          >
            {segment.label}
            <span className="ml-1.5 hidden text-xs font-normal text-slate-400 sm:inline">{segment.hint}</span>
          </Link>
        );
      })}
    </nav>
  );
}
