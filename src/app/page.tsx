import Link from "next/link";
import { listHouseholds } from "@/lib/queries";
import { CreateHouseholdForm } from "@/components/create-household-form";

// Always reads the live household list — never prerender this statically.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const households = await listHouseholds();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Household Budget</h1>
        <p className="mt-1 text-sm text-slate-500">
          Income-proportional expense splitting for people living together.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Your households</h2>
        {households.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
            No households yet — create one below to get started.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {households.map((household) => (
              <li key={household.id}>
                <Link
                  href={`/h/${household.id}`}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium text-slate-800 transition hover:border-emerald-400 hover:bg-emerald-50"
                >
                  <span>{household.name}</span>
                  <span className="text-slate-400">&rarr;</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-slate-200 pt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Create a household</h2>
        <CreateHouseholdForm />
      </section>
    </main>
  );
}
