import { Suspense } from "react";
import { ExpensesSegments } from "@/components/expenses-segments";

export default async function ExpensesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ householdId: string }>;
}) {
  const { householdId } = await params;

  return (
    <div className="flex flex-col gap-6">
      {/* useSearchParams needs a Suspense boundary to keep the rest of the
          route from opting into client-side rendering wholesale. */}
      <Suspense fallback={<div className="h-10 border-b border-slate-200" />}>
        <ExpensesSegments householdId={householdId} />
      </Suspense>
      {children}
    </div>
  );
}
