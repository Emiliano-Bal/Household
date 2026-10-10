import { listSavingsGoals, getHousehold } from "@/lib/queries";
import { formatCents, formatPercent } from "@/lib/money";
import { NewGoalForm, ContributionForm } from "@/components/savings-forms";

export default async function SavingsPage({ params }: { params: Promise<{ householdId: string }> }) {
  const { householdId } = await params;
  const [household, goals] = await Promise.all([getHousehold(householdId), listSavingsGoals(householdId)]);
  if (!household) return null;

  const members = household.members.filter((m) => m.active);

  return (
    <div className="flex flex-col gap-6">
      {goals.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
          No savings goals yet — create one below.
        </p>
      )}

      {goals.map((goal) => {
        const savedCents = goal.contributions.reduce((sum, c) => sum + c.amount, 0);
        const progress = goal.targetAmount > 0 ? Math.min(100, (savedCents / goal.targetAmount) * 100) : 0;

        return (
          <div key={goal.id} className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">{goal.name}</h2>
              <span className="text-sm text-slate-500">
                {formatCents(savedCents)} / {formatCents(goal.targetAmount)}
              </span>
            </div>
            {goal.targetDate && (
              <p className="text-xs text-slate-400">
                Target date: {goal.targetDate.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}
              </p>
            )}
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-400">{formatPercent(progress, undefined, 0)} of goal</p>

            {goal.contributions.length > 0 && (
              <ul className="mt-4 flex flex-col gap-1 text-sm">
                {goal.contributions.slice(0, 5).map((c) => (
                  <li key={c.id} className="flex justify-between text-slate-500">
                    <span>
                      {c.member.name}
                      {c.isJoint ? " (joint)" : ""} —{" "}
                      {c.month.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}
                    </span>
                    <span className="font-medium text-slate-700">{formatCents(c.amount)}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 border-t border-slate-100 pt-4">
              <ContributionForm householdId={householdId} goalId={goal.id} members={members} />
            </div>
          </div>
        );
      })}

      <NewGoalForm householdId={householdId} />
    </div>
  );
}
