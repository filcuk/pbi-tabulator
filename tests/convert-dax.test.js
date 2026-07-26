import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTable,
  tablesEqualByContent,
  resetIdCounter,
  ConvertError,
} from "../app/convert/model.js";
import { generateDax } from "../app/convert/dax-generate.js";
import { parseDax } from "../app/convert/dax-parse.js";

const sample = normalizeTable({
  columns: [
    { id: "name", label: "Name", type: "text" },
    { id: "age", label: "Age", type: "number" },
    { id: "active", label: "Active", type: "logical" },
  ],
  rows: [
    { cells: { name: "Alice", age: 30, active: true } },
    { cells: { name: "Bob", age: 25, active: false } },
  ],
});

test("generateDax datatable round-trips through parseDax", () => {
  resetIdCounter();
  const code = generateDax(sample, "datatable");
  assert.match(code, /DATATABLE\s*\(/);
  const parsed = parseDax(code);
  assert.equal(tablesEqualByContent(sample, parsed), true);
});

test("generateDax constructor round-trips through parseDax", () => {
  resetIdCounter();
  const code = generateDax(sample, "constructor");
  assert.match(code, /SELECTCOLUMNS\s*\(/);
  const parsed = parseDax(code);
  assert.equal(tablesEqualByContent(sample, parsed), true);
});

test("generateDax union-row round-trips through parseDax", () => {
  resetIdCounter();
  const code = generateDax(sample, "union-row");
  assert.match(code, /UNION\s*\(/);
  assert.match(code, /ROW\s*\(/);
  const parsed = parseDax(code);
  assert.equal(tablesEqualByContent(sample, parsed), true);
});

test("parseDax accepts EVALUATE wrapper", () => {
  const code = `EVALUATE
DATATABLE(
    "Name", STRING,
    {
        { "Ada" }
    }
)`;
  const parsed = parseDax(code);
  assert.equal(parsed.columns[0].label, "Name");
  assert.equal(parsed.rows[0].cells[parsed.columns[0].id], "Ada");
});

test("parseDax ROW alone", () => {
  const parsed = parseDax(`ROW("A", 1, "B", TRUE)`);
  assert.equal(parsed.columns.length, 2);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].cells[parsed.columns[0].id], 1);
  assert.equal(parsed.rows[0].cells[parsed.columns[1].id], true);
});

test("empty union-row generates FILTER schema and parses to zero rows", () => {
  const empty = normalizeTable({
    columns: [
      { id: "name", label: "Name", type: "text" },
      { id: "n", label: "N", type: "number" },
    ],
    rows: [],
  });
  const code = generateDax(empty, "union-row");
  assert.match(code, /FILTER\s*\(\s*ROW/);
  const parsed = parseDax(code);
  assert.equal(parsed.columns.length, 2);
  assert.equal(parsed.rows.length, 0);
});

test("parseDax rejects empty and unknown forms", () => {
  assert.throws(() => parseDax(""), (err) => err instanceof ConvertError);
  assert.throws(() => parseDax("SUM(1)"), (err) => err instanceof ConvertError);
});
