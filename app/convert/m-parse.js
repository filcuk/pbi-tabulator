/**
 * Parse Power Query M table expressions into the canonical table model.
 * Supports #table, Table.FromRecords, and Binary.FromText Enter Data queries.
 */

import {
  ConvertError,
  columnIdFromLabel,
  mapMTypeToColumn,
  nextId,
  normalizeTable,
} from "./model.js";
import { coerceCellValue } from "../components/tabular-input.js";
import { createScanner } from "./scan.js";
import { decodeJsonDeflateBase64 } from "./binary.js";
import {
  attachParseWarnings,
  warningsForNamedRows,
  warningsForValueRows,
} from "./parse-warnings.js";

/**
 * @param {string} text
 * @returns {Promise<import("./model.js").TableModel>}
 */
export async function parseM(text) {
  const src = String(text ?? "").trim();
  if (!src) throw new ConvertError("M input is empty");

  const lower = src.toLowerCase();

  if (lower.includes("binary.fromtext")) {
    return finishParse(await parseBinaryFromText(src));
  }
  if (/table\.fromrecords\s*\(/i.test(src)) {
    return finishParse(parseFromRecords(src));
  }
  if (/#table\s*\(/.test(lower) || /#\s*table\s*\(/.test(lower)) {
    return finishParse(parseHashTable(src));
  }

  throw new ConvertError(
    "Unrecognized M table form. Expected #table(...), Table.FromRecords(...), or Binary.FromText(...)."
  );
}

/**
 * @param {{ table: import("./model.js").TableModel, warnings: string[] }} result
 */
function finishParse(result) {
  return attachParseWarnings(normalizeTable(result.table), result.warnings);
}

/**
 * @param {string} text
 */
function parseHashTable(text) {
  const sc = createScanner(text, { allowHashIdent: true, bracketIdents: false });
  skipToHashTable(sc);
  sc.expect("punct", "(");

  const columns = parseTypeTable(sc);
  const comma = sc.peekToken();
  if (comma.type === "punct" && comma.value === ",") sc.next();

  const rowsLit = parseMList(sc);
  if (!Array.isArray(rowsLit)) {
    throw new ConvertError("#table rows argument must be a list");
  }

  const rows = rowsLit.map((row) => {
    if (!Array.isArray(row)) {
      throw new ConvertError("Each #table row must be a list of values");
    }
    /** @type {Record<string, string | number | boolean | null>} */
    const cells = {};
    columns.forEach((col, index) => {
      cells[col.id] = coerceCellValue(mLiteralToJs(row[index]), col.type);
    });
    return { id: nextId("row"), cells };
  });

  const jsRows = rowsLit.map((row) =>
    Array.isArray(row) ? row.map(mLiteralToJs) : []
  );

  return {
    table: { columns, rows },
    warnings: warningsForValueRows(jsRows, columns.length),
  };
}

/**
 * @param {string} text
 */
function parseFromRecords(text) {
  const sc = createScanner(text, { allowHashIdent: true, bracketIdents: false });
  findFromRecords(sc);
  sc.expect("punct", "(");

  const list = parseMList(sc);
  if (!Array.isArray(list) || list.length === 0) {
    // empty — try to recover columns from nowhere
    if (Array.isArray(list) && list.length === 0) {
      throw new ConvertError(
        "Table.FromRecords({}) has no rows to infer columns; use #table with a type instead"
      );
    }
    throw new ConvertError("Table.FromRecords expects a list of records");
  }

  /** @type {Map<string, import("./model.js").ColumnType>} */
  const colTypes = new Map();
  /** @type {string[]} */
  const colOrder = [];

  /** @type {Record<string, unknown>[]} */
  const recordRows = [];
  /** @type {{ names: string[], values: unknown[] }[]} */
  const namedRows = [];

  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item) || !("fields" in item)) {
      throw new ConvertError("Table.FromRecords items must be records [...]");
    }
    const fields = /** @type {{ fields: { name: string, value: unknown }[] }} */ (item).fields;
    /** @type {Record<string, unknown>} */
    const rowObj = {};
    /** @type {string[]} */
    const names = [];
    /** @type {unknown[]} */
    const values = [];
    for (const field of fields) {
      if (!colTypes.has(field.name)) {
        colOrder.push(field.name);
        colTypes.set(field.name, inferMType(field.value));
      }
      rowObj[field.name] = field.value;
      names.push(field.name);
      values.push(mLiteralToJs(field.value));
    }
    namedRows.push({ names, values });
    recordRows.push(rowObj);
  }

  const columns = colOrder.map((label, index) => ({
    id: columnIdFromLabel(label, index),
    label,
    type: colTypes.get(label) ?? "text",
  }));

  const rows = recordRows.map((rowObj) => {
    /** @type {Record<string, string | number | boolean | null>} */
    const cells = {};
    for (const col of columns) {
      cells[col.id] = coerceCellValue(mLiteralToJs(rowObj[col.label]), col.type);
    }
    return { id: nextId("row"), cells };
  });

  return {
    table: { columns, rows },
    warnings: warningsForNamedRows(namedRows),
  };
}

/**
 * @param {string} text
 */
