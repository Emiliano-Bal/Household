import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const monthKey = (d: Date) => {
  const m = monthStart(d);
  return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
};

const THIS_MONTH = monthStart(new Date());
const DAY = new Date(Date.UTC(THIS_MONTH.getUTCFullYear(), THIS_MONTH.getUTCMonth(), 6));

let householdId: string;
let alice: string;
let bob: string;
let categoryId: string;

test.beforeAll(async () => {
  const household = await prisma.household.create({ data: { name: "__e2e__ edit delete export" } });
  householdId = household.id;

  const [a, b] = await Promise.all([
    prisma.member.create({ data: { householdId, name: "Alice" } }),
    prisma.member.create({ data: { householdId, name: "Bob" } }),
  ]);
  alice = a.id;
  bob = b.id;

  const category = await prisma.category.create({ data: { householdId, name: "Groceries", kind: "VARIABLE" } });
  categoryId = category.id;

  await prisma.incomeRecord.createMany({
    data: [
      { memberId: alice, month: THIS_MONTH, netAmount: 200000, source: "Salary" },
      { memberId: bob, month: THIS_MONTH, netAmount: 200000, source: "Salary" },
    ],
  });
});

test.afterAll(async () => {
  await prisma.household.delete({ where: { id: householdId } });
  await prisma.$disconnect();
});

async function seedExpense(label: string, amountCents: number) {
  return prisma.expense.create({
    data: {
      householdId,
      date: DAY,
      label,
      amount: amountCents,
      categoryId,
      paidByMemberId: alice,
      splitRule: { type: "EQUAL" },
      isShared: true,
      shares: {
        create: [
          { memberId: alice, owedAmount: amountCents / 2 },
          { memberId: bob, owedAmount: amountCents / 2 },
        ],
      },
    },
  });
}

const openDetail = async (page: Page, expenseId: string) =>
  page.goto(`/h/${householdId}/expenses?month=${monthKey(THIS_MONTH)}&expenseId=${expenseId}`);

test.describe("editing an expense from the UI", () => {
  test("changes the amount and rewrites the shares", async ({ page }) => {
    const expense = await seedExpense("Editable shop", 10000);
    try {
      await openDetail(page, expense.id);
      await page.getByRole("link", { name: "Edit", exact: true }).click();

      const amount = page.getByRole("spinbutton", { name: "Amount" });
      await expect(amount).toHaveValue("100.00");
      await amount.fill("160");
      await page.getByRole("button", { name: "Save changes" }).click();

      // Wait for the form to actually leave edit mode. Asserting the
      // button is gone is not enough: while saving it relabels itself
      // "Saving...", so it disappears by name mid-write and the DB read
      // below would race it.
      await expect(page.getByRole("button", { name: "Add expense" })).toBeVisible();

      const after = await prisma.expense.findUniqueOrThrow({
        where: { id: expense.id },
        include: { shares: true },
      });
      expect(after.amount).toBe(16000);
      expect(after.shares.reduce((sum, s) => sum + s.owedAmount, 0)).toBe(16000);
      for (const s of after.shares) expect(s.owedAmount).toBe(8000);
    } finally {
      await prisma.expense.deleteMany({ where: { id: expense.id } });
    }
  });

  test("warns with real before/after balances when the period is settled", async ({ page }) => {
    const expense = await seedExpense("Settled shop", 10000);
    const settlement = await prisma.settlement.create({
      data: { householdId, fromMemberId: bob, toMemberId: alice, amount: 5000, date: DAY },
    });
    try {
      await openDetail(page, expense.id);
      await page.getByRole("link", { name: "Edit", exact: true }).click();
      await page.getByRole("spinbutton", { name: "Amount" }).fill("200");
      await page.getByRole("button", { name: "Save changes" }).click();

      // Concrete figures, not a generic "are you sure".
      const warning = page.getByText(/already been settled/);
      await expect(warning).toBeVisible();
      await expect(page.getByText(/Alice.*goes from settled to.*owed 50,00/)).toBeVisible();
      await expect(page.getByText(/50,00\s€ paid/)).toBeVisible();

      // Nothing was written while the warning stands.
      expect((await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } })).amount).toBe(10000);

      // It warns, it does not block.
      await page.getByRole("button", { name: "Save anyway" }).click();
      await expect(page.getByRole("button", { name: "Add expense" })).toBeVisible();
      expect((await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } })).amount).toBe(20000);
    } finally {
      await prisma.settlement.deleteMany({ where: { id: settlement.id } });
      await prisma.expense.deleteMany({ where: { id: expense.id } });
    }
  });

  test("deleting asks first and then removes the expense", async ({ page }) => {
    const expense = await seedExpense("Deletable", 3000);
    try {
      await openDetail(page, expense.id);
      await page.getByRole("button", { name: "Delete", exact: true }).click();

      await expect(page.getByText(/Delete .Deletable/)).toBeVisible();
      // Nothing gone yet.
      expect(await prisma.expense.count({ where: { id: expense.id } })).toBe(1);

      // Backing out leaves it alone.
      await page.getByRole("button", { name: "Keep it" }).click();
      expect(await prisma.expense.count({ where: { id: expense.id } })).toBe(1);

      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await page.getByRole("button", { name: "Delete anyway" }).click();

      await expect.poll(() => prisma.expense.count({ where: { id: expense.id } })).toBe(0);
      expect(await prisma.expenseShare.count({ where: { expenseId: expense.id } })).toBe(0);
    } finally {
      await prisma.expense.deleteMany({ where: { id: expense.id } });
    }
  });
});

