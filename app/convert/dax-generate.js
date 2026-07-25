/**
 * Generate DAX table expressions from the canonical table model.
 *
 * Dialects: datatable | constructor | union-row
 */

import {
  ConvertError,
  mapColumnTypeToDax,
  normalizeTable,
} from "./model.js";
import { formatDaxLiteral, quoteString } from "./scan.js";

/**
 * @param {import("./model.js").TableModel} table
 * @param {import("./model.js").DaxDialect} dialect
 */
export function generateDax(table, dialect = "datatable") {
  const model = normalizeTable(table);
  if (!model.columns.length) {
    throw new ConvertError("Cannot generate DAX from a table with no columns");
  }

  switch (dialect) {
    case "datatable":
      return generateDatatable(model);
    case "constructor":
      return model.rows.length === 0
        ? generateDatatable(model)
        : generateConstructor(model);
    case "union-row":
      return model.rows.length === 0
        ? generateEmptyUnionRow(model)
        : generateUnionRow(model);
    default:
      throw new ConvertError(`Unknown DAX dialect: ${dialect}`);
  }
}

/** @param {import("./model.js").TableModel} model */
function generateDatatable(model) {
  const headerParts = model.columns.flatMap((col) => [
    quoteString(col.label),
    mapColumnTypeToDax(col.type),
  ]);

  const rowParts = model.rows.map((row) => {
    const cells = model.columns.map((col) =>
      formatDaxLiteral(row.cells[col.id], col.type)
    );
    return `{ ${cells.join(", ")} }`;
  });

  const rowsBlock =
    rowParts.length === 0 ? "{}" : `{\n        ${rowParts.join(",\n        ")}\n    }`;

  return `DATATABLE(
    ${headerParts.join(",\n    ")},
    ${rowsBlock}
)`;
}

/** @param {import("./model.js").TableModel} model */
function generateConstructor(model) {
  const tupleRows = model.rows.map((row) => {
    const cells = model.columns.map((col) =>
      formatDaxLiteral(row.cells[col.id], col.type)
    );
    return `( ${cells.join(", ")} )`;
  });

  const selectCols = model.columns
    .map((col, index) => `${quoteString(col.label)}, [Value${index + 1}]`)
    .join(",\n    ");

  return `SELECTCOLUMNS(
    {
        ${tupleRows.join(",\n        ")}
    },
    ${selectCols}
)`;
}

/** @param {import("./model.js").TableModel} model */
function generateUnionRow(model) {
  const rowExprs = model.rows.map((row) => {
    const parts = model.columns.flatMap((col) => [
      quoteString(col.label),
      formatDaxLiteral(row.cells[col.id], col.type),
    ]);
    return `ROW(${parts.join(", ")})`;
  });

  if (rowExprs.length === 1) return rowExprs[0];
  return `UNION(\n    ${rowExprs.join(",\n    ")}\n)`;
}

/** @param {import("./model.js").TableModel} model */
function generateEmptyUnionRow(model) {
  const parts = model.columns.flatMap((col) => [
    quoteString(col.label),
    col.type === "number"
      ? "BLANK()"
      : col.type === "logical"
        ? "FALSE"
        : '""',
  ]);
  return `FILTER(ROW(${parts.join(", ")}), FALSE)`;
}
