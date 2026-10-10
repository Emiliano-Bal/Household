import { describe, expect, it } from "vitest";
import { describeBalance, formatCents, formatPercent, fromDecimal, toDecimal } from "./money";

describe("formatCents", () => {
  it("formats 31000 cents as es-ES EUR: '310,00 €'", () => {
    // Narrow no-break space between the number and the symbol is what
    // real es-ES ICU data produces — normalize all whitespace before
    // comparing so this doesn't depend on which exact space character
    // the runtime's ICU data uses.
    expect(formatCents(31000).replace(/\s/g, " ")).toBe("310,00 €");
  });

  it("uses a comma decimal separator and a period thousands separator, es-ES style", () => {
    expect(formatCents(123456789).replace(/\s/g, " ")).toBe("1.234.567,89 €");
  });

  it("defaults to EUR/es-ES with no arguments at all — the app's one fixed format", () => {
    expect(formatCents(100).replace(/\s/g, " ")).toBe("1,00 €");
  });

  it("still supports an explicit currency/locale override for anything that needs it", () => {
    expect(formatCents(31000, "USD", "en-US")).toBe("$310.00");
  });

  it("formats zero and negative amounts", () => {
    expect(formatCents(0).replace(/\s/g, " ")).toBe("0,00 €");
    expect(formatCents(-500).replace(/\s/g, " ")).toBe("-5,00 €");
  });
});

describe("formatPercent", () => {
  it("formats an already-0-100-scaled percent as es-ES ('60,0 %' — Spanish typography puts a space before the sign)", () => {
    expect(formatPercent(60).replace(/\s/g, " ")).toBe("60,0 %");
  });

  it("respects a custom fraction-digit count", () => {
    expect(formatPercent(66.666, undefined, 0).replace(/\s/g, " ")).toBe("67 %");
    expect(formatPercent(66.666, undefined, 2).replace(/\s/g, " ")).toBe("66,67 %");
  });
});

describe("describeBalance", () => {
  it("says 'settled' for exactly zero", () => {
    expect(describeBalance(0)).toBe("settled");
  });

  it("says 'owed €X' for a positive balance (this member is a net creditor)", () => {
    expect(describeBalance(17143).replace(/\s/g, " ")).toBe("owed 171,43 €");
  });

  it("says 'owing €X' for a negative balance (this member is a net debtor) — note the amount is un-negated", () => {
    expect(describeBalance(-17143).replace(/\s/g, " ")).toBe("owing 171,43 €");
  });
});

describe("toDecimal / fromDecimal round-trip", () => {
  it("round-trips cents through Decimal without float drift", () => {
    expect(fromDecimal(toDecimal(31000))).toBe(31000);
    expect(toDecimal(31000).toNumber()).toBe(310);
  });
});
