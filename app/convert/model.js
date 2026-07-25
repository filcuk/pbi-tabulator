/**
 * Canonical table model shared by tabular input and DAX/M converters.
 *
 * Shape matches tabular-input getData():
 *   { columns: [{ id, label, type }], rows: [{ id, cells }] }
 * Types: text | number | logical
 * Optional outputType: exact DAX/M type used when generating (see output-types.js).
 */

import {
  coerceCellValue,
  parseColumnType,
  defaultValueForType,
} from "../components/tabular-input.js";

/** @typedef {"text" | "number" | "logical"} ColumnType */
/** @typedef {{ id: string, label: string, type: ColumnType, outputType?: string }} Column */
/** @typedef {{ id: string, cells: Record<string, string | number | boolean | null> }} Row */
/** @typedef {{ columns: Column[], rows: Row[] }} TableModel */

/** @typedef {"tabular" | "dax" | "m"} ConvertLang */
/** @typedef {"datatable" | "constructor" | "union-row"} DaxDialect */
/** @typedef {"table" | "from-records" | "binary-from-text"} MDialect */

export const DAX_DIALECTS = /** @type {const} */ ([
  "datatable",
  "constructor",
  "union-row",
]);

export const M_DIALECTS = /** @type {const} */ ([
  "table",
  "from-records",
  "binary-from-text",
]);

export class ConvertError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "ConvertError";
  }
}

let idCounter = 0;

/** @returns {string} */
export function nextId(prefix = "id") {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Reset id counter (tests). */
export function resetIdCounter() {
  idCounter = 0;
}

/**
 * @param {string} label
 * @param {number} index
 */
export function columnIdFromLabel(label, index) {
  const slug = String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || `col-${index + 1}`;
}

/**
 * @param {string} type
 * @returns {ColumnType}
 */
export function mapDaxTypeToColumn(type) {
  const t = String(type ?? "")
    .trim()
    .toUpperCase();
  if (t === "BOOLEAN" || t === "LOGICAL") return "logical";
  if (
    t === "INTEGER" ||
    t === "DOUBLE" ||
    t === "DECIMAL" ||
    t === "CURRENCY" ||
    t === "INT64" ||
    t === "NUMBER"
  ) {
    return "number";
  }
  // STRING, DATETIME, and unknowns → text
  return "text";
}

/**
 * @param {ColumnType} type
 * @returns {"STRING" | "DOUBLE" | "BOOLEAN"}
 */
export function mapColumnTypeToDax(type) {
  const t = parseColumnType(type);
  if (t === "logical") return "BOOLEAN";
  if (t === "number") return "DOUBLE";
  return "STRING";
}

/**
 * @param {string} type
 * @returns {ColumnType}
 */
export function mapMTypeToColumn(type) {
  const t = String(type ?? "")
    .trim()
    .toLowerCase()
    .replace(/^type\s+/, "");
  if (
    t === "logical" ||
    t === "nullable logical" ||
    t.endsWith(".logical") ||
    t === "true/false"
  ) {
    return "logical";
  }
  if (
    t === "number" ||
    t === "nullable number" ||
    t === "int64.type" ||
    t === "int32.type" ||
    t === "double.type" ||
    t === "decimal.type" ||
    t === "currency.type" ||
    t.includes("number") ||
    t.includes("int64") ||
    t.includes("double") ||
    t.includes("decimal")
  ) {
    return "number";
  }
  return "text";
}

/**
 * @param {ColumnType} type
 * @returns {string}
 */
export function mapColumnTypeToM(type) {
  const t = parseColumnType(type);
  if (t === "logical") return "logical";
  if (t === "number") return "number";
  return "text";
}

/**
 * @param {Partial<TableModel> | null | undefined} data
 * @returns {TableModel}
 */
export function normalizeTable(data) {
  const rawColumns = Array.isArray(data?.columns) ? data.columns : [];
  const usedIds = new Set();

  const columns = rawColumns.map((col, index) => {
    const label =
      String(col?.label ?? "").trim() || `Column ${index + 1}`;
    let id = String(col?.id ?? "").trim() || columnIdFromLabel(label, index);
    if (usedIds.has(id)) {
      id = `${id}-${index + 1}`;
    }
    usedIds.add(id);
    const outputType =
      col?.outputType !== undefined && col?.outputType !== null
        ? String(col.outputType).trim()
        : "";
    return {
      id,
      label,
      type: parseColumnType(col?.type),
      ...(outputType ? { outputType } : {}),
    };
  });

  const rawRows = Array.isArray(data?.rows) ? data.rows : [];
  const rows = rawRows.map((row, rowIndex) => {
    const id = String(row?.id ?? "").trim() || nextId(`row-${rowIndex + 1}`);
    /** @type {Record<string, string | number | boolean | null>} */
    const cells = {};
    for (const col of columns) {
      const raw = row?.cells?.[col.id];
      cells[col.id] =
        raw === undefined ? defaultValueForType(col.type) : coerceCellValue(raw, col.type);
    }
    return { id, cells };
  });

  return { columns, rows };
}

/**
 * @param {TableModel} table
 * @returns {TableModel}
 */
export function cloneTable(table) {
  return {
    columns: table.columns.map((c) => ({ ...c })),
    rows: table.rows.map((r) => ({
      id: r.id,
      cells: { ...r.cells },
    })),
  };
}

/**
 * @param {{ columnCount?: number, rowCount?: number }} [opts]
 * @returns {TableModel}
 */
export function createEmptyTable({ columnCount = 2, rowCount = 2 } = {}) {
  const cols = Math.max(0, columnCount | 0);
  const rowsN = Math.max(0, rowCount | 0);
  const columns = Array.from({ length: cols }, (_, i) => ({
    id: `col-${i + 1}`,
    label: `Column ${i + 1}`,
    type: /** @type {ColumnType} */ ("text"),
  }));
  const rows = Array.from({ length: rowsN }, (_, i) => {
    /** @type {Record<string, string | number | boolean | null>} */
    const cells = {};
    for (const col of columns) cells[col.id] = defaultValueForType(col.type);
    return { id: `row-${i + 1}`, cells };
  });
  return { columns, rows };
}

/**
 * Compare two tables ignoring row/column ids (labels, types, cell values).
 * @param {TableModel} a
 * @param {TableModel} b
 */
export function tablesEqualByContent(a, b) {
  const left = normalizeTable(a);
  const right = normalizeTable(b);
  if (left.columns.length !== right.columns.length) return false;
  if (left.rows.length !== right.rows.length) return false;
  for (let i = 0; i < left.columns.length; i += 1) {
    if (left.columns[i].label !== right.columns[i].label) return false;
    if (left.columns[i].type !== right.columns[i].type) return false;
  }
  for (let r = 0; r < left.rows.length; r += 1) {
    for (let c = 0; c < left.columns.length; c += 1) {
      const lid = left.columns[c].id;
      const rid = right.columns[c].id;
      if (left.rows[r].cells[lid] !== right.rows[r].cells[rid]) return false;
    }
  }
  return true;
}
