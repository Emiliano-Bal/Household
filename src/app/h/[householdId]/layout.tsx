import Link from "next/link";
import { notFound } from "next/navigation";
import { getHousehold } from "@/lib/queries";

const NAV_ITEMS = [
  { href: "", label: "Dashboard" },
  { href: "/expenses", label: "Expenses" },
  { href: "/recurring", label: "Recurring" },
  { href: "/income", label: "Income" },
  { href: "/savings", label: "Savings" },
  { href: "/settle-up", label: "Settle Up" },
];

export default async function HouseholdLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;
  const household = await getHousehold(householdId);
  if (!household) notFound();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-xs font-medium text-slate-400 hover:text-slate-600">
              &larr; All households
            </Link>
            <h1 className="text-lg font-semibold text-slate-900">{household.name}</h1>
          </div>
          <div className="text-xs text-slate-400">
            {household.members.filter((m) => m.active).length} active member
            {household.members.filter((m) => m.active).length === 1 ? "" : "s"}
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 px-6">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              href={`/h/${householdId}${item.href}`}
              className="rounded-t-md px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
