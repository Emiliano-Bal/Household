"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const HOUSEHOLD_ITEMS = [
  { href: "", label: "Dashboard" },
  { href: "/expenses", label: "Expenses" },
  { href: "/budget", label: "Budget" },
  { href: "/recurring", label: "Recurring" },
  { href: "/income", label: "Income" },
  { href: "/savings", label: "Savings" },
  { href: "/settle-up", label: "Settle Up" },
];

export function HouseholdNav({
  householdId,
  members,
}: {
  householdId: string;
  members: { id: string; name: string; active: boolean }[];
}) {
  const pathname = usePathname();
  const base = `/h/${householdId}`;

  // The Dashboard tab is the bare household path, so it has to match
  // exactly — a prefix test would light it up on every sub-route,
  // including the member tabs below.
  function isActive(href: string): boolean {
    if (href === "") return pathname === base || pathname === `${base}/`;
    const full = `${base}${href}`;
    return pathname === full || pathname.startsWith(`${full}/`);
  }

  return (
    <div className="mx-auto max-w-5xl px-6">
      <nav className="flex flex-wrap gap-1">
        {HOUSEHOLD_ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.label}
              href={`${base}${item.href}`}
              aria-current={active ? "page" : undefined}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                active
                  ? "border-emerald-600 text-emerald-700"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {members.length > 0 && (
        // Member views are a different altitude from the household views
        // above — same household, one person's slice of it — so they get
        // their own row rather than extending that tab strip.
        <div className="flex flex-wrap items-center gap-2 pb-3 pt-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Members</span>
          {members.map((m) => {
            const active = isActive(`/m/${m.id}`);
            return (
              <Link
                key={m.id}
                href={`${base}/m/${m.id}`}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  active
                    ? "bg-emerald-600 text-white"
                    : m.active
                      ? "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                      : "bg-slate-50 text-slate-400 hover:bg-slate-100"
                }`}
              >
                {m.name}
                {!m.active && " (inactive)"}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
