/**
 * Output-language column types for Configuration (DAX / M).
 * Canonical grid types stay text | number | logical; these are the exact
 * types written into generated expressions.
 */

/** @typedef {"dax" | "m"} OutputLang */

/**
 * @typedef {{ value: string, label: string }} OutputTypeOption
 */

/** @type {readonly OutputTypeOption[]} */
export const DAX_OUTPUT_TYPES = Object.freeze([
  { value: "STRING", label: "STRING" },
  { value: "INTEGER", label: "INTEGER" },
  { value: "DOUBLE", label: "DOUBLE" },
  { value: "BOOLEAN", label: "BOOLEAN" },
  { value: "CURRENCY", label: "CURRENCY" },
  { value: "DATETIME", label: "DATETIME" },
]);

/** @type {readonly OutputTypeOption[]} */
export const M_OUTPUT_TYPES = Object.freeze([
  { value: "text", label: "text" },
  { value: "number", label: "number" },
  { value: "logical", label: "logical" },
  { value: "date", label: "date" },
  { value: "datetime", label: "datetime" },
  { value: "time", label: "time" },
  { value: "duration", label: "duration" },
]);

const DAX_VALUES = new Set(DAX_OUTPUT_TYPES.map((t) => t.value));
const M_VALUES = new Set(M_OUTPUT_TYPES.map((t) => t.value));

/** @type {Record<string, string>} */
const DAX_TO_M = {
  STRING: "text",
  INTEGER: "number",
  DOUBLE: "number",
  BOOLEAN: "logical",
  CURRENCY: "number",
  DATETIME: "datetime",
};

/** @type {Record<string, string>} */
const M_TO_DAX = {
  text: "STRING",
  number: "DOUBLE",
  logical: "BOOLEAN",
  date: "DATETIME",
  datetime: "DATETIME",
  time: "DATETIME",
  duration: "STRING",
};

/**
 * @param {OutputLang} lang
 * @returns {readonly OutputTypeOption[]}
 */
export function outputTypeOptions(lang) {
  return lang === "m" ? M_OUTPUT_TYPES : DAX_OUTPUT_TYPES;
}

/**
 * @param {OutputLang} lang
 * @param {string} value
 */
export function isValidOutputType(lang, value) {
  return lang === "m" ? M_VALUES.has(value) : DAX_VALUES.has(value);
}

/**
 * Map an output type to the canonical grid type used for literal formatting.
 * @param {OutputLang} lang
 * @param {string} outputType
 * @returns {import("./model.js").ColumnType}
 */
export function outputTypeToCanonical(lang, outputType) {
  const t = String(outputType ?? "");
  if (lang === "dax") {
    if (t === "BOOLEAN") return "logical";
    if (t === "INTEGER" || t === "DOUBLE" || t === "CURRENCY") return "number";
    return "text";
  }
  if (t === "logical") return "logical";
  if (t === "number") return "number";
  return "text";
}

/**
 * Best-effort remapping when the target language changes.
 * @param {OutputLang} fromLang
 * @param {OutputLang} toLang
 * @param {string} outputType
 * @returns {string | null}
 */
export function remapOutputType(fromLang, toLang, outputType) {
  if (fromLang === toLang) return outputType;
  if (!isValidOutputType(fromLang, outputType)) return null;
  const mapped =
    fromLang === "dax" ? DAX_TO_M[outputType] : M_TO_DAX[outputType];
  if (!mapped || !isValidOutputType(toLang, mapped)) return null;
  return mapped;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const DURATION_RE = /^-?P(?!$)(\d+Y)?(\d+M)?(\d+D)?(T(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/i;

/**
 * @param {unknown} value
 */
function isIntegerCell(value) {
  if (typeof value === "boolean") return false;
  if (typeof value === "number") {
    return Number.isFinite(value) && Number.isInteger(value);
  }
  const text = String(value ?? "").trim();
  if (!text || !/^-?\d+$/.test(text)) return false;
  return Number.isSafeInteger(Number(text));
}

/**
 * @param {unknown[]} values
 * @param {(value: unknown) => boolean} pred
 */
function everyNonEmpty(values, pred) {
  const nonEmpty = (values ?? []).filter((value) => {
    if (value === null || value === undefined) return false;
    return String(value).trim() !== "";
  });
  return nonEmpty.length > 0 && nonEmpty.every(pred);
}

/**
 * Suggest an output type from the canonical column type and cell values.
 * @param {OutputLang} lang
 * @param {import("./model.js").ColumnType} columnType
 * @param {unknown[]} [values]
 */
export function suggestOutputType(lang, columnType, values = []) {
  if (lang === "dax") {
    if (columnType === "logical") return "BOOLEAN";
    if (columnType === "number") {
      return everyNonEmpty(values, isIntegerCell) ? "INTEGER" : "DOUBLE";
    }
    if (everyNonEmpty(values, (v) => DATETIME_RE.test(String(v).trim()))) {
      return "DATETIME";
    }
    if (everyNonEmpty(values, (v) => DATE_RE.test(String(v).trim()))) {
      return "DATETIME";
    }
    return "STRING";
  }

  // M
  if (columnType === "logical") return "logical";
  if (columnType === "number") return "number";
  if (everyNonEmpty(values, (v) => DATETIME_RE.test(String(v).trim()))) {
    return "datetime";
  }
  if (everyNonEmpty(values, (v) => DATE_RE.test(String(v).trim()))) {
    return "date";
  }
  if (everyNonEmpty(values, (v) => TIME_RE.test(String(v).trim()))) {
    return "time";
  }
  if (everyNonEmpty(values, (v) => DURATION_RE.test(String(v).trim()))) {
    return "duration";
  }
  return "text";
}

/**
 * Effective DAX type keyword for generation.
 * @param {{ type: import("./model.js").ColumnType, outputType?: string }} col
 */
export function effectiveDaxType(col) {
  if (col.outputType && DAX_VALUES.has(col.outputType)) return col.outputType;
  return col.type === "logical"
    ? "BOOLEAN"
    : col.type === "number"
      ? "DOUBLE"
      : "STRING";
}

/**
 * Effective M type keyword for generation.
 * @param {{ type: import("./model.js").ColumnType, outputType?: string }} col
 */
export function effectiveMType(col) {
  if (col.outputType && M_VALUES.has(col.outputType)) return col.outputType;
  return col.type === "logical"
    ? "logical"
    : col.type === "number"
      ? "number"
      : "text";
}