async function parseBinaryFromText(text) {
  const match = text.match(
    /Binary\.FromText\s*\(\s*"((?:[^"]|"")*)"\s*,\s*BinaryEncoding\.Base64\s*\)/i
  );
  if (!match) {
    throw new ConvertError(
      "Could not find Binary.FromText(\"...\", BinaryEncoding.Base64) in M input"
    );
  }
  const b64 = match[1].replace(/""/g, '"');
  const json = await decodeJsonDeflateBase64(b64);

  if (!Array.isArray(json)) {
    throw new ConvertError("Binary.FromText JSON payload must be an array of rows");
  }

  // Optional type table from the same query
  const typeCols = tryExtractTypeTable(text);

  /** @type {unknown[][]} */
  const dataRows = json.map((row) => {
    if (Array.isArray(row)) return row;
    if (row && typeof row === "object") {
      // record-like object — use typeCols or keys order
      if (typeCols) {
        return typeCols.map((c) => /** @type {Record<string, unknown>} */ (row)[c.label]);
      }
      return Object.values(row);
    }
    throw new ConvertError("Each JSON row must be an array or object");
  });

  let columns = typeCols;
  if (!columns) {
    const colCount = dataRows.reduce((max, r) => Math.max(max, r.length), 0);
    if (colCount === 0) {
      throw new ConvertError("Binary.FromText payload has no columns");
    }
    columns = Array.from({ length: colCount }, (_, i) => ({
      id: `col-${i + 1}`,
      label: `Column${i + 1}`,
      type: inferMTypeFromValues(dataRows.map((r) => r[i])),
    }));
  }

  const rows = dataRows.map((row) => {
    /** @type {Record<string, string | number | boolean | null>} */
    const cells = {};
    columns.forEach((col, index) => {
      cells[col.id] = coerceCellValue(row[index], col.type);
    });
    return { id: nextId("row"), cells };
  });

  return {
    table: { columns, rows },
    warnings: warningsForValueRows(dataRows, columns.length),
  };
}

/**
 * @param {string} text
 * @returns {import("./model.js").Column[] | null}
 */
function tryExtractTypeTable(text) {
  const idx = text.toLowerCase().indexOf("type table");
  if (idx < 0) return null;
  try {
    const sc = createScanner(text.slice(idx), {
      allowHashIdent: true,
      bracketIdents: false,
    });
    return parseTypeTable(sc);
  } catch {
    return null;
  }
}

/**
 * @param {ReturnType<typeof createScanner>} sc
 * @returns {import("./model.js").Column[]}
 */
function parseTypeTable(sc) {
  // type table [A = text, B = number]
  // or just [A = text, ...] after "#table("
  let tok = sc.peekToken();
  if (tok.type === "ident" && tok.value.toLowerCase() === "type") {
    sc.next();
    sc.expectIdent("table");
  }

  sc.expect("punct", "[");

  /** @type {import("./model.js").Column[]} */
  const columns = [];
  let index = 0;

  while (true) {
    tok = sc.peekToken();
    if (tok.type === "punct" && tok.value === "]") {
      sc.next();
      break;
    }
    if (tok.type === "punct" && tok.value === ",") {
      sc.next();
      continue;
    }

    const nameTok = sc.next();
    let label;
    if (nameTok.type === "ident" || nameTok.type === "bracket-ident") {
      label = nameTok.value;
    } else if (nameTok.type === "string") {
      label = nameTok.value;
    } else {
      throw new ConvertError("Expected field name in type table");
    }

    sc.expect("punct", "=");

    // type expression: text | number | logical | nullable text | type text | ((type nullable text) meta ...)
    const typeName = readTypeExpression(sc);
    columns.push({
      id: columnIdFromLabel(label, index),
      label,
      type: mapMTypeToColumn(typeName),
    });
    index += 1;
  }

  if (!columns.length) {
    throw new ConvertError("type table has no fields");
  }
  return columns;
}

/**
 * @param {ReturnType<typeof createScanner>} sc
 */
