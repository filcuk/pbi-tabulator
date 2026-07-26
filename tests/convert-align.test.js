import test from "node:test";
import assert from "node:assert/strict";
import { joinAligned, joinRows } from "../app/convert/align.js";
import { generateDax } from "../app/convert/dax-generate.js";
import { normalizeTable } from "../app/convert/model.js";

test("joinAligned pads fields so commas line up", () => {
  const lines = joinAligned([
    ["Abc", "Def"],
    ["A", "B"],
  ]);
  assert.deepEqual(lines, ["Abc, Def", "A  , B"]);
});

test("joinAligned padLast pads the final field for end brackets", () => {
  const lines = joinAligned(
    [
      ["Abc", "Def"],
      ["A", "B"],
    ],
    ", ",
    { padLast: true }
  );
  assert.deepEqual(lines, ["Abc, Def", "A  , B  "]);
});

test("joinRows without align joins tightly", () => {
  assert.deepEqual(
    joinRows([
      ["Abc", "Def"],
      ["A", "B"],
    ]),
    ["Abc, Def", "A, B"]
  );
});

test("generateDax DATATABLE aligns commas when requested", () => {
  const table = normalizeTable({
    columns: [
      { id: "name", label: "Name", type: "text", outputType: "STRING" },
      { id: "n", label: "N", type: "number", outputType: "INTEGER" },
    ],
    rows: [
      { cells: { name: "Alice", n: 30 } },
      { cells: { name: "Bo", n: 5 } },
    ],
  });

  const plain = generateDax(table, "datatable");
  assert.match(plain, /\{\s*"Alice", 30\s*\}/);
  assert.match(plain, /\{\s*"Bo", 5\s*\}/);

  const aligned = generateDax(table, "datatable", { alignCommas: true });
  assert.match(aligned, /\{ "Alice", 30 \}/);
  assert.match(aligned, /\{ "Bo"   , 5  \}/);
  assert.match(aligned, /"Name", STRING,/);
  assert.match(aligned, /"N"   , INTEGER,/);
});

test("generateDax DATATABLE minimised puts columns on one line", () => {
  const table = normalizeTable({
    columns: [
      { id: "name", label: "Name", type: "text", outputType: "STRING" },
      { id: "n", label: "N", type: "number", outputType: "INTEGER" },
    ],
    rows: [{ cells: { name: "Alice", n: 30 } }],
  });

  const code = generateDax(table, "datatable", { minimised: true });
  assert.match(code, /"Name", STRING, "N", INTEGER/);
  assert.doesNotMatch(code, /"Name", STRING,\n/);
});
