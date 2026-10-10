import Link from "next/link";
import { addMonths, monthKey } from "@/lib/month";

export function MonthNav({ householdId, month, basePath }: { householdId: string; month: Date; basePath: string }) {
  const prev = monthKey(addMonths(month, -1));
  const next = monthKey(addMonths(month, 1));
  const label = month.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const path = `/h/${householdId}${basePath}`;

  return (
    <div className="flex items-center gap-3">
      <Link
        href={`${path}?month=${prev}`}
        className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
      >
        &larr;
      </Link>
      <span className="text-sm font-semibold text-slate-900">{label}</span>
      <Link
        href={`${path}?month=${next}`}
        className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
      >
        &rarr;
      </Link>
    </div>
  );
}
