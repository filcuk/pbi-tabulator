/**
 * Public facade for tabular ↔ DAX/M conversion.
 */

import { ConvertError, DAX_DIALECTS, M_DIALECTS, normalizeTable } from "./model.js";
import { generateDax } from "./dax-generate.js";
import { parseDax } from "./dax-parse.js";
import { generateM } from "./m-generate.js";
import { parseM } from "./m-parse.js";

export {
  ConvertError,
  DAX_DIALECTS,
  M_DIALECTS,
  normalizeTable,
  cloneTable,
  createEmptyTable,
  tablesEqualByContent,
} from "./model.js";

export {
  DAX_OUTPUT_TYPES,
  M_OUTPUT_TYPES,
  outputTypeOptions,
  suggestOutputType,
  effectiveDaxType,
  effectiveMType,
} from "./output-types.js";

export { generateDax } from "./dax-generate.js";
export { parseDax } from "./dax-parse.js";
export { generateM } from "./m-generate.js";
export { parseM } from "./m-parse.js";

/**
 * @param {"dax" | "m"} lang
 * @param {string} text
 * @returns {Promise<import("./model.js").TableModel> | import("./model.js").TableModel}
 */
export function parse(lang, text) {
  if (lang === "dax") return parseDax(text);
  if (lang === "m") return parseM(text);
  throw new ConvertError(`Cannot parse language: ${lang}`);
}

/**
 * @param {"dax" | "m"} lang
 * @param {string} dialect
 * @param {import("./model.js").TableModel} table
 * @param {{ alignCommas?: boolean }} [options]
 * @returns {Promise<string> | string}
 */
export function generate(lang, dialect, table, options = {}) {
  const model = normalizeTable(table);
  if (lang === "dax") {
    if (!DAX_DIALECTS.includes(/** @type {import("./model.js").DaxDialect} */ (dialect))) {
      throw new ConvertError(`Unknown DAX dialect: ${dialect}`);
    }
    return generateDax(
      model,
      /** @type {import("./model.js").DaxDialect} */ (dialect),
      options
    );
  }
  if (lang === "m") {
    if (!M_DIALECTS.includes(/** @type {import("./model.js").MDialect} */ (dialect))) {
      throw new ConvertError(`Unknown M dialect: ${dialect}`);
    }
    return generateM(
      model,
      /** @type {import("./model.js").MDialect} */ (dialect),
      options
    );
  }
  throw new ConvertError(`Cannot generate language: ${lang}`);
}
