import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Drives the real screens against a real database. Each run builds its own
// household and deletes it afterwards, so these never read or write the
// data of a household anyone actually uses.
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

function monthStart(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonths(d: Date, n: number) {
  const m = monthStart(d);
  return new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + n, 1));
}
function monthKey(d: Date) {
  const m = monthStart(d);
  return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
}

const THIS_MONTH = monthStart(new Date());
const NEXT_MONTH = addMonths(THIS_MONTH, 1);
const LAST_MONTH = addMonths(THIS_MONTH, -1);

let householdId: string;
let alice: string;
let bob: string;
let groceriesId: string;
let eatingOutId: string;

test.beforeAll(async () => {
  const household = await prisma.household.create({ data: { name: "__e2e__ budget limits" } });
  householdId = household.id;

  const [a, b] = await Promise.all([
    prisma.member.create({ data: { householdId, name: "Alice" } }),
    prisma.member.create({ data: { householdId, name: "Bob" } }),
  ]);
  alice = a.id;
  bob = b.id;

  const [groceries, eatingOut] = await Promise.all([
    prisma.category.create({ data: { householdId, name: "Groceries", kind: "VARIABLE" } }),
    prisma.category.create({ data: { householdId, name: "Eating Out", kind: "VARIABLE" } }),
    prisma.category.create({ data: { householdId, name: "Rent / Mortgage", kind: "FIXED" } }),
    prisma.category.create({ data: { householdId, name: "Electricity & Gas", kind: "FIXED" } }),
    prisma.category.create({ data: { householdId, name: "Insurance", kind: "FIXED" } }),
    prisma.category.create({ data: { householdId, name: "Savings", kind: "SAVINGS" } }),
  ]);
  groceriesId = groceries.id;
  eatingOutId = eatingOut.id;
});

test.afterAll(async () => {
  await prisma.household.delete({ where: { id: householdId } });
  await prisma.$disconnect();
});

// Scoped to the limits table: "Savings" is also a nav tab and a kind in
// the add-category dropdown, so a bare page-wide text match would find
// those and prove nothing about the table.
function limitsTable(page: import("@playwright/test").Page) {
  return page.locator("section").filter({ hasText: "Variable categories" }).locator("table");
}

