/**
 * Collect and attach shape/type consistency warnings from DAX/M parsing.
 */

/** @type {WeakMap<object, string[]>} */
const WARNINGS = new WeakMap();

export const WARN_COLUMN_SHAPE =
  "Columns do not match across rows: column names or cell counts differ between rows.";

export const WARN_COLUMN_TYPES =
  "Column types do not match across rows: the same column has different value types in different rows.";

/**
 * @param {import("./model.js").TableModel} table
 * @param {string[]} warnings
 * @returns {import("./model.js").TableModel}
 */
export function attachParseWarnings(table, warnings) {
  const unique = [...new Set(warnings.filter(Boolean))];
  if (unique.length) WARNINGS.set(table, unique);
  return table;
}

/**
 * @param {import("./model.js").TableModel | null | undefined} table
 * @returns {string[]}
 */
export function getParseWarnings(table) {
  if (!table) return [];
  return WARNINGS.get(table) ?? [];
}

/**
 * Canonical cell type for cross-row comparison. Null/blank/empty skipped.
 * @param {unknown} value
 * @returns {"text" | "number" | "logical" | null}
 */
export function inferJsValueType(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return "logical";
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "string") return "text";
  return "text";
}

/**
 * Warnings for list-of-lists rows (DATATABLE, constructor, #table, binary).
 * @param {unknown[][]} rows
 * @param {number} [expectedCount]
 * @returns {string[]}
 */
export function warningsForValueRows(rows, expectedCount) {
  /** @type {string[]} */
  const warnings = [];
  if (rows.length === 0) return warnings;

  const expected =
    expectedCount !== undefined
      ? expectedCount
      : rows[0]?.length ?? 0;

  if (
    rows.some(
      (row) => !Array.isArray(row) || row.length !== expected
    )
  ) {
    warnings.push(WARN_COLUMN_SHAPE);
  }

  const colCount = Math.max(
    expected,
    ...rows.map((row) => (Array.isArray(row) ? row.length : 0))
  );

  if (hasInconsistentColumnTypesByIndex(rows, colCount)) {
    warnings.push(WARN_COLUMN_TYPES);
  }

  return warnings;
}

/**
 * @param {unknown[][]} rows
 * @param {number} colCount
 */
function hasInconsistentColumnTypesByIndex(rows, colCount) {
  for (let index = 0; index < colCount; index += 1) {
    /** @type {Set<string>} */
    const types = new Set();
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const type = inferJsValueType(row[index]);
      if (type) types.add(type);
    }
    if (types.size > 1) return true;
  }
  return false;
}

/**
 * Warnings for named field rows (UNION ROW, FromRecords).
 * @param {{ names: string[], values: unknown[] }[]} rows
 * @returns {string[]}
 */
export function warningsForNamedRows(rows) {
  /** @type {string[]} */
  const warnings = [];
  if (rows.length === 0) return warnings;

  const nameKeys = rows.map((row) => normalizeNameKey(row.names));
  const firstKey = nameKeys[0];
  if (nameKeys.some((key) => key !== firstKey)) {
    warnings.push(WARN_COLUMN_SHAPE);
  }

  /** @type {Map<string, Set<string>>} */
  const typesByName = new Map();
  for (const row of rows) {
    row.names.forEach((name, index) => {
      const type = inferJsValueType(row.values[index]);
      if (!type) return;
      let set = typesByName.get(name);
      if (!set) {
        set = new Set();
        typesByName.set(name, set);
      }
      set.add(type);
    });
  }

  for (const types of typesByName.values()) {
    if (types.size > 1) {
      warnings.push(WARN_COLUMN_TYPES);
      break;
    }
  }

  return warnings;
}

/**
 * Order-independent name signature (count + sorted unique names).
 * Duplicate names in a row still affect length via names.length in callers;
 * here we key on sorted unique set joined with count of names for order-free compare.
 * @param {string[]} names
 */
function normalizeNameKey(names) {
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  return `${names.length}:${sorted.join("\0")}`;
}
