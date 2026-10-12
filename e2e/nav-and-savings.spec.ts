import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

function monthStart(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function monthKey(d: Date) {
  const m = monthStart(d);
  return `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
}

const THIS_MONTH = monthStart(new Date());

let householdId: string;
let alice: string;
let bob: string;

test.beforeAll(async () => {
  const household = await prisma.household.create({ data: { name: "__e2e__ nav and savings" } });
  householdId = household.id;

  const [a, b] = await Promise.all([
    prisma.member.create({ data: { householdId, name: "Alice" } }),
    prisma.member.create({ data: { householdId, name: "Bob" } }),
  ]);
  alice = a.id;
  bob = b.id;

  const [groceries, rent, goal] = await Promise.all([
    prisma.category.create({ data: { householdId, name: "Groceries", kind: "VARIABLE" } }),
    prisma.category.create({ data: { householdId, name: "Rent", kind: "FIXED" } }),
    prisma.savingsGoal.create({ data: { householdId, name: "Holiday", targetAmount: 500000 } }),
  ]);

  // Income 5000; expenses 1200 fixed + 800 variable; 500 to a goal.
  // Expected saved = 5000 − (1200 + 800 + 500) = 2500, a 50% rate.
  await prisma.incomeRecord.createMany({
    data: [
      { memberId: alice, month: THIS_MONTH, netAmount: 300000, source: "Salary" },
      { memberId: bob, month: THIS_MONTH, netAmount: 200000, source: "Salary" },
    ],
  });
  const day = new Date(Date.UTC(THIS_MONTH.getUTCFullYear(), THIS_MONTH.getUTCMonth(), 3));
  await prisma.expense.createMany({
    data: [
      { householdId, date: day, label: "rent", amount: 120000, categoryId: rent.id, paidByMemberId: alice, splitRule: { type: "EQUAL" }, isShared: true },
      { householdId, date: day, label: "shop", amount: 80000, categoryId: groceries.id, paidByMemberId: bob, splitRule: { type: "EQUAL" }, isShared: true },
    ],
  });
  await prisma.savingsContribution.create({
    data: { goalId: goal.id, memberId: alice, month: THIS_MONTH, amount: 50000, isJoint: false },
  });
});

test.afterAll(async () => {
  await prisma.household.delete({ where: { id: householdId } });
  await prisma.$disconnect();
});

const mainNav = (page: Page) => page.locator("header nav").first();

test.describe("navigation is five tabs", () => {
  test("shows exactly the five top-level tabs", async ({ page }) => {
    await page.goto(`/h/${householdId}`);

    const links = mainNav(page).getByRole("link");
    await expect(links).toHaveCount(5);
    await expect(links).toHaveText(["Dashboard", "Expenses", "Income", "Savings", "Settle Up"]);

    // The three that were merged away are no longer top-level tabs.
    for (const gone of ["Countdown", "Recurring", "Budget"]) {
      await expect(mainNav(page).getByRole("link", { name: gone, exact: true })).toHaveCount(0);
    }
  });

  test("Expenses carries the three segments", async ({ page }) => {
    await page.goto(`/h/${householdId}/expenses`);

    const segments = page.getByRole("navigation", { name: "Expenses sections" });
    await expect(segments.getByRole("link", { name: /Expenses/ })).toBeVisible();
    await expect(segments.getByRole("link", { name: /Recurring/ })).toBeVisible();
    await expect(segments.getByRole("link", { name: /Budget/ })).toBeVisible();

    // The active segment is marked, and switching moves it.
    await expect(segments.getByRole("link", { name: /Expenses/ })).toHaveAttribute("aria-current", "page");
    await segments.getByRole("link", { name: /Recurring/ }).click();
    await expect(page).toHaveURL(new RegExp(`/h/${householdId}/expenses/recurring`));
    await expect(segments.getByRole("link", { name: /Recurring/ })).toHaveAttribute("aria-current", "page");
  });

  test("old routes still work, as redirects", async ({ page }) => {
    for (const [from, to] of [
      [`/h/${householdId}/countdown`, `/h/${householdId}`],
      [`/h/${householdId}/recurring`, `/h/${householdId}/expenses/recurring`],
      [`/h/${householdId}/budget`, `/h/${householdId}/expenses/budget`],
    ]) {
      const response = await page.goto(from);
      expect(response?.status(), `${from} should resolve`).toBe(200);
      expect(new URL(page.url()).pathname, `${from} should land on ${to}`).toBe(to);
    }
  });

  test("the countdown lives on the Dashboard now", async ({ page }) => {
    await page.goto(`/h/${householdId}?month=${monthKey(THIS_MONTH)}`);
    // 5000 income − 2000 of dated expenses = 3000 left to spend. (Goal
    // contributions have no date, so they are not part of the day-by-day
    // draw-down.)
    const countdown = page.locator("section").filter({ hasText: "Left to spend this month" });
    await expect(countdown).toBeVisible();
    await expect(countdown).toContainText("3000,00 €");
    // Its chart came along with it.
    await expect(countdown.locator("svg[role='img']")).toBeVisible();
  });
});

test.describe("savings on the dashboard", () => {
  test("reports income − expenses with contributions deducted", async ({ page }) => {
    await page.goto(`/h/${householdId}?month=${monthKey(THIS_MONTH)}`);

    const savings = page.locator("section").filter({ hasText: "Saved this month" });
    await expect(savings).toBeVisible();

    // 5000 − (1200 + 800 + 500) = 2500
    await expect(savings).toContainText("2500,00 €");
    await expect(savings).toContainText("50,0 %");

    // The breakdown separates the deliberate contribution from the remainder.
    await expect(savings).toContainText("Deliberate goal contributions");
    await expect(savings).toContainText("500,00 €");
    await expect(savings).toContainText("Unallocated leftover");
    await expect(savings).toContainText("Total set aside");
    // 500 committed + 2500 left over
    await expect(savings).toContainText("3000,00 €");
  });

  test("shows a negative figure when the household overspends", async ({ page }) => {
    const over = await prisma.expense.create({
      data: {
        householdId,
        date: new Date(Date.UTC(THIS_MONTH.getUTCFullYear(), THIS_MONTH.getUTCMonth(), 15)),
        label: "blowout",
        amount: 400000,
        paidByMemberId: bob,
        splitRule: { type: "EQUAL" },
        isShared: true,
      },
    });
    try {
      await page.goto(`/h/${householdId}?month=${monthKey(THIS_MONTH)}`);

      const savings = page.locator("section").filter({ hasText: "Overspent this month" });
      await expect(savings).toBeVisible();
      // 5000 − (1200 + 800 + 4000 + 500) = −1500, shown as negative.
      await expect(savings).toContainText("-1500,00 €");
      await expect(savings).toContainText("Shortfall");
      await expect(savings).not.toContainText("Saved this month");
    } finally {
      await prisma.expense.delete({ where: { id: over.id } });
    }
  });
});

test.describe("responsive", () => {
  // Every tab has to survive a phone as well as a desktop; a table that
  // forces the page sideways is the usual failure.
  for (const [label, width, height] of [
    ["desktop 1440px", 1440, 900],
    ["phone 390px", 390, 844],
  ] as const) {
    test(`all five tabs render at ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height });

      const routes = [
        ["Dashboard", `/h/${householdId}`],
        ["Expenses", `/h/${householdId}/expenses`],
        ["Recurring", `/h/${householdId}/expenses/recurring`],
        ["Budget", `/h/${householdId}/expenses/budget`],
        ["Income", `/h/${householdId}/income`],
        ["Savings", `/h/${householdId}/savings`],
        ["Settle Up", `/h/${householdId}/settle-up`],
      ];

      for (const [name, route] of routes) {
        const response = await page.goto(route);
        expect(response?.status(), `${name} should render`).toBe(200);
        await expect(mainNav(page), `${name} nav`).toBeVisible();

        // No horizontal overflow of the document itself. Individual tables
        // may scroll inside their own container; the page must not.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, `${name} at ${width}px should not scroll sideways`).toBeLessThanOrEqual(1);
      }
    });
  }
});

