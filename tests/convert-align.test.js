import test from "node:test";
import assert from "node:assert/strict";
import { joinAligned, joinList, joinRows } from "../app/convert/align.js";
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

test("joinList uses trailing commas by default", () => {
  assert.equal(joinList(["a", "b"], { indent: "    " }), "a,\n    b");
});

test("joinList commaFirst puts commas at the start of new lines", () => {
  assert.equal(
    joinList(["a", "b"], { commaFirst: true, indent: "    " }),
    "  a\n    , b"
  );
  assert.equal(
    joinList(["a", "b"], { commaFirst: true, indent: "        " }),
    "  a\n        , b"
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
  assert.match(aligned, /\{ "Bo" {3}, 5 {2}\}/);
  assert.match(aligned, /"Name", STRING,/);
  assert.match(aligned, /"N" {3}, INTEGER,/);
});

test("generateDax DATATABLE commaFirst puts commas on new lines", () => {
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

  const code = generateDax(table, "datatable", { commaFirst: true });
  assert.match(code, / {6}"Name", STRING\n {4}, "N", INTEGER,/);
  assert.match(code, / {10}\{\s*"Alice", 30\s*\}\n {8}, \{\s*"Bo", 5\s*\}/);
  assert.doesNotMatch(code, /\{\s*"Alice", 30\s*\},/);
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
