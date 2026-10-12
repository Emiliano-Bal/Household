import { monthStart, addMonths, daysInMonth } from "./month";
import type { MemberId, SplitRule } from "./splitting";

export type RecurrenceFrequency = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

export interface RecurringExpenseInput {
  id: string;
  categoryId: string;
  label: string;
  amount: number; // cents
  frequency: RecurrenceFrequency;
  /** Every N units of the frequency. 1 is "every week/month/quarter/year". */
  interval: number;
  /** Month-based frequencies. Kept as written (29-31 included) and clamped per month at read time. */
  dayOfMonth: number | null;
  /** WEEKLY only. 0 = Sunday .. 6 = Saturday, matching Date#getUTCDay. */
  dayOfWeek: number | null;
  /** First month of the series, and its anchor. */
  startMonth: Date;
  endMonth: Date | null;
  paidByMemberId: MemberId;
  splitRule: SplitRule;
  active: boolean;
}

export interface MaterializedExpenseDraft {
  recurringExpenseId: string;
  categoryId: string;
  label: string;
  amount: number;
  date: Date;
  paidByMemberId: MemberId;
  splitRule: SplitRule;
  /** Identifies the occurrence for idempotency; always equal to `date`. */
  occurrenceDate: Date;
}

/** How many months one step of this frequency covers. WEEKLY is not month-stepped. */
const MONTHS_PER_STEP: Record<Exclude<RecurrenceFrequency, "WEEKLY">, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  YEARLY: 12,
};

function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

/**
 * The day this rule falls on within a given month, clamped to the month's
 * length. A rule written for the 31st still means the 31st — it lands on
 * the 28th in February and the 30th in April rather than being skipped or
 * spilling into the next month.
 */
export function clampDayToMonth(dayOfMonth: number, month: Date): number {
  const total = daysInMonth(month);
  return Math.min(Math.max(1, dayOfMonth), total);
}

function stepMonths(rule: RecurringExpenseInput): number {
  const base = MONTHS_PER_STEP[rule.frequency as Exclude<RecurrenceFrequency, "WEEKLY">] ?? 1;
  return base * Math.max(1, rule.interval);
}

/** Inclusive lower bound: a rule never fires before its start month. */
function startsBy(rule: RecurringExpenseInput, month: Date): boolean {
  return monthStart(rule.startMonth).getTime() <= monthStart(month).getTime();
}

/** Inclusive upper bound: endMonth is the last month it may fire in. */
function notEndedBy(rule: RecurringExpenseInput, month: Date): boolean {
  if (!rule.endMonth) return true;
  return monthStart(rule.endMonth).getTime() >= monthStart(month).getTime();
}

/**
 * The first date on or after `from` whose weekday is `dayOfWeek`.
 * Anchors a weekly series so `interval` counts from a real date rather
 * than from the 1st of the month, which would make every month restart
 * the fortnightly cadence.
 */
function firstWeekdayOnOrAfter(from: Date, dayOfWeek: number): Date {
  const delta = (dayOfWeek - from.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + delta));
}

/**
 * Every date this rule fires on within `month`.
 *
 * Returns [] when the rule is inactive, hasn't started, has ended, or
 * simply doesn't land in this month (a quarterly rule in an off month).
 * Weekly rules return the four or five dates they actually fall on.
 */
export function occurrencesInMonth(rule: RecurringExpenseInput, month: Date): Date[] {
  const target = monthStart(month);
  if (!rule.active) return [];
  if (!startsBy(rule, target) || !notEndedBy(rule, target)) return [];

  if (rule.frequency === "WEEKLY") {
    const dayOfWeek = rule.dayOfWeek;
    // A weekly rule with no weekday is not expressible; treat it as
    // producing nothing rather than guessing a day.
    if (dayOfWeek === null || dayOfWeek < 0 || dayOfWeek > 6) return [];

    const everyNWeeks = Math.max(1, rule.interval);
    const anchor = firstWeekdayOnOrAfter(monthStart(rule.startMonth), dayOfWeek);
    const monthEnd = utcDate(target.getUTCFullYear(), target.getUTCMonth(), daysInMonth(target));

    const dates: Date[] = [];
    // Jump straight to the first in-month occurrence instead of walking
    // week by week from the anchor, which could be years back.
    const msPerStep = everyNWeeks * 7 * 86_400_000;
    const gap = target.getTime() - anchor.getTime();
    const skipped = gap > 0 ? Math.ceil(gap / msPerStep) : 0;
    let cursor = new Date(anchor.getTime() + skipped * msPerStep);

    while (cursor.getTime() <= monthEnd.getTime()) {
      if (cursor.getTime() >= target.getTime()) dates.push(new Date(cursor.getTime()));
      cursor = new Date(cursor.getTime() + msPerStep);
    }
    return dates;
  }

  // Month-based: the rule fires only in months an exact number of steps
  // from the start month.
  const step = stepMonths(rule);
  const start = monthStart(rule.startMonth);
  const monthsApart =
    (target.getUTCFullYear() - start.getUTCFullYear()) * 12 + (target.getUTCMonth() - start.getUTCMonth());
  if (monthsApart < 0 || monthsApart % step !== 0) return [];

  const day = clampDayToMonth(rule.dayOfMonth ?? 1, target);
  return [utcDate(target.getUTCFullYear(), target.getUTCMonth(), day)];
}