test.describe("recurring rules", () => {
  test("deleting a rule keeps the expenses it generated", async ({ page }) => {
    const rule = await prisma.recurringExpense.create({
      data: {
        householdId,
        categoryId,
        label: "Keepable rule",
        amount: 5000,
        frequency: "MONTHLY",
        interval: 1,
        dayOfMonth: 8,
        startMonth: THIS_MONTH,
        paidByMemberId: alice,
        splitRule: { type: "EQUAL" },
      },
    });
    try {
      await page.goto(`/h/${householdId}/expenses/recurring`);
      await page.getByRole("button", { name: /Generate this month/ }).click();
      await expect(page.getByText(/Created 1 of 1 due expense/)).toBeVisible();
      expect(await prisma.expense.count({ where: { recurringExpenseId: rule.id } })).toBe(1);

      const row = page.locator("tr", { hasText: "Keepable rule" });
      await row.getByRole("button", { name: "Delete" }).click();

      // The dialog states the default plainly.
      await expect(page.getByText(/will be kept/)).toBeVisible();
      await page.getByRole("button", { name: "Delete rule only" }).click();

      // Rule gone, expense kept and detached.
      await expect.poll(() => prisma.recurringExpense.count({ where: { id: rule.id } })).toBe(0);
      const kept = await prisma.expense.findFirstOrThrow({ where: { householdId, label: "Keepable rule" } });
      expect(kept.recurringExpenseId).toBeNull();
      expect(kept.amount).toBe(5000);
      await prisma.expense.delete({ where: { id: kept.id } });
    } finally {
      await prisma.recurringExpense.deleteMany({ where: { id: rule.id } });
      await prisma.expense.deleteMany({ where: { householdId, label: "Keepable rule" } });
    }
  });

  test("editing a rule changes the rule, not the expenses it already made", async ({ page }) => {
    const rule = await prisma.recurringExpense.create({
      data: {
        householdId,
        categoryId,
        label: "Editable rule",
        amount: 5000,
        frequency: "MONTHLY",
        interval: 1,
        dayOfMonth: 9,
        startMonth: THIS_MONTH,
        paidByMemberId: alice,
        splitRule: { type: "EQUAL" },
      },
    });
    try {
      await prisma.expense.create({
        data: {
          householdId,
          date: DAY,
          label: "Editable rule",
          amount: 5000,
          categoryId,
          paidByMemberId: alice,
          splitRule: { type: "EQUAL" },
          isShared: true,
          recurringExpenseId: rule.id,
          occurrenceDate: DAY,
          shares: { create: [{ memberId: alice, owedAmount: 2500 }, { memberId: bob, owedAmount: 2500 }] },
        },
      });

      await page.goto(`/h/${householdId}/expenses/recurring?edit=${rule.id}`);
      await expect(page.getByText(/Changes apply to future generations only/)).toBeVisible();

      await page.getByRole("spinbutton", { name: "Amount" }).fill("75");
      await page.getByRole("button", { name: "Save changes" }).click();

      await expect.poll(async () => (await prisma.recurringExpense.findUniqueOrThrow({ where: { id: rule.id } })).amount).toBe(7500);
      // The already-generated expense keeps the amount it was made with.
      const generated = await prisma.expense.findFirstOrThrow({ where: { recurringExpenseId: rule.id } });
      expect(generated.amount).toBe(5000);
    } finally {
      await prisma.expense.deleteMany({ where: { recurringExpenseId: rule.id } });
      await prisma.recurringExpense.deleteMany({ where: { id: rule.id } });
    }
  });
});

