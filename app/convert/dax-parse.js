/**
 * Parse DAX table expressions into the canonical table model.
 * Supports DATATABLE(), SELECTCOLUMNS+{} / bare {}, and UNION(ROW(...))/ROW(...).
 */

import {
  ConvertError,
  columnIdFromLabel,
  mapDaxTypeToColumn,
  nextId,
  normalizeTable,
} from "./model.js";
import { coerceCellValue } from "../components/tabular-input.js";
import { createScanner, stripDaxWrappers } from "./scan.js";

/**
 * @param {string} text
 * @returns {import("./model.js").TableModel}
 */
export function parseDax(text) {
  const stripped = stripDaxWrappers(text);
  if (!stripped.trim()) {
    throw new ConvertError("DAX input is empty");
  }

  const lower = stripped.toLowerCase();
  if (/\bdatatable\s*\(/.test(lower)) {
    return normalizeTable(parseDatatable(stripped));
  }
  if (/\bunion\s*\(/.test(lower) || /^\s*row\s*\(/i.test(stripped) || /\bfilter\s*\(\s*row\s*\(/i.test(lower)) {
    return normalizeTable(parseUnionRow(stripped));
  }
  if (/\bselectcolumns\s*\(/.test(lower) || /^\s*\{/.test(stripped)) {
    return normalizeTable(parseConstructor(stripped));
  }

  throw new ConvertError(
    "Unrecognized DAX table form. Expected DATATABLE(...), {...} / SELECTCOLUMNS(...), or UNION(ROW(...)) / ROW(...)."
  );
}

/**
 * @param {string} text
 */
function parseDatatable(text) {
  const sc = createScanner(text);
  // find DATATABLE
  skipUntilIdent(sc, "DATATABLE");
  sc.expect("punct", "(");

  /** @type {{ label: string, type: string }[]} */
  const colDefs = [];
  /** @type {unknown[][]} */
  const dataRows = [];

  while (true) {
    const tok = sc.peekToken();
    if (tok.type === "punct" && tok.value === "{") {
      break;
    }
    if (tok.type === "eof") {
      throw new ConvertError("DATATABLE is missing the rows argument");
    }
    const nameTok = sc.next();
    if (nameTok.type !== "string") {
      throw new ConvertError("Expected column name string in DATATABLE");
    }
    sc.skipWs();
    // optional comma already handled by next tokens — expect type ident
    // allow comma between name and type? DATATABLE("A", STRING, ...) — comma after string
    const afterName = sc.peekToken();
    if (afterName.type === "punct" && afterName.value === ",") sc.next();

    const typeTok = sc.next();
    if (typeTok.type !== "ident") {
      throw new ConvertError(`Expected DAX type after column '${nameTok.value}'`);
    }
    colDefs.push({ label: nameTok.value, type: typeTok.value });

    const sep = sc.peekToken();
    if (sep.type === "punct" && sep.value === ",") sc.next();
  }

  const rowsValue = parseNestedList(sc);
  if (!Array.isArray(rowsValue)) {
    throw new ConvertError("DATATABLE rows must be a list");
  }

  for (const row of rowsValue) {
    if (!Array.isArray(row)) {
      throw new ConvertError("Each DATATABLE row must be a list of values");
    }
    dataRows.push(row);
  }

  sc.skipWs();
  const close = sc.peekToken();
  if (close.type === "punct" && close.value === ")") sc.next();

  return buildModel(colDefs, dataRows);
}

/**
 * @param {string} text
 */
function parseConstructor(text) {
  const sc = createScanner(text);
  let columnLabels = /** @type {string[] | null} */ (null);

  if (/^\s*SELECTCOLUMNS\s*\(/i.test(sc.source.slice(sc.position()))) {
    sc.expectIdent("SELECTCOLUMNS");
    sc.expect("punct", "(");
    const tableLit = parseNestedList(sc);
    if (!Array.isArray(tableLit)) {
      throw new ConvertError("SELECTCOLUMNS expects a table constructor");
    }

    // parse "Name", [Value1], ...
    columnLabels = [];
    while (true) {
      const sep = sc.peekToken();
      if (sep.type === "punct" && sep.value === ",") sc.next();
      const next = sc.peekToken();
      if (next.type === "punct" && next.value === ")") {
        sc.next();
        break;
      }
      if (next.type === "eof") break;
      const nameTok = sc.next();
      if (nameTok.type !== "string") {
        throw new ConvertError("Expected column name string in SELECTCOLUMNS");
      }
      columnLabels.push(nameTok.value);
      const comma = sc.peekToken();
      if (comma.type === "punct" && comma.value === ",") sc.next();
      // skip [ValueN] or other expression
      skipSelectcolumnsExpr(sc);
    }

    const rows = tableLit.map((row) => {
      if (Array.isArray(row)) return row;
      throw new ConvertError("Table constructor rows must be value lists");
    });

    const colCount =
      columnLabels.length ||
      rows.reduce((max, r) => Math.max(max, r.length), 0);
    const labels =
      columnLabels.length > 0
        ? columnLabels
        : Array.from({ length: colCount }, (_, i) => `Value${i + 1}`);

    const defs = labels.map((label, index) => ({
      label,
      type: inferDaxTypeFromValues(rows.map((r) => r[index])),
    }));

    return buildModel(defs, rows);
  }

  // bare { ( ... ), ( ... ) }
  const tableLit = parseNestedList(sc);
  if (!Array.isArray(tableLit)) {
    throw new ConvertError("Expected a table constructor {...}");
  }
  const rows = tableLit.map((row) => {
    if (Array.isArray(row)) return row;
    throw new ConvertError("Table constructor rows must be tuples of values");
  });
  const colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
  if (colCount === 0) {
    throw new ConvertError("Empty table constructor has no columns");
  }
  const defs = Array.from({ length: colCount }, (_, i) => ({
    label: `Value${i + 1}`,
    type: inferDaxTypeFromValues(rows.map((r) => r[i])),
  }));
  return buildModel(defs, rows);
}

/**
 * Skip one SELECTCOLUMNS mapping expression ([Value1] or more complex).
 * @param {ReturnType<typeof createScanner>} sc
 */
function skipSelectcolumnsExpr(sc) {
  let depthParen = 0;
  let depthBracket = 0;
  while (!sc.eof()) {
    const tok = sc.peekToken();
    if (tok.type === "eof") break;
    if (tok.type === "punct" && tok.value === "(") {
      depthParen += 1;
      sc.next();
      continue;
    }
    if (tok.type === "punct" && tok.value === ")") {
      if (depthParen === 0 && depthBracket === 0) return;
      depthParen -= 1;
      sc.next();
      continue;
    }
    if (tok.type === "punct" && tok.value === ",") {
      if (depthParen === 0 && depthBracket === 0) return;
      sc.next();
      continue;
    }
    if (tok.type === "bracket-ident") {
      sc.next();
      continue;
    }
    sc.next();
  }
}

/**
 * @param {string} text
 */
function parseUnionRow(text) {
  const sc = createScanner(text);

  // FILTER(ROW(...), FALSE) empty schema
  if (/^\s*FILTER\s*\(/i.test(sc.source.slice(sc.position()))) {
    sc.expectIdent("FILTER");
    sc.expect("punct", "(");
    const rowModel = parseRowCall(sc);
    // skip rest
    return {
      columns: rowModel.columns,
      rows: [],
    };
  }

  if (/^\s*ROW\s*\(/i.test(sc.source.slice(sc.position()))) {
    const one = parseRowCall(sc);
    return one;
  }

  sc.expectIdent("UNION");
  sc.expect("punct", "(");

  /** @type {import("./model.js").TableModel | null} */
  let merged = null;

  while (true) {
    const peek = sc.peekToken();
    if (peek.type === "punct" && peek.value === ")") {
      sc.next();
      break;
    }
    if (peek.type === "punct" && peek.value === ",") {
      sc.next();
      continue;
    }
    if (peek.type === "eof") break;

    if (peek.type === "ident" && peek.value.toLowerCase() === "row") {
      const part = parseRowCall(sc);
      merged = mergeRowTables(merged, part);
      continue;
    }

    // nested UNION
    if (peek.type === "ident" && peek.value.toLowerCase() === "union") {
      const nestedText = readCallExpression(sc);
      const part = parseUnionRow(nestedText);
      merged = mergeRowTables(merged, part);
      continue;
    }

    throw new ConvertError("UNION arguments must be ROW(...) expressions");
  }

  if (!merged) {
    throw new ConvertError("UNION has no ROW arguments");
  }
  return merged;
}

/**
 * Read a function call starting at current position (IDENT(...)).
 * @param {ReturnType<typeof createScanner>} sc
 */
function readCallExpression(sc) {
  const start = sc.position();
  sc.next(); // ident
  sc.expect("punct", "(");
  let depth = 1;
  while (!sc.eof() && depth > 0) {
    const tok = sc.next();
    if (tok.type === "punct" && tok.value === "(") depth += 1;
    if (tok.type === "punct" && tok.value === ")") depth -= 1;
  }
  return sc.source.slice(start, sc.position());
}

/**
 * @param {ReturnType<typeof createScanner>} sc
 */
function parseRowCall(sc) {
  sc.expectIdent("ROW");
  sc.expect("punct", "(");

  /** @type {{ label: string, value: unknown }[]} */
  const pairs = [];

  while (true) {
    const peek = sc.peekToken();
    if (peek.type === "punct" && peek.value === ")") {
      sc.next();
      break;
    }
    if (peek.type === "punct" && peek.value === ",") {
      sc.next();
      continue;
    }
    const nameTok = sc.next();
    if (nameTok.type !== "string") {
      throw new ConvertError("ROW expects alternating column name strings and values");
    }
    const comma = sc.peekToken();
    if (comma.type === "punct" && comma.value === ",") sc.next();
    const value = parseAtom(sc);
    pairs.push({ label: nameTok.value, value });
  }

  const columns = pairs.map((p, index) => ({
    id: columnIdFromLabel(p.label, index),
    label: p.label,
    type: mapDaxTypeToColumn(inferTypeNameFromValue(p.value)),
  }));

  /** @type {Record<string, string | number | boolean | null>} */
  const cells = {};
  pairs.forEach((p, index) => {
    const col = columns[index];
    cells[col.id] = coerceCellValue(literalToJs(p.value), col.type);
  });

  return {
    columns,
    rows: [{ id: nextId("row"), cells }],
  };
}

/**
 * @param {import("./model.js").TableModel | null} base
 * @param {import("./model.js").TableModel} next
 */
function mergeRowTables(base, next) {
  if (!base) return next;
  // align by label order from base
  const columns = base.columns;
  const rows = [
    ...base.rows,
    ...next.rows.map((row) => {
      /** @type {Record<string, string | number | boolean | null>} */
      const cells = {};
      for (const col of columns) {
        const nextCol = next.columns.find((c) => c.label === col.label);
        cells[col.id] = nextCol
          ? coerceCellValue(row.cells[nextCol.id], col.type)
          : coerceCellValue(null, col.type);
      }
      return { id: nextId("row"), cells };
    }),
  ];
  return { columns, rows };
}

/**
 * Parse `{ ... }` / `( ... )` nested lists of atoms into JS arrays.
 * Tuples `(a, b)` and lists `{a, b}` both become arrays.
 * @param {ReturnType<typeof createScanner>} sc
 * @returns {unknown}
 */
function parseNestedList(sc) {
  const tok = sc.next();
  if (tok.type !== "punct" || (tok.value !== "{" && tok.value !== "(")) {
    throw new ConvertError("Expected '{' or '(' to start a list");
  }
  const open = tok.value;
  const close = open === "{" ? "}" : ")";

  /** @type {unknown[]} */
  const items = [];

  while (true) {
    const peek = sc.peekToken();
    if (peek.type === "punct" && peek.value === close) {
      sc.next();
      break;
    }
    if (peek.type === "eof") {
      throw new ConvertError(`Unterminated '${open}' list`);
    }
    if (peek.type === "punct" && peek.value === ",") {
      sc.next();
      continue;
    }
    if (peek.type === "punct" && (peek.value === "{" || peek.value === "(")) {
      items.push(parseNestedList(sc));
      continue;
    }
    items.push(parseAtom(sc));
  }

  return items;
}

/**
 * @param {ReturnType<typeof createScanner>} sc
 * @returns {unknown}
 */
function parseAtom(sc) {
  const tok = sc.peekToken();
  if (tok.type === "string") {
    sc.next();
    return { kind: "string", value: tok.value };
  }
  if (tok.type === "number") {
    sc.next();
    return { kind: "number", value: Number(tok.value) };
  }
  if (tok.type === "ident") {
    sc.next();
    const lower = tok.value.toLowerCase();
    if (lower === "true") return { kind: "boolean", value: true };
    if (lower === "false") return { kind: "boolean", value: false };
    if (lower === "blank") {
      // BLANK()
      const p = sc.peekToken();
      if (p.type === "punct" && p.value === "(") {
        sc.next();
        sc.expect("punct", ")");
      }
      return { kind: "blank", value: null };
    }
    // UNKNOWN ident treated as blank/text
    const p = sc.peekToken();
    if (p.type === "punct" && p.value === "(") {
      // skip function call
      sc.next();
      let depth = 1;
      while (!sc.eof() && depth > 0) {
        const t = sc.next();
        if (t.type === "punct" && t.value === "(") depth += 1;
        if (t.type === "punct" && t.value === ")") depth -= 1;
      }
      return { kind: "blank", value: null };
    }
    return { kind: "string", value: tok.value };
  }
  if (tok.type === "punct" && (tok.value === "{" || tok.value === "(")) {
    return parseNestedList(sc);
  }
  throw new ConvertError(`Unexpected token '${tok.value || tok.type}' in value position`);
}

/** @param {unknown} lit */
function literalToJs(lit) {
  if (lit === null || lit === undefined) return null;
  if (typeof lit !== "object") return lit;
  const obj = /** @type {{ kind?: string, value?: unknown }} */ (lit);
  if (obj.kind === "blank") return null;
  if (obj.kind === "string" || obj.kind === "number" || obj.kind === "boolean") {
    return obj.value;
  }
  return null;
}

/**
 * @param {{ label: string, type: string }[]} colDefs
 * @param {unknown[][]} dataRows
 */
function buildModel(colDefs, dataRows) {
  const columns = colDefs.map((def, index) => ({
    id: columnIdFromLabel(def.label, index),
    label: def.label,
    type: mapDaxTypeToColumn(def.type),
  }));

  const rows = dataRows.map((row) => {
    /** @type {Record<string, string | number | boolean | null>} */
    const cells = {};
    columns.forEach((col, index) => {
      const raw = literalToJs(row[index]);
      cells[col.id] = coerceCellValue(raw, col.type);
    });
    return { id: nextId("row"), cells };
  });

  return { columns, rows };
}

/** @param {unknown[]} values */
function inferDaxTypeFromValues(values) {
  const js = values.map(literalToJs);
  let sawNumber = false;
  let sawLogical = false;
  let sawText = false;
  for (const v of js) {
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "boolean") {
      sawLogical = true;
      continue;
    }
    if (typeof v === "number") {
      sawNumber = true;
      continue;
    }
    sawText = true;
  }
  if (sawText) return "STRING";
  if (sawNumber && !sawLogical) return "DOUBLE";
  if (sawLogical && !sawNumber) return "BOOLEAN";
  if (sawNumber) return "DOUBLE";
  return "STRING";
}

/** @param {unknown} value */
function inferTypeNameFromValue(value) {
  const v = literalToJs(value);
  if (typeof v === "boolean") return "BOOLEAN";
  if (typeof v === "number") return "DOUBLE";
  return "STRING";
}

/**
 * @param {ReturnType<typeof createScanner>} sc
 * @param {string} name
 */
function skipUntilIdent(sc, name) {
  while (!sc.eof()) {
    const tok = sc.peekToken();
    if (tok.type === "ident" && tok.value.toLowerCase() === name.toLowerCase()) {
      sc.next();
      return;
    }
    sc.next();
  }
  throw new ConvertError(`Expected ${name}(...)`);
}