/**
 * The next date this rule fires on, at or after `from`. null when the rule
 * is inactive or has ended.
 *
 * Bounded rather than open-ended: it looks ahead far enough to clear a
 * yearly rule with a long interval and then gives up, so a rule that can
 * never fire again cannot spin forever.
 */
export function nextOccurrence(rule: RecurringExpenseInput, from: Date): Date | null {
  if (!rule.active) return null;

  const fromMonth = monthStart(from);
  const searchStart = monthStart(rule.startMonth).getTime() > fromMonth.getTime() ? monthStart(rule.startMonth) : fromMonth;
  // 12 years of months covers a YEARLY rule with an interval of up to 12.
  const horizon = 12 * 12 + 1;

  for (let i = 0; i < horizon; i++) {
    const month = addMonths(searchStart, i);
    if (!notEndedBy(rule, month)) return null;
    for (const date of occurrencesInMonth(rule, month)) {
      if (date.getTime() >= from.getTime()) return date;
    }
  }
  return null;
}

/** Which rules have at least one occurrence in targetMonth. */
export function recurringExpensesDueForMonth(
  recurring: RecurringExpenseInput[],
  targetMonth: Date
): RecurringExpenseInput[] {
  return recurring.filter((r) => occurrencesInMonth(r, targetMonth).length > 0);
}

/**
 * The Expense drafts this rule produces for targetMonth — one per
 * occurrence, so a weekly rule yields four or five.
 *
 * Writes nothing and checks nothing: the caller handles idempotency, via
 * the Expense @@unique([recurringExpenseId, occurrenceDate]) constraint.
 */
export function materializeRecurringExpenses(
  recurring: RecurringExpenseInput,
  targetMonth: Date
): MaterializedExpenseDraft[] {
  return occurrencesInMonth(recurring, targetMonth).map((date) => ({
    recurringExpenseId: recurring.id,
    categoryId: recurring.categoryId,
    label: recurring.label,
    amount: recurring.amount,
    date,
    paidByMemberId: recurring.paidByMemberId,
    splitRule: recurring.splitRule,
    occurrenceDate: date,
  }));
}

/** Human-readable cadence, e.g. "Every 2 weeks on Tuesday" or "Monthly on the 31st". */
export function describeRecurrence(rule: Pick<RecurringExpenseInput, "frequency" | "interval" | "dayOfMonth" | "dayOfWeek" | "startMonth">): string {
  const n = Math.max(1, rule.interval);
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  if (rule.frequency === "WEEKLY") {
    const day = rule.dayOfWeek === null ? "" : ` on ${WEEKDAYS[rule.dayOfWeek]}`;
    return n === 1 ? `Weekly${day}` : `Every ${n} weeks${day}`;
  }

  const day = rule.dayOfMonth ?? 1;
  const dayLabel = `the ${day}${ordinalSuffix(day)}`;
  const clampNote = day > 28 ? " (last day in shorter months)" : "";

  if (rule.frequency === "MONTHLY") {
    return `${n === 1 ? "Monthly" : `Every ${n} months`} on ${dayLabel}${clampNote}`;
  }
  if (rule.frequency === "QUARTERLY") {
    const anchor = MONTHS[monthStart(rule.startMonth).getUTCMonth()];
    return `${n === 1 ? "Quarterly" : `Every ${n * 3} months`} on ${dayLabel}, from ${anchor}${clampNote}`;
  }
  const anchor = MONTHS[monthStart(rule.startMonth).getUTCMonth()];
  return `${n === 1 ? "Yearly" : `Every ${n} years`} in ${anchor} on ${dayLabel}${clampNote}`;
}

function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  if (n % 10 === 1) return "st";
  if (n % 10 === 2) return "nd";
  if (n % 10 === 3) return "rd";
  return "th";
}
