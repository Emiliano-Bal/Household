/**
 * Parsing for bot input. Pure — no database, no Telegram, no I/O — so
 * the fiddly cases can be pinned down in unit tests rather than probed
 * through a chat window.
 *
 * Amounts are integer cents everywhere in this app (see src/lib/money.ts),
 * so that is what these return.
 */

/** The largest amount accepted: 1,000,000.00 €. Above this it is a typo, not a grocery run. */
const MAX_CENTS = 100_000_000;

export type ParsedAmount =
  | { ok: true; cents: number }
  | { ok: false; reason: "empty" | "not-a-number" | "negative" | "too-large" | "too-precise" };

/**
 * Reads a user-typed amount into cents.
 *
 * Accepts both the Spanish "45,20" and the English "45.20", because
 * people type both on a phone keyboard regardless of locale. Thousands
 * separators are accepted only where they are unambiguous: "1.234,56" and
 * "1,234.56" both parse, but a bare "1.234" is read as 1.234 → rejected
 * for being too precise rather than silently becoming 1234,00 €. Guessing
 * there is a factor-of-1000 error waiting to happen.
 */
export function parseAmount(input: string): ParsedAmount {
  const raw = input.trim().replace(/\s|€|EUR/gi, "");
  if (!raw) return { ok: false, reason: "empty" };

  if (raw.startsWith("-")) return { ok: false, reason: "negative" };
  if (!/^[\d.,]+$/.test(raw)) return { ok: false, reason: "not-a-number" };

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");

  let normalized: string;
  if (lastComma === -1 && lastDot === -1) {
    normalized = raw;
  } else if (lastComma > -1 && lastDot > -1) {
    // Both present: the rightmost is the decimal separator and the other
    // is grouping — "1.234,56" and "1,234.56" are both unambiguous.
    const decimalAt = Math.max(lastComma, lastDot);
    const groupingChar = decimalAt === lastComma ? "." : ",";
    normalized = raw
      .split(groupingChar)
      .join("")
      .replace(/[.,]([^.,]*)$/, ".$1");
  } else {
    const sep = lastComma > -1 ? "," : ".";
    const parts = raw.split(sep);
    if (parts.length > 2) {
      // Repeated separator can only be grouping: "1.234.567".
      normalized = parts.join("");
    } else {
      const decimals = parts[1] ?? "";
      // Exactly three digits after a single separator is ambiguous
      // ("1.234"): it is grouping far more often than a milli-euro, but
      // guessing either way can be wrong by 1000x, so refuse instead.
      if (decimals.length === 3) return { ok: false, reason: "too-precise" };
      normalized = `${parts[0]}.${decimals}`;
    }
  }

  if (!/^\d*\.?\d*$/.test(normalized) || normalized === "." || normalized === "") {
    return { ok: false, reason: "not-a-number" };
  }

  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > 2) return { ok: false, reason: "too-precise" };

  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false, reason: "not-a-number" };
  if (value <= 0) return { ok: false, reason: "negative" };

  // Built from the digits rather than Math.round(value * 100): 19.99 * 100
  // is 1998.9999999999998 in binary floating point.
  const cents = Number(whole || "0") * 100 + Number((fraction + "00").slice(0, 2));
  if (cents > MAX_CENTS) return { ok: false, reason: "too-large" };
  if (cents <= 0) return { ok: false, reason: "negative" };

  return { ok: true, cents };
}

export interface QuickExpense {
  cents: number;
  title: string;
}

/**
 * The one-line shortcut: "45,20 Mercadona supermercado" → 4520 and
 * "Mercadona supermercado".
 *
 * The amount must come first. A trailing amount ("Mercadona 45,20") is
 * deliberately not accepted: "Cena 2 personas" would otherwise parse as a
 * 2 € dinner. Leading is unambiguous, and the flow asks for anything
 * missing anyway.
 *
 * Returns null when the message is not in this shape, which the caller
 * reads as "treat it as a plain title".
 */
export function parseQuickExpense(input: string): QuickExpense | null {
  const text = input.trim();
  if (!text) return null;

  // An optional leading currency symbol, then the number, then the rest.
  const match = text.match(/^€?\s*([\d.,]+)\s*(?:€|EUR\b)?\s+(.+)$/i);
  if (!match) return null;

  const amount = parseAmount(match[1]);
  if (!amount.ok) return null;

  const title = match[2].trim().replace(/\s+/g, " ");
  if (!title) return null;

  return { cents: amount.cents, title };
}

/** Human-readable Spanish for why an amount was rejected, for the re-ask. */
export function amountErrorMessage(reason: Exclude<ParsedAmount, { ok: true }>["reason"]): string {
  switch (reason) {
    case "empty":
      return "No he recibido ningún importe. Escribe algo como 45,20.";
    case "not-a-number":
      return "No he entendido ese importe. Escribe solo el número, por ejemplo 45,20.";
    case "negative":
      return "El importe tiene que ser mayor que cero. Por ejemplo: 45,20.";
    case "too-large":
      return "Ese importe es demasiado grande. ¿Seguro que no sobra algún dígito?";
    case "too-precise":
      return "Usa como mucho dos decimales, por ejemplo 45,20. Si querías decir mil, escribe 1234,00.";
  }
}