function readTypeExpression(sc) {
  const parts = [];
  let depthParen = 0;

  while (!sc.eof()) {
    const tok = sc.peekToken();
    if (tok.type === "eof") break;

    if (tok.type === "punct" && tok.value === "," && depthParen === 0) break;
    if (tok.type === "punct" && tok.value === "]" && depthParen === 0) break;

    if (tok.type === "punct" && tok.value === "(") {
      depthParen += 1;
      parts.push(tok.value);
      sc.next();
      continue;
    }
    if (tok.type === "punct" && tok.value === ")") {
      depthParen -= 1;
      parts.push(tok.value);
      sc.next();
      continue;
    }

    parts.push(tok.value);
    sc.next();
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Parse M list `{...}` or record `[...]` values.
 * @param {ReturnType<typeof createScanner>} sc
 * @returns {unknown}
 */
function parseMValue(sc) {
  const tok = sc.peekToken();
  if (tok.type === "punct" && tok.value === "{") return parseMList(sc);
  if (tok.type === "punct" && tok.value === "[") return parseMRecord(sc);
  return parseMAtom(sc);
}

/**
 * @param {ReturnType<typeof createScanner>} sc
 * @returns {unknown[]}
 */
function parseMList(sc) {
  sc.expect("punct", "{");
  /** @type {unknown[]} */
  const items = [];
  while (true) {
    const peek = sc.peekToken();
    if (peek.type === "punct" && peek.value === "}") {
      sc.next();
      break;
    }
    if (peek.type === "punct" && peek.value === ",") {
      sc.next();
      continue;
    }
    if (peek.type === "eof") throw new ConvertError("Unterminated M list");
    items.push(parseMValue(sc));
  }
  return items;
}

/**
 * @param {ReturnType<typeof createScanner>} sc
 */
function parseMRecord(sc) {
  sc.expect("punct", "[");
  /** @type {{ name: string, value: unknown }[]} */
  const fields = [];

  while (true) {
    const peek = sc.peekToken();
    if (peek.type === "punct" && peek.value === "]") {
      sc.next();
      break;
    }
    if (peek.type === "punct" && peek.value === ",") {
      sc.next();
      continue;
    }
    if (peek.type === "eof") throw new ConvertError("Unterminated M record");

    const nameTok = sc.next();
    let name;
    if (nameTok.type === "ident" || nameTok.type === "bracket-ident") {
      name = nameTok.value;
    } else if (nameTok.type === "string") {
      name = nameTok.value;
    } else {
      throw new ConvertError("Expected field name in record");
    }
    sc.expect("punct", "=");
    const value = parseMValue(sc);
    fields.push({ name, value });
  }

  return { kind: "record", fields };
}

/**
 * @param {ReturnType<typeof createScanner>} sc
 */
function parseMAtom(sc) {
  const tok = sc.next();
  if (tok.type === "string") return { kind: "string", value: tok.value };
  if (tok.type === "number") return { kind: "number", value: Number(tok.value) };
  if (tok.type === "ident") {
    const lower = tok.value.toLowerCase();
    if (lower === "true") return { kind: "boolean", value: true };
    if (lower === "false") return { kind: "boolean", value: false };
    if (lower === "null") return { kind: "null", value: null };
    return { kind: "string", value: tok.value };
  }
  throw new ConvertError(`Unexpected token '${tok.value || tok.type}' in M value`);
}

/** @param {unknown} lit */
function mLiteralToJs(lit) {
  if (lit === null || lit === undefined) return null;
  if (typeof lit !== "object") return lit;
  const obj = /** @type {{ kind?: string, value?: unknown }} */ (lit);
  if (obj.kind === "null") return null;
  if (obj.kind === "string" || obj.kind === "number" || obj.kind === "boolean") {
    return obj.value;
  }
  return null;
}

/** @param {unknown} value */
function inferMType(value) {
  const v = mLiteralToJs(value);
  if (typeof v === "boolean") return /** @type {const} */ ("logical");
  if (typeof v === "number") return /** @type {const} */ ("number");
  return /** @type {const} */ ("text");
}

/** @param {unknown[]} values */
function inferMTypeFromValues(values) {
  let sawNumber = false;
  let sawLogical = false;
  let sawText = false;
  for (const raw of values) {
    if (raw === null || raw === undefined || raw === "") continue;
    if (typeof raw === "boolean") {
      sawLogical = true;
      continue;
    }
    if (typeof raw === "number") {
      sawNumber = true;
      continue;
    }
    sawText = true;
  }
  if (sawText) return /** @type {const} */ ("text");
  if (sawNumber && !sawLogical) return /** @type {const} */ ("number");
  if (sawLogical && !sawNumber) return /** @type {const} */ ("logical");
  return /** @type {const} */ ("text");
}

/**
 * @param {ReturnType<typeof createScanner>} sc
 */
function skipToHashTable(sc) {
  while (!sc.eof()) {
    const tok = sc.peekToken();
    // #table — our scanner may see punct # then ident table, or ident if combined
    if (tok.type === "punct" && tok.value === "#") {
      sc.next();
      const next = sc.peekToken();
      if (next.type === "ident" && next.value.toLowerCase() === "table") {
        sc.next();
        return;
      }
      continue;
    }
    if (tok.type === "ident" && tok.value.toLowerCase() === "table") {
      // might be bare — check previous was handled
      sc.next();
      return;
    }
    sc.next();
  }
  throw new ConvertError("Expected #table(...)");
}

/**
 * @param {ReturnType<typeof createScanner>} sc
 */
function findFromRecords(sc) {
  while (!sc.eof()) {
    const tok = sc.next();
    if (tok.type === "ident" && tok.value === "Table") {
      const dot = sc.peekToken();
      if (dot.type === "punct" && dot.value === ".") {
        sc.next();
        const fn = sc.peekToken();
        if (fn.type === "ident" && fn.value.toLowerCase() === "fromrecords") {
          sc.next();
          return;
        }
      }
    }
    // also Table.FromRecords as single ident with dot inside — our lexer keeps dots in idents!
    if (tok.type === "ident" && tok.value.toLowerCase() === "table.fromrecords") {
      return;
    }
  }
  throw new ConvertError("Expected Table.FromRecords(...)");
}
