/**
 * Generate Power Query M table expressions from the canonical table model.
 *
 * Dialects: table | from-records | binary-from-text
 */

import { joinList, joinRows } from "./align.js";
import { ConvertError, normalizeTable } from "./model.js";
import {
  effectiveMType,
  outputTypeToCanonical,
} from "./output-types.js";
import { formatMFieldName, formatMLiteral, quoteString } from "./scan.js";
import { encodeJsonDeflateBase64 } from "./binary.js";

/**
 * @typedef {{ alignCommas?: boolean, minimised?: boolean, commaFirst?: boolean }} GenerateOptions
 */

/**
 * @param {import("./model.js").Column} col
 */
function mFormatType(col) {
  return outputTypeToCanonical("m", effectiveMType(col));
}

/**
 * @param {import("./model.js").TableModel} table
 * @param {import("./model.js").MDialect} dialect
 * @param {GenerateOptions} [options]
 * @returns {Promise<string> | string}
 */
export function generateM(table, dialect = "table", options = {}) {
  const model = normalizeTable(table);
  if (!model.columns.length) {
    throw new ConvertError("Cannot generate M from a table with no columns");
  }

  const opts = {
    alignCommas: Boolean(options.alignCommas),
    minimised: Boolean(options.minimised),
    commaFirst: Boolean(options.commaFirst),
  };

  switch (dialect) {
    case "table":
      return generateHashTable(model, opts);
    case "from-records":
      return generateFromRecords(model, opts);
    case "binary-from-text":
      return generateBinaryFromText(model, opts);
    default:
      throw new ConvertError(`Unknown M dialect: ${dialect}`);
  }
}

/**
 * @param {import("./model.js").TableModel} model
 * @param {{ multiline?: boolean, alignCommas?: boolean, commaFirst?: boolean, blockIndent?: string }} [opts]
 */
function typeTableClause(
  model,
  {
    multiline = false,
    alignCommas = false,
    commaFirst = false,
    blockIndent = "    ",
  } = {}
) {
  const parts = model.columns.map((col) => [
    formatMFieldName(col.label),
    effectiveMType(col),
  ]);

  if (!multiline) {
    if (alignCommas) {
      return `type table [${joinRows(parts, { align: true, separator: " = " }).join(", ")}]`;
    }
    return `type table [${parts.map((p) => p.join(" = ")).join(", ")}]`;
  }

  const fieldIndent = `${blockIndent}${blockIndent}`;
  const fields = alignCommas
    ? joinRows(parts, { align: true, separator: " = " })
    : parts.map((p) => p.join(" = "));

  return `type table [
${fieldIndent}${joinList(fields, { commaFirst, indent: fieldIndent })}
${blockIndent}]`;
}

/**
 * @param {import("./model.js").TableModel} model
 * @param {GenerateOptions} opts
 */
function generateHashTable(model, opts) {
  const cellRows = model.rows.map((row) =>
    model.columns.map((col) =>
      formatMLiteral(row.cells[col.id], mFormatType(col))
    )
  );
  const rows = joinRows(cellRows, {
    align: opts.alignCommas,
    padLast: opts.alignCommas,
  }).map((line) => `{${line}}`);

  const rowsBlock =
    rows.length === 0
      ? "{}"
      : `{\n        ${joinList(rows, {
          commaFirst: opts.commaFirst,
          indent: "        ",
        })}\n    }`;

  return `#table(
    ${typeTableClause(model, {
      multiline: !opts.minimised,
      alignCommas: opts.alignCommas && !opts.minimised,
      commaFirst: opts.commaFirst && !opts.minimised,
    })},
    ${rowsBlock}
)`;
}

/**
 * @param {import("./model.js").TableModel} model
 * @param {GenerateOptions} opts
 */
function generateFromRecords(model, opts) {
  if (model.rows.length === 0) {
    // Empty FromRecords still needs a type hint via #table
    return `#table(${typeTableClause(model, { alignCommas: opts.alignCommas })}, {})`;
  }

  const fieldRows = model.rows.map((row) =>
    model.columns.map((col) => {
      const name = formatMFieldName(col.label);
      const value = formatMLiteral(row.cells[col.id], mFormatType(col));
      return `${name} = ${value}`;
    })
  );
  const records = joinRows(fieldRows, {
    align: opts.alignCommas,
    padLast: opts.alignCommas,
  }).map((line) => `[${line}]`);

  return `Table.FromRecords({
    ${joinList(records, {
      commaFirst: opts.commaFirst,
      indent: "    ",
    })}
})`;
}

/**
 * @param {import("./model.js").TableModel} model
 * @param {GenerateOptions} opts
 */
async function generateBinaryFromText(model, opts) {
  const jsonRows = model.rows.map((row) =>
    model.columns.map((col) => {
      const v = row.cells[col.id];
      const formatType = mFormatType(col);
      if (formatType === "number") {
        return v === null || v === undefined || v === "" ? null : Number(v);
      }
      if (formatType === "logical") return Boolean(v);
      return v === null || v === undefined ? "" : String(v);
    })
  );

  const b64 = await encodeJsonDeflateBase64(jsonRows);
  const typeClause = typeTableClause(model, {
    multiline: !opts.minimised,
    alignCommas: opts.alignCommas && !opts.minimised,
    commaFirst: opts.commaFirst && !opts.minimised,
    blockIndent: "        ",
  });

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
