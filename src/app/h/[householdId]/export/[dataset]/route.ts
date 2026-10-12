import { prisma } from "@/lib/db";
import { toCsv, csvResponse, centsToDecimalString, isoDate } from "@/lib/csv";

/**
 * One CSV per dataset, downloadable from the Dashboard.
 *
 * This is the backup that works regardless of hosting: it needs no
 * database client, no plan, and no credentials beyond being able to open
 * the page. Amounts are written as decimal numbers rather than cents so a
 * spreadsheet adds them up correctly without anyone having to know the
 * storage convention.
 */
const DATASETS = ["expenses", "income", "settlements", "savings-contributions"] as const;
type Dataset = (typeof DATASETS)[number];

function isDataset(value: string): value is Dataset {
  return (DATASETS as readonly string[]).includes(value);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ householdId: string; dataset: string }> }
) {
  const { householdId, dataset } = await params;

  if (!isDataset(dataset)) {
    return new Response(`Unknown dataset. Expected one of: ${DATASETS.join(", ")}`, { status: 404 });
  }

  // Confirm the household exists before emitting a file: an empty CSV for
  // a mistyped id looks like "you have no data" rather than "wrong id".
  const household = await prisma.household.findUnique({ where: { id: householdId }, select: { name: true } });
  if (!household) return new Response("No such household.", { status: 404 });

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${slug(household.name)}-${dataset}-${stamp}.csv`;

  switch (dataset) {
    case "expenses": {
      const rows = await prisma.expense.findMany({
        where: { householdId },
        include: {
          category: { select: { name: true, kind: true } },
          paidBy: { select: { name: true } },
          shares: { include: { member: { select: { name: true } } } },
        },
        orderBy: { date: "asc" },
      });
      return csvResponse(
        filename,
        toCsv(
          [
            "date",
            "label",
            "amount",
            "category",
            "category_kind",
            "paid_by",
            "split_rule",
            "is_shared",
            "generated_from_recurring",
            "shares",
            "expense_id",
          ],
          rows.map((e) => [
            isoDate(e.date),
            e.label,
            centsToDecimalString(e.amount),
            e.category?.name ?? "",
            e.category?.kind ?? "",
            e.paidBy.name,
            (e.splitRule as { type?: string } | null)?.type ?? "",
            e.isShared ? "yes" : "no",
            e.recurringExpenseId ? "yes" : "no",
            // Per-member split flattened into one cell, so the file stays
            // one row per expense and still carries who owes what.
            e.shares.map((s) => `${s.member.name}=${centsToDecimalString(s.owedAmount)}`).join("; "),
            e.id,
          ])
        )
      );
    }

    case "income": {
      const rows = await prisma.incomeRecord.findMany({
        where: { member: { householdId } },
        include: { member: { select: { name: true } } },
        orderBy: [{ month: "asc" }, { memberId: "asc" }],
      });
      return csvResponse(
        filename,
        toCsv(
          ["month", "member", "source", "net_amount", "income_record_id"],
          rows.map((r) => [isoDate(r.month).slice(0, 7), r.member.name, r.source, centsToDecimalString(r.netAmount), r.id])
        )
      );
    }

    case "settlements": {
      const rows = await prisma.settlement.findMany({
        where: { householdId },
        include: { fromMember: { select: { name: true } }, toMember: { select: { name: true } } },
        orderBy: { date: "asc" },
      });
      return csvResponse(
        filename,
        toCsv(
          ["date", "from_member", "to_member", "amount", "note", "settlement_id"],
          rows.map((s) => [
            isoDate(s.date),
            s.fromMember.name,
            s.toMember.name,
            centsToDecimalString(s.amount),
            s.note ?? "",
            s.id,
          ])
        )
      );
    }

    case "savings-contributions": {
      const rows = await prisma.savingsContribution.findMany({
        where: { goal: { householdId } },
        include: { goal: { select: { name: true } }, member: { select: { name: true } } },
        orderBy: [{ month: "asc" }],
      });
      return csvResponse(
        filename,
        toCsv(
          ["month", "goal", "member", "amount", "is_joint", "contribution_id"],
          rows.map((c) => [
            isoDate(c.month).slice(0, 7),
            c.goal.name,
            c.member.name,
            centsToDecimalString(c.amount),
            c.isJoint ? "yes" : "no",
            c.id,
          ])
        )
      );
    }
  }
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "household"
  );
}
