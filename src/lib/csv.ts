/**
 * Minimal RFC 4180 CSV writer.
 *
 * Hand-rolled rather than pulled in as a dependency: the whole job is
 * quoting, and the quoting rules below are the entire specification that
 * matters for this data.
 */

/**
 * A field is quoted when it contains a comma, a quote, or a newline;
 * inner quotes are doubled.
 *
 * The leading-character guard is a spreadsheet concern rather than a CSV
 * one: Excel and Sheets treat a cell starting with = + - or @ as a
 * formula, so a label like "=rent" would execute on open. Prefixing a
 * single quote neutralises that without changing what the reader sees.
 */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvField).join(",")];
  for (const row of rows) lines.push(row.map(csvField).join(","));
  // CRLF per the spec, and a trailing newline so the file ends cleanly.
  return lines.join("\r\n") + "\r\n";
}

/** Money is stored in cents; a spreadsheet wants a decimal number, not a string. */
export function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** ISO date (YYYY-MM-DD) in UTC — the same calendar day the app stored. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * A CSV HTTP response. The BOM is deliberate: without it Excel on Windows
 * reads the file as the system codepage and mangles the € sign and any
 * accented member name.
 */
export function csvResponse(filename: string, body: string): Response {
  return new Response("﻿" + body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // A backup download must never be served from a cache.
      "Cache-Control": "no-store",
    },
  });
}
