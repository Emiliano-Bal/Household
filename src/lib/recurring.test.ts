import { describe, it, expect } from "vitest";
import {
  occurrencesInMonth,
  nextOccurrence,
  materializeRecurringExpenses,
  recurringExpensesDueForMonth,
  clampDayToMonth,
  describeRecurrence,
  type RecurringExpenseInput,
  type RecurrenceFrequency,
} from "./recurring";

const M = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1));
const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const iso = (d: Date) => d.toISOString().slice(0, 10);

function rule(over: Partial<RecurringExpenseInput> & { frequency: RecurrenceFrequency }): RecurringExpenseInput {
  return {
    id: "r1",
    categoryId: "c1",
    label: "Rent",
    amount: 100000,
    interval: 1,
    dayOfMonth: null,
    dayOfWeek: null,
    startMonth: M(2026, 1),
    endMonth: null,
    paidByMemberId: "m1",
    splitRule: { type: "EQUAL" },
    active: true,
    ...over,
  };
}

describe("clampDayToMonth", () => {
  it("clamps a day past the end of the month onto its last day", () => {
    expect(clampDayToMonth(31, M(2026, 2))).toBe(28); // 2026 is not a leap year
    expect(clampDayToMonth(31, M(2024, 2))).toBe(29); // 2024 is
    expect(clampDayToMonth(31, M(2026, 4))).toBe(30);
    expect(clampDayToMonth(31, M(2026, 1))).toBe(31);
  });

  it("floors at the 1st", () => {
    expect(clampDayToMonth(0, M(2026, 3))).toBe(1);
    expect(clampDayToMonth(-5, M(2026, 3))).toBe(1);
  });
});

describe("MONTHLY", () => {
  const monthly = rule({ frequency: "MONTHLY", dayOfMonth: 15 });

  it("fires once a month on the given day", () => {
    expect(occurrencesInMonth(monthly, M(2026, 3)).map(iso)).toEqual(["2026-03-15"]);
  });

  it("a 31st rule posts on the last day of February instead of being skipped", () => {
    const rent = rule({ frequency: "MONTHLY", dayOfMonth: 31 });
    expect(occurrencesInMonth(rent, M(2026, 2)).map(iso)).toEqual(["2026-02-28"]);
    // Leap year needs its own rule: the shared one starts in 2026, so
    // Feb 2024 is correctly before its start month.
    const since2024 = rule({ frequency: "MONTHLY", dayOfMonth: 31, startMonth: M(2024, 1) });
    expect(occurrencesInMonth(since2024, M(2024, 2)).map(iso)).toEqual(["2024-02-29"]);
    // And still the 31st where the month has one.
    expect(occurrencesInMonth(rent, M(2026, 3)).map(iso)).toEqual(["2026-03-31"]);
    // Clamping never spills into the next month.
    expect(occurrencesInMonth(rent, M(2026, 4)).map(iso)).toEqual(["2026-04-30"]);
  });

  it("honours an interval of every N months, anchored on the start month", () => {
    const everyOther = rule({ frequency: "MONTHLY", dayOfMonth: 1, interval: 2, startMonth: M(2026, 1) });
    expect(occurrencesInMonth(everyOther, M(2026, 1))).toHaveLength(1);
    expect(occurrencesInMonth(everyOther, M(2026, 2))).toHaveLength(0);
    expect(occurrencesInMonth(everyOther, M(2026, 3))).toHaveLength(1);
    expect(occurrencesInMonth(everyOther, M(2026, 4))).toHaveLength(0);
  });

  it("does not fire before the start month or after the end month", () => {
    const bounded = rule({ frequency: "MONTHLY", dayOfMonth: 5, startMonth: M(2026, 3), endMonth: M(2026, 5) });
    expect(occurrencesInMonth(bounded, M(2026, 2))).toHaveLength(0);
    expect(occurrencesInMonth(bounded, M(2026, 3))).toHaveLength(1);
    expect(occurrencesInMonth(bounded, M(2026, 5))).toHaveLength(1); // endMonth inclusive
    expect(occurrencesInMonth(bounded, M(2026, 6))).toHaveLength(0);
  });

  it("produces nothing while inactive", () => {
    expect(occurrencesInMonth(rule({ frequency: "MONTHLY", dayOfMonth: 5, active: false }), M(2026, 3))).toHaveLength(0);
  });
});