test.describe("recurrence rules", () => {
  test("a weekly rule shows its cadence and next due date", async ({ page }) => {
    const category = await prisma.category.findFirstOrThrow({ where: { householdId, name: "Groceries" } });
    const rule = await prisma.recurringExpense.create({
      data: {
        householdId,
        categoryId: category.id,
        label: "Weekly cleaner",
        amount: 4000,
        frequency: "WEEKLY",
        interval: 1,
        dayOfWeek: 1,
        startMonth: THIS_MONTH,
        paidByMemberId: alice,
        splitRule: { type: "EQUAL" },
      },
    });
    try {
      await page.goto(`/h/${householdId}/expenses/recurring`);

      const row = page.locator("tr", { hasText: "Weekly cleaner" });
      await expect(row).toContainText("Weekly on Monday");
      // A real date, not a placeholder.
      await expect(row).not.toContainText("—");

      // Generating produces one expense per occurrence, and re-running adds none.
      await page.getByRole("button", { name: /Generate this month/ }).click();
      await expect(page.getByText(/Created \d+ of \d+ due expense/)).toBeVisible();

      const after = await prisma.expense.count({ where: { recurringExpenseId: rule.id } });
      expect(after).toBeGreaterThanOrEqual(4);
      expect(after).toBeLessThanOrEqual(5);

      await page.reload();
      await page.getByRole("button", { name: /Generate this month/ }).click();
      await expect(page.getByText("Already generated — nothing new to create.")).toBeVisible();
      expect(await prisma.expense.count({ where: { recurringExpenseId: rule.id } })).toBe(after);
    } finally {
      await prisma.expense.deleteMany({ where: { recurringExpenseId: rule.id } });
      await prisma.recurringExpense.delete({ where: { id: rule.id } });
    }
  });

  test("a 31st-of-the-month rule reads as clamping in short months", async ({ page }) => {
    const category = await prisma.category.findFirstOrThrow({ where: { householdId, name: "Rent" } });
    const rule = await prisma.recurringExpense.create({
      data: {
        householdId,
        categoryId: category.id,
        label: "Rent on the 31st",
        amount: 150000,
        frequency: "MONTHLY",
        interval: 1,
        dayOfMonth: 31,
        startMonth: THIS_MONTH,
        paidByMemberId: alice,
        splitRule: { type: "EQUAL" },
      },
    });
    try {
      await page.goto(`/h/${householdId}/expenses/recurring`);
      const row = page.locator("tr", { hasText: "Rent on the 31st" });
      await expect(row).toContainText("Monthly on the 31st");
      await expect(row).toContainText("last day in shorter months");
    } finally {
      await prisma.recurringExpense.delete({ where: { id: rule.id } });
    }
  });
});
