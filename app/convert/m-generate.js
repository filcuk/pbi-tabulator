/**
 * Generate Power Query M table expressions from the canonical table model.
 *
 * Dialects: table | from-records | binary-from-text
 */

import {
  ConvertError,
  mapColumnTypeToM,
  normalizeTable,
} from "./model.js";
import { formatMFieldName, formatMLiteral, quoteString } from "./scan.js";
import { encodeJsonDeflateBase64 } from "./binary.js";

/**
 * @param {import("./model.js").TableModel} table
 * @param {import("./model.js").MDialect} dialect
 * @returns {Promise<string> | string}
 */
export function generateM(table, dialect = "table") {
  const model = normalizeTable(table);
  if (!model.columns.length) {
    throw new ConvertError("Cannot generate M from a table with no columns");
  }

  switch (dialect) {
    case "table":
      return generateHashTable(model);
    case "from-records":
      return generateFromRecords(model);
    case "binary-from-text":
      return generateBinaryFromText(model);
    default:
      throw new ConvertError(`Unknown M dialect: ${dialect}`);
  }
}

/** @param {import("./model.js").TableModel} model */
function typeTableClause(model) {
  const fields = model.columns
    .map((col) => `${formatMFieldName(col.label)} = ${mapColumnTypeToM(col.type)}`)
    .join(", ");
  return `type table [${fields}]`;
}

/** @param {import("./model.js").TableModel} model */
function generateHashTable(model) {
  const rows = model.rows.map((row) => {
    const cells = model.columns.map((col) =>
      formatMLiteral(row.cells[col.id], col.type)
    );
    return `{${cells.join(", ")}}`;
  });

  const rowsBlock =
    rows.length === 0 ? "{}" : `{\n    ${rows.join(",\n    ")}\n}`;

  return `#table(
    ${typeTableClause(model)},
    ${rowsBlock}
)`;
}

/** @param {import("./model.js").TableModel} model */
function generateFromRecords(model) {
  if (model.rows.length === 0) {
    // Empty FromRecords still needs a type hint via #table
    return `#table(${typeTableClause(model)}, {})`;
  }

  const records = model.rows.map((row) => {
    const fields = model.columns.map((col) => {
      const name = formatMFieldName(col.label);
      const value = formatMLiteral(row.cells[col.id], col.type);
      return `${name} = ${value}`;
    });
    return `[${fields.join(", ")}]`;
  });

  return `Table.FromRecords({
    ${records.join(",\n    ")}
})`;
}

/** @param {import("./model.js").TableModel} model */
async function generateBinaryFromText(model) {
  const jsonRows = model.rows.map((row) =>
    model.columns.map((col) => {
      const v = row.cells[col.id];
      if (col.type === "number") {
        return v === null || v === undefined || v === "" ? null : Number(v);
      }
      if (col.type === "logical") return Boolean(v);
      return v === null || v === undefined ? "" : String(v);
    })
  );

  const b64 = await encodeJsonDeflateBase64(jsonRows);
  const typeClause = typeTableClause(model);

  return `let
    Source = Table.FromRows(
        Json.Document(
            Binary.Decompress(
                Binary.FromText(${quoteString(b64)}, BinaryEncoding.Base64),
                Compression.Deflate
            )
        ),
        ${typeClause}
    )
in
    Source`;
}