describe("WEEKLY", () => {
  // 2026-03-01 is a Sunday, so Mondays are the 2nd, 9th, 16th, 23rd, 30th.
  const mondays = rule({ frequency: "WEEKLY", dayOfWeek: 1, startMonth: M(2026, 1) });

  it("returns every matching weekday in the month", () => {
    expect(occurrencesInMonth(mondays, M(2026, 3)).map(iso)).toEqual([
      "2026-03-02",
      "2026-03-09",
      "2026-03-16",
      "2026-03-23",
      "2026-03-30",
    ]);
  });

  it("gives four occurrences in a month that only has four", () => {
    // February 2026 starts on a Sunday and has 28 days: Mondays are 2,9,16,23.
    expect(occurrencesInMonth(mondays, M(2026, 2)).map(iso)).toEqual([
      "2026-02-02",
      "2026-02-09",
      "2026-02-16",
      "2026-02-23",
    ]);
  });

  it("keeps a fortnightly cadence across month boundaries instead of restarting", () => {
    const fortnightly = rule({ frequency: "WEEKLY", dayOfWeek: 1, interval: 2, startMonth: M(2026, 1) });
    // Anchor is the first Monday on/after 2026-01-01 (Thursday) = 2026-01-05.
    const jan = occurrencesInMonth(fortnightly, M(2026, 1)).map(iso);
    const feb = occurrencesInMonth(fortnightly, M(2026, 2)).map(iso);
    expect(jan).toEqual(["2026-01-05", "2026-01-19"]);
    // 14 days after 2026-01-19 is 2026-02-02 — the cadence carries over
    // rather than resetting to the first Monday of February.
    expect(feb[0]).toBe("2026-02-02");
    // Every gap is exactly 14 days.
    const all = [...jan, ...feb].map((d) => new Date(d).getTime());
    for (let i = 1; i < all.length; i++) {
      expect((all[i] - all[i - 1]) / 86_400_000).toBe(14);
    }
  });

  it("produces nothing when no weekday is set", () => {
    expect(occurrencesInMonth(rule({ frequency: "WEEKLY", dayOfWeek: null }), M(2026, 3))).toHaveLength(0);
  });

  it("does not fire in months before the start month", () => {
    const fromMarch = rule({ frequency: "WEEKLY", dayOfWeek: 1, startMonth: M(2026, 3) });
    expect(occurrencesInMonth(fromMarch, M(2026, 2))).toHaveLength(0);
    expect(occurrencesInMonth(fromMarch, M(2026, 3)).length).toBeGreaterThan(0);
  });
});

describe("QUARTERLY", () => {
  const quarterly = rule({ frequency: "QUARTERLY", dayOfMonth: 10, startMonth: M(2026, 2) });

  it("fires every third month from its start month", () => {
    for (const m of [2, 5, 8, 11]) {
      expect(occurrencesInMonth(quarterly, M(2026, m)).map(iso)).toEqual([`2026-${String(m).padStart(2, "0")}-10`]);
    }
    for (const m of [1, 3, 4, 6, 7, 9, 10, 12]) {
      expect(occurrencesInMonth(quarterly, M(2026, m))).toHaveLength(0);
    }
  });

  it("carries the cadence into the following year", () => {
    expect(occurrencesInMonth(quarterly, M(2027, 2)).map(iso)).toEqual(["2027-02-10"]);
    expect(occurrencesInMonth(quarterly, M(2027, 3))).toHaveLength(0);
  });

  it("clamps a 31st quarterly onto a short month", () => {
    const q = rule({ frequency: "QUARTERLY", dayOfMonth: 31, startMonth: M(2026, 2) });
    expect(occurrencesInMonth(q, M(2026, 2)).map(iso)).toEqual(["2026-02-28"]);
  });
});

describe("YEARLY", () => {
  const yearly = rule({ frequency: "YEARLY", dayOfMonth: 20, startMonth: M(2026, 6) });

  it("fires once a year in its start month", () => {
    expect(occurrencesInMonth(yearly, M(2026, 6)).map(iso)).toEqual(["2026-06-20"]);
    expect(occurrencesInMonth(yearly, M(2027, 6)).map(iso)).toEqual(["2027-06-20"]);
    expect(occurrencesInMonth(yearly, M(2026, 7))).toHaveLength(0);
    expect(occurrencesInMonth(yearly, M(2027, 5))).toHaveLength(0);
  });

  it("honours an interval of every N years", () => {
    const biennial = rule({ frequency: "YEARLY", dayOfMonth: 20, interval: 2, startMonth: M(2026, 6) });
    expect(occurrencesInMonth(biennial, M(2026, 6))).toHaveLength(1);
    expect(occurrencesInMonth(biennial, M(2027, 6))).toHaveLength(0);
    expect(occurrencesInMonth(biennial, M(2028, 6))).toHaveLength(1);
  });
});

