/**
 * Pad comma-separated fields so columns line up across rows.
 *
 * @param {string[][]} rows
 * @param {string} [separator=", "]
 * @returns {string[]}
 */
export function joinAligned(rows, separator = ", ") {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  /** @type {number[]} */
  const widths = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    row.forEach((cell, i) => {
      const len = String(cell ?? "").length;
      if (widths[i] === undefined || len > widths[i]) widths[i] = len;
    });
  }

  const lastIndex = widths.length - 1;

  return rows.map((row) => {
    if (!Array.isArray(row) || row.length === 0) return "";
    return row
      .map((cell, i) => {
        const text = String(cell ?? "");
        // Trailing pad on the last field is unnecessary (no following comma).
        if (i >= lastIndex) return text;
        return text.padEnd(widths[i] ?? 0, " ");
      })
      .join(separator);
  });
}

/**
 * Join row fields, optionally aligning columns.
 * @param {string[][]} rows
 * @param {{ align?: boolean, separator?: string }} [opts]
 * @returns {string[]}
 */
export function joinRows(rows, { align = false, separator = ", " } = {}) {
  if (align) return joinAligned(rows, separator);
  return (rows ?? []).map((row) =>
    Array.isArray(row) ? row.map((cell) => String(cell ?? "")).join(separator) : ""
  );
}
