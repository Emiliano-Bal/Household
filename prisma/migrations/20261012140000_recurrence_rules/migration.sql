-- Real recurrence rules on RecurringExpense, and an idempotency key on the
-- occurrence rather than the month.
--
-- Hand-ordered rather than taken from `migrate diff`, which emits
-- `DROP COLUMN "generatedForMonth"` followed by `ADD COLUMN
-- "occurrenceDate"` and would throw away the link between every already
-- generated expense and its occurrence. Renaming and backfilling keeps it.

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- AlterTable: existing rules are monthly by definition — that is all the
-- old shape could express — so the default carries them over unchanged,
-- keeping whatever dayOfMonth they already had.
ALTER TABLE "RecurringExpense"
  ADD COLUMN "frequency" "RecurrenceFrequency" NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN "interval" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "dayOfWeek" INTEGER,
  ALTER COLUMN "dayOfMonth" DROP NOT NULL;

-- Rename rather than drop-and-add, so generated expenses keep their key.
ALTER TABLE "Expense" RENAME COLUMN "generatedForMonth" TO "occurrenceDate";

-- The old column held the 1st of the month; the occurrence is the actual
-- date the expense was posted on, which is what `date` already holds.
-- Without this every migrated row would key on the 1st and collide the
-- moment a second occurrence in that month was generated.
UPDATE "Expense" SET "occurrenceDate" = "date" WHERE "occurrenceDate" IS NOT NULL;

-- DropIndex / CreateIndex: the uniqueness moves with the column.
DROP INDEX "Expense_recurringExpenseId_generatedForMonth_key";
CREATE UNIQUE INDEX "Expense_recurringExpenseId_occurrenceDate_key" ON "Expense"("recurringExpenseId", "occurrenceDate");
