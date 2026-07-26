/**
 * Lightweight scanner for DAX / M table snippets (not a full language lexer).
 */

import { ConvertError } from "./model.js";

/**
 * @typedef {{ type: string, value: string, index: number }} Token
 */

/**
 * @param {string} input
 * @param {{ allowHashIdent?: boolean, bracketIdents?: boolean }} [opts]
 */
export function createScanner(
  input,
  { allowHashIdent = false, bracketIdents = true } = {}
) {
  const src = String(input ?? "");
  let i = 0;

  function eof() {
    return i >= src.length;
  }

  function skipWs() {
    while (i < src.length) {
      const ch = src[i];
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        i += 1;
        continue;
      }
      // line comments // and --
      if (ch === "/" && src[i + 1] === "/") {
        i += 2;
        while (i < src.length && src[i] !== "\n") i += 1;
        continue;
      }
      if (ch === "-" && src[i + 1] === "-") {
        i += 2;
        while (i < src.length && src[i] !== "\n") i += 1;
        continue;
      }
      // block comments /* */
      if (ch === "/" && src[i + 1] === "*") {
        i += 2;
        while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
        i += 2;
        continue;
      }
      break;
    }
  }

  /** @returns {Token} */
  function next() {
    skipWs();
    if (eof()) return { type: "eof", value: "", index: i };

    const start = i;
    const ch = src[i];

    if (ch === '"') {
      i += 1;
      let out = "";
      while (i < src.length) {
        const c = src[i];
        if (c === '"') {
          if (src[i + 1] === '"') {
            out += '"';
            i += 2;
            continue;
          }
          i += 1;
          return { type: "string", value: out, index: start };
        }
        out += c;
        i += 1;
      }
      throw new ConvertError(`Unterminated string at position ${start}`);
    }

    if (allowHashIdent && ch === "#" && src[i + 1] === '"') {
      i += 2;
      let out = "";
      while (i < src.length) {
        const c = src[i];
        if (c === '"') {
          if (src[i + 1] === '"') {
            out += '"';
            i += 2;
            continue;
          }
          i += 1;
          return { type: "ident", value: out, index: start };
        }
        out += c;
        i += 1;
      }
      throw new ConvertError(`Unterminated #"..." identifier at position ${start}`);
    }

    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let num = "";
      while (/[0-9.]/.test(src[i] ?? "")) {
        num += src[i];
        i += 1;
      }
      return { type: "number", value: num, index: start };
    }

    if (/[A-Za-z_]/.test(ch)) {
      let id = "";
      while (/[A-Za-z0-9_.]/.test(src[i] ?? "")) {
        id += src[i];
        i += 1;
      }
      return { type: "ident", value: id, index: start };
    }

    // bracketed [Name] identifiers (DAX column refs). Disabled for M so
    // `[Name = text]` type tables / records tokenize as punct + fields.
    if (bracketIdents && ch === "[") {
      i += 1;
      let out = "";
      while (i < src.length && src[i] !== "]") {
        out += src[i];
        i += 1;
      }
      if (src[i] !== "]") {
        throw new ConvertError(`Unterminated [identifier] at position ${start}`);
      }
      i += 1;
      return { type: "bracket-ident", value: out, index: start };
    }

    i += 1;
    return { type: "punct", value: ch, index: start };
  }

  /** @returns {Token} */
  function peekToken() {
    const saved = i;
    const tok = next();
    i = saved;
    return tok;
  }

  /**
   * @param {string} type
   * @param {string} [value]
   */
  function expect(type, value) {
    const tok = next();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      const want = value !== undefined ? `${type} '${value}'` : type;
      throw new ConvertError(
        `Expected ${want} but found ${tok.type}${tok.value ? ` '${tok.value}'` : ""}`
      );
    }
    return tok;
  }

  /**
   * @param {string} name
   */
  function expectIdent(name) {
    const tok = expect("ident");
    if (tok.value.toLowerCase() !== name.toLowerCase()) {
      throw new ConvertError(`Expected '${name}' but found '${tok.value}'`);
    }
    return tok;
  }

  function rest() {
    skipWs();
    return src.slice(i);
  }

  function position() {
    return i;
  }

  function setPosition(pos) {
    i = pos;
  }

  return {
    next,
    peekToken,
    expect,
    expectIdent,
    skipWs,
    eof,
    rest,
    position,
    setPosition,
    get source() {
      return src;
    },
  };
}

/**
 * Strip common wrappers: EVALUATE, DEFINE ... EVALUATE, outer parentheses.
 * @param {string} text
 */
export function stripDaxWrappers(text) {
  let s = String(text ?? "").trim();
  // remove DEFINE ... before EVALUATE (keep after EVALUATE)
  const evaluateMatch = s.match(/\bEVALUATE\b/i);
  if (evaluateMatch && evaluateMatch.index !== undefined) {
    s = s.slice(evaluateMatch.index + evaluateMatch[0].length).trim();
  }
  // unwrap a single outer paren pair repeatedly
  while (s.startsWith("(") && s.endsWith(")")) {
    const inner = s.slice(1, -1).trim();
    if (!balancedParens(s)) break;
    s = inner;
  }
  return s;
}

/**
 * Extract the expression after `in` from a let…in query when present.
 * @param {string} text
 */
export function stripMLetWrapper(text) {
  let s = String(text ?? "").trim();
  if (!/^\s*let\b/i.test(s)) return s;
  const inMatch = s.match(/\bin\b/i);
  if (!inMatch || inMatch.index === undefined) return s;
  // Prefer returning the full let…in for Binary.FromText (needs Source step).
  // Callers that only need the final expression can take after `in`.
  return s;
}

/** @param {string} s */
function balancedParens(s) {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          i += 1;
        } else {
          inStr = false;
        }
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") {
      depth -= 1;
      if (depth < 0) return false;
      if (depth === 0 && i !== s.length - 1) return false;
    }
  }
  return depth === 0;
}

/**
 * Escape a DAX/M double-quoted string.
 * @param {string} value
 */
export function quoteString(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/**
 * Format a cell for DAX literals.
 * @param {string | number | boolean | null} value
 * @param {"text" | "number" | "logical"} type
 */
export function formatDaxLiteral(value, type) {
  if (type === "logical") return value ? "TRUE" : "FALSE";
  if (type === "number") {
    if (value === null || value === undefined || value === "") return "BLANK()";
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : "BLANK()";
  }
  if (value === null || value === undefined) return '""';
  return quoteString(String(value));
}

/**
 * Format a cell for M literals.
 * @param {string | number | boolean | null} value
 * @param {"text" | "number" | "logical"} type
 */
export function formatMLiteral(value, type) {
  if (type === "logical") return value ? "true" : "false";
  if (type === "number") {
    if (value === null || value === undefined || value === "") return "null";
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : "null";
  }
  if (value === null || value === undefined) return '""';
  return quoteString(String(value));
}

/**
 * M field name: bare if safe, else #"Name".
 * @param {string} name
 */
export function formatMFieldName(name) {
  const n = String(name);
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) return n;
  return `#"${n.replace(/"/g, '""')}"`;
}
