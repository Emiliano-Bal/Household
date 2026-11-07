import { describe, it, expect } from "vitest";
import { parseAmount, parseQuickExpense, amountErrorMessage } from "./parse";

const cents = (input: string) => {
  const result = parseAmount(input);
  if (!result.ok) throw new Error(`expected "${input}" to parse, got ${result.reason}`);
  return result.cents;
};
const reason = (input: string) => {
  const result = parseAmount(input);
  if (result.ok) throw new Error(`expected "${input}" to be rejected, got ${result.cents}`);
  return result.reason;
};

describe("parseAmount", () => {
  it("accepts both the Spanish comma and the English dot", () => {
    expect(cents("45,20")).toBe(4520);
    expect(cents("45.20")).toBe(4520);
  });

  it("accepts whole numbers and pads the cents", () => {
    expect(cents("45")).toBe(4500);
    expect(cents("7")).toBe(700);
    expect(cents("45,5")).toBe(4550);
    expect(cents("45.5")).toBe(4550);
  });

  it("tolerates whitespace and a currency sign in any of the usual places", () => {
    expect(cents("  45,20  ")).toBe(4520);
    expect(cents("45,20 €")).toBe(4520);
    expect(cents("€45,20")).toBe(4520);
    expect(cents("45,20€")).toBe(4520);
    expect(cents("45,20 EUR")).toBe(4520);
  });

  it("does not lose a cent to floating point", () => {
    // 19.99 * 100 is 1998.9999999999998 in binary floating point; the
    // parser builds from the digits instead.
    expect(cents("19,99")).toBe(1999);
    expect(cents("0,07")).toBe(7);
    expect(cents("8,29")).toBe(829);
    expect(cents("1234,56")).toBe(123456);
    for (let c = 1; c <= 200; c++) {
      const text = `${Math.floor(c / 100)},${String(c % 100).padStart(2, "0")}`;
      expect(cents(text)).toBe(c);
    }
  });

  it("reads unambiguous thousands separators", () => {
    expect(cents("1.234,56")).toBe(123456);
    expect(cents("1,234.56")).toBe(123456);
    expect(cents("123.456,78")).toBe(12345678);
    expect(cents("123,456.78")).toBe(12345678);
  });

  it("treats a repeated separator as grouping", () => {
    // Seven digits is the shortest number that can carry two grouping
    // separators, which lands exactly on the cap — handy, since it
    // exercises the grouping path and the boundary at once.
    expect(cents("1.000.000")).toBe(100000000);
    // Past the cap it is refused for being too large, not misparsed.
    expect(reason("1.234.567")).toBe("too-large");
  });

  it("refuses a single separator with exactly three decimals instead of guessing", () => {
    // "1.234" is grouping far more often than a milli-euro, but guessing
    // either way is wrong by 1000x, so it asks again.
    expect(reason("1.234")).toBe("too-precise");
    expect(reason("1,234")).toBe("too-precise");
  });

  it("rejects more than two decimals", () => {
    expect(reason("45,2012")).toBe("too-precise");
  });

  it("rejects zero, negatives and non-numbers", () => {
    expect(reason("0")).toBe("negative");
    expect(reason("0,00")).toBe("negative");
    expect(reason("-5")).toBe("negative");
    expect(reason("abc")).toBe("not-a-number");
    expect(reason("45,20 pizza")).toBe("not-a-number");
    expect(reason("")).toBe("empty");
    expect(reason("   ")).toBe("empty");
    expect(reason(",")).toBe("not-a-number");
  });

  it("rejects an implausibly large amount", () => {
    expect(reason("99999999")).toBe("too-large");
    // Right on the limit is still fine.
    expect(cents("1000000")).toBe(100000000);
  });

  it("has a Spanish message for every rejection reason", () => {
    for (const r of ["empty", "not-a-number", "negative", "too-large", "too-precise"] as const) {
      expect(amountErrorMessage(r).length).toBeGreaterThan(10);
    }
  });
});

describe("parseQuickExpense", () => {
  it("splits a leading amount from the title", () => {
    expect(parseQuickExpense("45,20 Mercadona supermercado")).toEqual({
      cents: 4520,
      title: "Mercadona supermercado",
    });
  });

  it("handles the dot form and a currency sign", () => {
    expect(parseQuickExpense("12.50 Café")).toEqual({ cents: 1250, title: "Café" });
    expect(parseQuickExpense("12,50 € Café")).toEqual({ cents: 1250, title: "Café" });
    expect(parseQuickExpense("€12,50 Café")).toEqual({ cents: 1250, title: "Café" });
  });

  it("collapses runs of whitespace in the title", () => {
    expect(parseQuickExpense("30   Cena    con   Marta")).toEqual({ cents: 3000, title: "Cena con Marta" });
  });

  it("keeps digits that belong to the title", () => {
    expect(parseQuickExpense("45,20 Gasolina 95")).toEqual({ cents: 4520, title: "Gasolina 95" });
    expect(parseQuickExpense("18 Cena 2 personas")).toEqual({ cents: 1800, title: "Cena 2 personas" });
  });

  it("returns null when there is no leading amount, so the caller treats it as a title", () => {
    expect(parseQuickExpense("Mercadona")).toBeNull();
    // Trailing amounts are deliberately not parsed: "Cena 2 personas"
    // would otherwise become a 2 € dinner.
    expect(parseQuickExpense("Mercadona 45,20")).toBeNull();
    expect(parseQuickExpense("Cena 2 personas")).toBeNull();
  });

  it("returns null for an amount-only message", () => {
    // No title, so the flow should ask for one rather than invent it.
    expect(parseQuickExpense("45,20")).toBeNull();
    expect(parseQuickExpense("45,20 ")).toBeNull();
  });

  it("returns null when the leading number is not a valid amount", () => {
    expect(parseQuickExpense("0 Mercadona")).toBeNull();
    expect(parseQuickExpense("1.234 Mercadona")).toBeNull();
    expect(parseQuickExpense("45,2012 Mercadona")).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(parseQuickExpense("")).toBeNull();
    expect(parseQuickExpense("   ")).toBeNull();
  });
});
