"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Five tabs, not eight. The countdown is a Dashboard section, and
// Recurring and Budget are segments inside Expenses — all three of those
// are "money going out", so they belong behind one tab.
const HOUSEHOLD_ITEMS = [
  { href: "", label: "Dashboard" },
  { href: "/expenses", label: "Expenses" },
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
    <div className="mx-auto max-w-5xl px-4 sm:px-6">
      {/* One row that scrolls sideways rather than wrapping onto two:
          five tabs wrapped to a second line on a phone and cost a whole
          row of an already short screen. */}
      <nav className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {HOUSEHOLD_ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.label}
              href={`${base}${item.href}`}
              aria-current={active ? "page" : undefined}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition sm:px-4 ${
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
        <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-2.5 pt-1.5 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-3">
          <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400">Members</span>
          {members.map((m) => {
            const active = isActive(`/m/${m.id}`);
            return (
              <Link
                key={m.id}
                href={`${base}/m/${m.id}`}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${
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