test.describe("CSV export", () => {
  test("every dataset downloads and parses cleanly", async ({ page }) => {
    const expense = await seedExpense("Exported, with a comma", 12345);
    const settlement = await prisma.settlement.create({
      data: { householdId, fromMemberId: bob, toMemberId: alice, amount: 2500, date: DAY, note: 'He said "thanks"' },
    });
    const goal = await prisma.savingsGoal.create({ data: { householdId, name: "Holiday", targetAmount: 100000 } });
    const contribution = await prisma.savingsContribution.create({
      data: { goalId: goal.id, memberId: alice, month: THIS_MONTH, amount: 7500, isJoint: false },
    });

    try {
      await page.goto(`/h/${householdId}`);

      for (const [slug, expectedHeader] of [
        ["expenses", "date,label,amount,category,category_kind,paid_by,split_rule,is_shared,generated_from_recurring,shares,expense_id"],
        ["income", "month,member,source,net_amount,income_record_id"],
        ["settlements", "date,from_member,to_member,amount,note,settlement_id"],
        ["savings-contributions", "month,goal,member,amount,is_joint,contribution_id"],
      ]) {
        const response = await page.request.get(`/h/${householdId}/export/${slug}`);
        expect(response.status(), slug).toBe(200);
        expect(response.headers()["content-type"]).toContain("text/csv");
        expect(response.headers()["content-disposition"]).toContain("attachment");

        const body = await response.text();
        // BOM so Excel reads UTF-8 and the € sign survives.
        expect(body.charCodeAt(0)).toBe(0xfeff);
        const lines = body.slice(1).trim().split("\r\n");
        expect(lines[0]).toBe(expectedHeader);
        expect(lines.length).toBeGreaterThan(1);

        // Every row has the same number of fields as the header once
        // quoted commas are accounted for.
        const expectedCols = expectedHeader.split(",").length;
        for (const line of lines.slice(1)) {
          expect(parseCsvLine(line).length, `${slug}: ${line}`).toBe(expectedCols);
        }
      }

      // Amounts are decimal numbers, not cents, so a spreadsheet sums them.
      const expensesCsv = (await (await page.request.get(`/h/${householdId}/export/expenses`)).text()).slice(1);
      const row = expensesCsv.split("\r\n").find((l) => l.includes("Exported"))!;
      const fields = parseCsvLine(row);
      expect(fields[1]).toBe("Exported, with a comma"); // the comma survived quoting
      expect(fields[2]).toBe("123.45");

      // A quote inside a note round-trips.
      const settlementsCsv = (await (await page.request.get(`/h/${householdId}/export/settlements`)).text()).slice(1);
      const settlementRow = parseCsvLine(settlementsCsv.split("\r\n")[1]);
      expect(settlementRow[4]).toBe('He said "thanks"');

      // An unknown dataset is a 404, not an empty file that looks like data.
      expect((await page.request.get(`/h/${householdId}/export/nonsense`)).status()).toBe(404);
    } finally {
      await prisma.savingsContribution.deleteMany({ where: { id: contribution.id } });
      await prisma.savingsGoal.deleteMany({ where: { id: goal.id } });
      await prisma.settlement.deleteMany({ where: { id: settlement.id } });
      await prisma.expense.deleteMany({ where: { id: expense.id } });
    }
  });

  test("the Dashboard links to all four exports", async ({ page }) => {
    await page.goto(`/h/${householdId}`);
    const section = page.locator("section").filter({ hasText: "Export / backup" });
    await expect(section).toBeVisible();
    for (const label of ["Expenses CSV", "Income CSV", "Settlements CSV", "Savings contributions CSV"]) {
      await expect(section.getByRole("link", { name: label })).toBeVisible();
    }
  });
});

/** Enough of RFC 4180 to verify what the exporter writes. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}
