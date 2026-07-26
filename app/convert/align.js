/**
 * Pad comma-separated fields so columns line up across rows.
 *
 * @param {string[][]} rows
 * @param {string} [separator=", "]
 * @param {{ padLast?: boolean }} [opts]
 * @returns {string[]}
 */
export function joinAligned(rows, separator = ", ", { padLast = false } = {}) {
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
        // Skip trailing pad on the last field unless callers wrap each line
        // (e.g. `{ … }`) and need end brackets to line up.
        if (!padLast && i >= lastIndex) return text;
        return text.padEnd(widths[i] ?? 0, " ");
      })
      .join(separator);
  });
}

/**
 * Join row fields, optionally aligning columns.
 * @param {string[][]} rows
 * @param {{ align?: boolean, separator?: string, padLast?: boolean }} [opts]
 * @returns {string[]}
 */
export function joinRows(
  rows,
  { align = false, separator = ", ", padLast = false } = {}
) {
  if (align) return joinAligned(rows, separator, { padLast });
  return (rows ?? []).map((row) =>
    Array.isArray(row) ? row.map((cell) => String(cell ?? "")).join(separator) : ""
  );
}
