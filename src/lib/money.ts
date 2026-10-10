import Decimal from "decimal.js";

/**
 * Money is stored and passed around as an integer number of minor currency
 * units (cents) everywhere except right at the display boundary. Never do
 * arithmetic on money as a JS float — use Decimal for any math that isn't
 * already integer-cents addition/subtraction.
 */
export type Cents = number;

export function assertInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer number of cents, got ${value}`);
  }
}

export function toDecimal(cents: Cents): Decimal {
  return new Decimal(cents).dividedBy(100);
}

export function fromDecimal(amount: Decimal | number): Cents {
  return new Decimal(amount).times(100).round().toNumber();
}

// The app's one fixed locale/currency: EUR formatted es-ES — "310,00 €",
// comma decimal, symbol after the number. Every display path (components,
// seed console output) must go through this, not a raw toFixed/template
// string, so there is exactly one place that knows what "$310.00" was
// wrong and what "310,00 €" looks like.
const DEFAULT_CURRENCY = "EUR";
const DEFAULT_LOCALE = "es-ES";

export function formatCents(cents: Cents, currency: string = DEFAULT_CURRENCY, locale: string = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

/** A percent value already scaled 0-100 (e.g. 60 for 60%, matching how every caller already computes it) formatted as "60,0%" — es-ES by default, matching formatCents. */
export function formatPercent(percent: number, locale: string = DEFAULT_LOCALE, fractionDigits = 1): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(percent / 100);
}

/**
 * "Settled" / "owed €X" / "owing €X" — the one phrasing for a balance in
 * computeBalances' sign convention (positive = owed to this member,
 * negative = this member owes it). Used on the Dashboard's per-member
 * balances and in the income-edit confirmation dialog's settlement
 * warning, so the two don't drift into different wording for the same
 * number.
 */
export function describeBalance(cents: Cents): string {
  if (cents === 0) return "settled";
  return cents > 0 ? `owed ${formatCents(cents)}` : `owing ${formatCents(-cents)}`;
}