test.describe("budget limits screen", () => {
  test("lists variable categories only — no fixed or savings rows anywhere", async ({ page }) => {
    await page.goto(`/h/${householdId}/budget`);

    await expect(page.getByRole("heading", { name: "Adjust budget limits" })).toBeVisible();

    const table = limitsTable(page);
    await expect(table.getByText("Groceries", { exact: true })).toBeVisible();
    await expect(table.getByText("Eating Out", { exact: true })).toBeVisible();

    // Absent entirely — not greyed out, not shown as "not budgeted".
    for (const excluded of ["Rent / Mortgage", "Electricity & Gas", "Insurance", "Savings"]) {
      await expect(table.getByText(excluded, { exact: true })).toHaveCount(0);
    }
    // And no stray "not budgeted" noise left over from the old screen.
    await expect(page.getByText("not budgeted")).toHaveCount(0);

    // One editable limit per variable category, and no more.
    await expect(page.getByRole("textbox", { name: /Monthly limit for/ })).toHaveCount(2);
  });

  test("a limit typed in the UI persists and totals up", async ({ page }) => {
    await page.goto(`/h/${householdId}/budget`);

    await page.getByRole("textbox", { name: "Monthly limit for Groceries" }).fill("500");
    // Saves on blur, which is how the list is meant to be filled.
    await page.getByRole("textbox", { name: "Monthly limit for Eating Out" }).click();
    await expect(page.getByRole("textbox", { name: "Monthly limit for Groceries" })).toHaveValue("500.00");

    await page.getByRole("textbox", { name: "Monthly limit for Eating Out" }).fill("300");
    await page.getByRole("textbox", { name: "Monthly limit for Groceries" }).click();

    await expect(limitsTable(page)).toContainText("800,00 €");
    await expect(page.getByText("2 of 2 limited")).toBeVisible();

    // It really landed in the database, effective from this month.
    const rows = await prisma.budgetLimit.findMany({ where: { categoryId: groceriesId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(50000);
    expect(rows[0].effectiveFrom.getTime()).toBe(THIS_MONTH.getTime());

    await page.reload();
    await expect(page.getByRole("textbox", { name: "Monthly limit for Groceries" })).toHaveValue("500.00");
  });

  test("clearing a box removes the limit rather than setting it to zero", async ({ page }) => {
    await page.goto(`/h/${householdId}/budget`);

    await page.getByRole("textbox", { name: "Monthly limit for Eating Out" }).fill("");
    await page.getByRole("textbox", { name: "Monthly limit for Groceries" }).click();
    await expect(page.getByText("1 of 2 limited")).toBeVisible();

    const row = await prisma.budgetLimit.findFirst({
      where: { categoryId: eatingOutId, effectiveFrom: THIS_MONTH },
    });
    // A real row saying "no limit from here", not a 0 and not a deletion.
    expect(row).not.toBeNull();
    expect(row!.amount).toBeNull();

    // Put it back for the dashboard tests.
    await page.getByRole("textbox", { name: "Monthly limit for Eating Out" }).fill("300");
    await page.getByRole("textbox", { name: "Monthly limit for Groceries" }).click();
    await expect(page.getByText("2 of 2 limited")).toBeVisible();
  });
});

function budgetSection(page: import("@playwright/test").Page) {
  // Anchored on the heading AND exact: both hasText and getByRole's name
  // are case-insensitive substring matches by default, so the countdown
  // widget's "Over budget this month" heading matched either one.
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Budget this month", exact: true }) });
}
function budgetRow(page: import("@playwright/test").Page, category: string) {
  return budgetSection(page).locator("tbody tr").filter({ hasText: category });
}

test.describe("spend against limits on the dashboard", () => {
  test.beforeAll(async () => {
    // Three groceries expenses paid by two different members, one of them
    // personal — all of it is household money leaving a budgeted category.
    const day = new Date(Date.UTC(THIS_MONTH.getUTCFullYear(), THIS_MONTH.getUTCMonth(), 4));
    await prisma.expense.createMany({
      data: [
        { householdId, date: day, label: "alice shop", amount: 12000, categoryId: groceriesId, paidByMemberId: alice, splitRule: { type: "EQUAL" }, isShared: true },
        { householdId, date: day, label: "bob shop", amount: 8000, categoryId: groceriesId, paidByMemberId: bob, splitRule: { type: "EQUAL" }, isShared: true },
        { householdId, date: day, label: "bob solo", amount: 5000, categoryId: groceriesId, paidByMemberId: bob, splitRule: { type: "SOLO", memberId: bob }, isShared: false },
      ],
    });
  });

  test("aggregates every member's spending, whoever paid", async ({ page }) => {
    await page.goto(`/h/${householdId}?month=${monthKey(THIS_MONTH)}`);

    const row = budgetRow(page, "Groceries");
    await expect(row).toContainText("250,00 €"); // 120 + 80 + 50, across both members
    await expect(row).toContainText("500,00 €"); // the limit
    await expect(row).toContainText("50 %");
  });

  test("the same limit applies next month with the spend back at zero", async ({ page }) => {
    await page.goto(`/h/${householdId}?month=${monthKey(NEXT_MONTH)}`);

    const row = budgetRow(page, "Groceries");
    // Limit carried forward with no new row written for next month...
    await expect(row).toContainText("500,00 €");
    // ...and the spend measured against it has reset.
    await expect(row).toContainText("0,00 €");
    await expect(row).toContainText("0 %");

    const rows = await prisma.budgetLimit.findMany({ where: { categoryId: groceriesId } });
    expect(rows).toHaveLength(1);
  });

  test("changing a limit does not rewrite an earlier month's reported limit", async ({ page }) => {
    // Seed history: groceries was 400 a month ago. setBudgetLimit can only
    // write the current month, so the earlier row goes in directly.
    await prisma.budgetLimit.create({
      data: { householdId, categoryId: groceriesId, effectiveFrom: LAST_MONTH, amount: 40000 },
    });

    // Last month still reports against 400, not the current 500.
    await page.goto(`/h/${householdId}?month=${monthKey(LAST_MONTH)}`);
    const past = budgetRow(page, "Groceries");
    await expect(past).toContainText("400,00 €");
    await expect(past).not.toContainText("500,00 €");

    // Now raise this month's limit through the UI.
    await page.goto(`/h/${householdId}/budget`);
    await page.getByRole("textbox", { name: "Monthly limit for Groceries" }).fill("600");
    await page.getByRole("textbox", { name: "Monthly limit for Eating Out" }).click();
    await expect(limitsTable(page)).toContainText("900,00 €");

    // The past month is untouched by that edit.
    await page.goto(`/h/${householdId}?month=${monthKey(LAST_MONTH)}`);
    const stillPast = budgetRow(page, "Groceries");
    await expect(stillPast).toContainText("400,00 €");
    await expect(stillPast).not.toContainText("600,00 €");

    // While the current month reflects the change.
    await page.goto(`/h/${householdId}?month=${monthKey(THIS_MONTH)}`);
    const now = budgetRow(page, "Groceries");
    await expect(now).toContainText("600,00 €");
  });

  test("fixed-category spending never reaches the budget table", async ({ page }) => {
    const rent = await prisma.category.findFirstOrThrow({ where: { householdId, name: "Rent / Mortgage" } });
    const day = new Date(Date.UTC(THIS_MONTH.getUTCFullYear(), THIS_MONTH.getUTCMonth(), 2));
    await prisma.expense.create({
      data: { householdId, date: day, label: "rent", amount: 185000, categoryId: rent.id, paidByMemberId: alice, splitRule: { type: "EQUAL" }, isShared: true },
    });

    await page.goto(`/h/${householdId}?month=${monthKey(THIS_MONTH)}`);

    const section = budgetSection(page);
    await expect(section).toBeVisible();
    // The fixed category has no row here, even with a large expense on it.
    await expect(section.getByText("Rent / Mortgage")).toHaveCount(0);
    // And it moves none of the budget totals.
    await expect(section).toContainText("250,00 €");
  });
});
