/**
 * Generate DAX table expressions from the canonical table model.
 *
 * Dialects: datatable | constructor | union-row
 */

import { joinRows } from "./align.js";
import { ConvertError, normalizeTable } from "./model.js";
import {
  effectiveDaxType,
  outputTypeToCanonical,
} from "./output-types.js";
import { formatDaxLiteral, quoteString } from "./scan.js";

/**
 * @typedef {{ alignCommas?: boolean, minimised?: boolean }} GenerateOptions
 */

/**
 * @param {import("./model.js").Column} col
 */
function daxFormatType(col) {
  return outputTypeToCanonical("dax", effectiveDaxType(col));
}

/**
 * @param {import("./model.js").TableModel} table
 * @param {import("./model.js").DaxDialect} dialect
 * @param {GenerateOptions} [options]
 */
export function generateDax(table, dialect = "datatable", options = {}) {
  const model = normalizeTable(table);
  if (!model.columns.length) {
    throw new ConvertError("Cannot generate DAX from a table with no columns");
  }

  const opts = {
    alignCommas: Boolean(options.alignCommas),
    minimised: Boolean(options.minimised),
  };

  switch (dialect) {
    case "datatable":
      return generateDatatable(model, opts);
    case "constructor":
      return model.rows.length === 0
        ? generateDatatable(model, opts)
        : generateConstructor(model, opts);
    case "union-row":
      return model.rows.length === 0
        ? generateEmptyUnionRow(model, opts)
        : generateUnionRow(model, opts);
    default:
      throw new ConvertError(`Unknown DAX dialect: ${dialect}`);
  }
}

/**
 * @param {import("./model.js").TableModel} model
 * @param {GenerateOptions} opts
 */
function generateDatatable(model, opts) {
  const headerRows = model.columns.map((col) => [
    quoteString(col.label),
    effectiveDaxType(col),
  ]);
  const headerParts = joinRows(headerRows, {
    align: opts.alignCommas && !opts.minimised,
  });
  const headerSep = opts.minimised ? ", " : ",\n    ";

  const cellRows = model.rows.map((row) =>
    model.columns.map((col) =>
      formatDaxLiteral(row.cells[col.id], daxFormatType(col))
    )
  );
  const rowParts = joinRows(cellRows, {
    align: opts.alignCommas,
    padLast: opts.alignCommas,
  }).map((line) => `{ ${line} }`);

  const rowsBlock =
    rowParts.length === 0
      ? "{}"
      : `{\n        ${rowParts.join(",\n        ")}\n    }`;

  return `DATATABLE(
    ${headerParts.join(headerSep)},
    ${rowsBlock}
)`;
}

/**
 * @param {import("./model.js").TableModel} model
 * @param {GenerateOptions} opts
 */
function generateConstructor(model, opts) {
  const cellRows = model.rows.map((row) =>
    model.columns.map((col) =>
      formatDaxLiteral(row.cells[col.id], daxFormatType(col))
    )
  );
  const tupleRows = joinRows(cellRows, {
    align: opts.alignCommas,
    padLast: opts.alignCommas,
  }).map((line) => `( ${line} )`);

  const selectRows = model.columns.map((col, index) => [
    quoteString(col.label),
    `[Value${index + 1}]`,
  ]);
  const selectSep = opts.minimised ? ", " : ",\n    ";
  const selectCols = joinRows(selectRows, {
    align: opts.alignCommas && !opts.minimised,
  }).join(selectSep);

  return `SELECTCOLUMNS(
    {
        ${tupleRows.join(",\n        ")}
    },
    ${selectCols}
)`;
}

/**
 * @param {import("./model.js").TableModel} model
 * @param {GenerateOptions} opts
 */
function generateUnionRow(model, opts) {
  const partRows = model.rows.map((row) =>
    model.columns.flatMap((col) => [
      quoteString(col.label),
      formatDaxLiteral(row.cells[col.id], daxFormatType(col)),
    ])
  );
  const rowExprs = joinRows(partRows, {
    align: opts.alignCommas,
    padLast: opts.alignCommas,
  }).map((line) => `ROW(${line})`);

  if (rowExprs.length === 1) return rowExprs[0];
  return `UNION(\n    ${rowExprs.join(",\n    ")}\n)`;
}

/**
 * @param {import("./model.js").TableModel} model
 * @param {GenerateOptions} [_opts]
 */
function generateEmptyUnionRow(model, _opts) {
  const parts = model.columns.flatMap((col) => {
    const formatType = daxFormatType(col);
    return [
      quoteString(col.label),
      formatType === "number"
        ? "BLANK()"
        : formatType === "logical"
          ? "FALSE"
          : '""',
    ];
  });
  return `FILTER(ROW(${parts.join(", ")}), FALSE)`;
}
