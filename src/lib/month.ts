/**
 * Months are always represented as a Date normalized to the 1st of the
 * month at UTC midnight, so comparisons/range queries are plain Date
 * comparisons instead of ad-hoc "YYYY-MM" string parsing.
 */
export function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function monthKey(date: Date): string {
  const d = monthStart(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function addMonths(date: Date, delta: number): Date {
  const d = monthStart(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1));
}

export function isSameMonth(a: Date, b: Date): boolean {
  return monthStart(a).getTime() === monthStart(b).getTime();
}

export function daysInMonth(month: Date): number {
  const d = monthStart(month);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}
