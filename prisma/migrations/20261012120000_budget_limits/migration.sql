-- Replaces the per-month Budget table with standing BudgetLimit rows that
-- carry an effective-from month.
--
-- Hand-ordered rather than taken straight from `migrate diff`, which emits
-- the DROP before the CREATE and would discard every existing row. Here the
-- new table is created and populated first, and Budget is dropped only once
-- its data has been carried across.

-- CreateTable
CREATE TABLE "BudgetLimit" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetLimit_householdId_effectiveFrom_idx" ON "BudgetLimit"("householdId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetLimit_categoryId_effectiveFrom_key" ON "BudgetLimit"("categoryId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "BudgetLimit" ADD CONSTRAINT "BudgetLimit_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLimit" ADD CONSTRAINT "BudgetLimit_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry existing budgets over. Each old per-month row becomes a limit
-- effective from that same month, which preserves its meaning exactly: the
-- amount applied to that month, and now also to later months until
-- superseded.
--
-- VARIABLE categories only. Budgets on fixed commitments and savings are
-- dropped on purpose — they are no longer representable, and keeping them
-- would leave rows no screen can show or edit. DISTINCT ON collapses any
-- duplicate (category, month) pair that a pre-constraint row might have
-- left behind.
INSERT INTO "BudgetLimit" ("id", "householdId", "categoryId", "effectiveFrom", "amount", "createdAt", "updatedAt")
SELECT DISTINCT ON (b."categoryId", b."month")
       b."id", b."householdId", b."categoryId", b."month", b."amount", b."createdAt", b."updatedAt"
FROM "Budget" b
JOIN "Category" c ON c."id" = b."categoryId"
WHERE c."kind" = 'VARIABLE';

-- DropForeignKey
ALTER TABLE "Budget" DROP CONSTRAINT "Budget_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "Budget" DROP CONSTRAINT "Budget_householdId_fkey";

-- DropTable
DROP TABLE "Budget";
