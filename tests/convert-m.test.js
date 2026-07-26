import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTable,
  tablesEqualByContent,
  resetIdCounter,
  ConvertError,
} from "../app/convert/model.js";
import { generateM } from "../app/convert/m-generate.js";
import { parseM } from "../app/convert/m-parse.js";
import { encodeJsonDeflateBase64, decodeJsonDeflateBase64 } from "../app/convert/binary.js";
import { generate, parse } from "../app/convert/index.js";

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

test("deflate/inflate base64 JSON round-trip", async () => {
  const payload = [
    ["Alice", 30, true],
    ["Bob", 25, false],
  ];
  const b64 = await encodeJsonDeflateBase64(payload);
  assert.equal(typeof b64, "string");
  assert.ok(b64.length > 0);
  const decoded = await decodeJsonDeflateBase64(b64);
  assert.deepEqual(decoded, payload);
});

test("generateM #table round-trips through parseM", async () => {
  resetIdCounter();
  const code = await generateM(sample, "table");
  assert.match(code, /#table\s*\(/);
  const parsed = await parseM(code);
  assert.equal(tablesEqualByContent(sample, parsed), true);
});

test("generateM FromRecords round-trips through parseM", async () => {
  resetIdCounter();
  const code = await generateM(sample, "from-records");
  assert.match(code, /Table\.FromRecords\s*\(/);
  const parsed = await parseM(code);
  assert.equal(tablesEqualByContent(sample, parsed), true);
});

test("generateM Binary.FromText round-trips through parseM", async () => {
  resetIdCounter();
  const code = await generateM(sample, "binary-from-text");
  assert.match(code, /Binary\.FromText/);
  assert.match(code, /BinaryEncoding\.Base64/);
  assert.match(code, /Table\.FromRows/);
  const parsed = await parseM(code);
  assert.equal(tablesEqualByContent(sample, parsed), true);
});

test("parseM rejects empty and unknown forms", async () => {
  await assert.rejects(() => parseM(""), (err) => err instanceof ConvertError);
  await assert.rejects(() => parseM("1 + 1"), (err) => err instanceof ConvertError);
});

test("facade parse/generate for dax and m", async () => {
  const dax = await generate("dax", "datatable", sample);
  const fromDax = await parse("dax", dax);
  assert.equal(tablesEqualByContent(sample, fromDax), true);

  const m = await generate("m", "table", sample);
  const fromM = await parse("m", m);
  assert.equal(tablesEqualByContent(sample, fromM), true);
});
