import Link from "next/link";
import { notFound } from "next/navigation";
import { getHousehold } from "@/lib/queries";
import { HouseholdNav } from "@/components/household-nav";

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
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <Link href="/" className="text-xs font-medium text-slate-400 hover:text-slate-600">
              &larr; All households
            </Link>
            <h1 className="truncate text-base font-semibold text-slate-900 sm:text-lg">{household.name}</h1>
          </div>
          <div className="hidden shrink-0 text-xs text-slate-400 sm:block">
            {household.members.filter((m) => m.active).length} active member
            {household.members.filter((m) => m.active).length === 1 ? "" : "s"}
          </div>
        </div>
        <HouseholdNav
          householdId={householdId}
          members={household.members.map((m) => ({ id: m.id, name: m.name, active: m.active }))}
        />
      </header>
      <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