describe("nextOccurrence", () => {
  it("finds the next date for a monthly rule", () => {
    const monthly = rule({ frequency: "MONTHLY", dayOfMonth: 15 });
    expect(iso(nextOccurrence(monthly, D(2026, 3, 1))!)).toBe("2026-03-15");
    // On the day itself still counts as next.
    expect(iso(nextOccurrence(monthly, D(2026, 3, 15))!)).toBe("2026-03-15");
    // Past it, roll to the following month.
    expect(iso(nextOccurrence(monthly, D(2026, 3, 16))!)).toBe("2026-04-15");
  });

  it("finds the next weekly date", () => {
    const mondays = rule({ frequency: "WEEKLY", dayOfWeek: 1, startMonth: M(2026, 1) });
    expect(iso(nextOccurrence(mondays, D(2026, 3, 3))!)).toBe("2026-03-09");
  });

  it("skips off-months for a quarterly rule", () => {
    const quarterly = rule({ frequency: "QUARTERLY", dayOfMonth: 10, startMonth: M(2026, 2) });
    expect(iso(nextOccurrence(quarterly, D(2026, 3, 1))!)).toBe("2026-05-10");
  });

  it("returns null once the rule has ended or been deactivated", () => {
    const ended = rule({ frequency: "MONTHLY", dayOfMonth: 5, endMonth: M(2026, 2) });
    expect(nextOccurrence(ended, D(2026, 3, 1))).toBeNull();
    expect(nextOccurrence(rule({ frequency: "MONTHLY", dayOfMonth: 5, active: false }), D(2026, 1, 1))).toBeNull();
  });

  it("does not hang on a rule that can never fire", () => {
    const impossible = rule({ frequency: "WEEKLY", dayOfWeek: null });
    expect(nextOccurrence(impossible, D(2026, 1, 1))).toBeNull();
  });

  it("looks forward to a rule that starts in the future", () => {
    const future = rule({ frequency: "YEARLY", dayOfMonth: 1, startMonth: M(2030, 4) });
    expect(iso(nextOccurrence(future, D(2026, 1, 1))!)).toBe("2030-04-01");
  });
});

describe("materializeRecurringExpenses", () => {
  it("produces one draft per occurrence, keyed on the date", () => {
    const mondays = rule({ frequency: "WEEKLY", dayOfWeek: 1, startMonth: M(2026, 1) });
    const drafts = materializeRecurringExpenses(mondays, M(2026, 3));

    expect(drafts).toHaveLength(5);
    // The idempotency key is the occurrence date, so the five are distinct.
    expect(new Set(drafts.map((d) => d.occurrenceDate.getTime())).size).toBe(5);
    for (const d of drafts) {
      expect(d.occurrenceDate.getTime()).toBe(d.date.getTime());
      expect(d.recurringExpenseId).toBe("r1");
      expect(d.amount).toBe(100000);
    }
  });

  it("produces nothing in a month the rule does not fire in", () => {
    const quarterly = rule({ frequency: "QUARTERLY", dayOfMonth: 10, startMonth: M(2026, 2) });
    expect(materializeRecurringExpenses(quarterly, M(2026, 3))).toHaveLength(0);
  });
});

describe("recurringExpensesDueForMonth", () => {
  it("keeps only rules with at least one occurrence that month", () => {
    const monthly = { ...rule({ frequency: "MONTHLY", dayOfMonth: 1 }), id: "monthly" };
    const quarterly = { ...rule({ frequency: "QUARTERLY", dayOfMonth: 1, startMonth: M(2026, 2) }), id: "quarterly" };
    const inactive = { ...rule({ frequency: "MONTHLY", dayOfMonth: 1, active: false }), id: "inactive" };

    const due = recurringExpensesDueForMonth([monthly, quarterly, inactive], M(2026, 3));
    expect(due.map((r) => r.id)).toEqual(["monthly"]);
  });
});

describe("describeRecurrence", () => {
  it("reads naturally for each frequency", () => {
    expect(describeRecurrence({ frequency: "WEEKLY", interval: 1, dayOfMonth: null, dayOfWeek: 2, startMonth: M(2026, 1) })).toBe(
      "Weekly on Tuesday"
    );
    expect(describeRecurrence({ frequency: "WEEKLY", interval: 2, dayOfMonth: null, dayOfWeek: 1, startMonth: M(2026, 1) })).toBe(
      "Every 2 weeks on Monday"
    );
    expect(describeRecurrence({ frequency: "MONTHLY", interval: 1, dayOfMonth: 1, dayOfWeek: null, startMonth: M(2026, 1) })).toBe(
      "Monthly on the 1st"
    );
    expect(describeRecurrence({ frequency: "QUARTERLY", interval: 1, dayOfMonth: 10, dayOfWeek: null, startMonth: M(2026, 2) })).toBe(
      "Quarterly on the 10th, from February"
    );
    expect(describeRecurrence({ frequency: "YEARLY", interval: 1, dayOfMonth: 3, dayOfWeek: null, startMonth: M(2026, 6) })).toBe(
      "Yearly in June on the 3rd"
    );
  });

  it("flags a day that will be clamped in short months", () => {
    expect(describeRecurrence({ frequency: "MONTHLY", interval: 1, dayOfMonth: 31, dayOfWeek: null, startMonth: M(2026, 1) })).toBe(
      "Monthly on the 31st (last day in shorter months)"
    );
  });
});
