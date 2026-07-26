/**
 * Deflate-raw + base64 helpers for M Binary.FromText / Binary.Decompress.
 * Browser: CompressionStream / DecompressionStream.
 * Node: zlib deflateRaw / inflateRaw (fallback when streams are unavailable).
 */

import { ConvertError } from "./model.js";

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function deflateRawToBase64(bytes) {
  if (typeof CompressionStream === "function") {
    const stream = new Blob([bytes]).stream().pipeThrough(
      new CompressionStream("deflate-raw")
    );
    const ab = await new Response(stream).arrayBuffer();
    return bytesToBase64(new Uint8Array(ab));
  }

  const { deflateRawSync } = await import("node:zlib");
  return bytesToBase64(new Uint8Array(deflateRawSync(bytes)));
}

/**
 * @param {string} b64
 * @returns {Promise<Uint8Array>}
 */
export async function inflateRawFromBase64(b64) {
  const compressed = base64ToBytes(b64);

  if (typeof DecompressionStream === "function") {
    try {
      const stream = new Blob([compressed])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      const ab = await new Response(stream).arrayBuffer();
      return new Uint8Array(ab);
    } catch {
      // fall through to zlib
    }
  }

  const zlib = await import("node:zlib");
  try {
    return new Uint8Array(zlib.inflateRawSync(compressed));
  } catch {
    try {
      return new Uint8Array(zlib.inflateSync(compressed));
    } catch {
      throw new ConvertError("Failed to decompress Binary.FromText payload");
    }
  }
}

/** @param {Uint8Array} bytes */
function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(binary);
  }
  // Node without btoa — encode via hex round-trip avoided; use latin1 Buffer via dynamic import sync not possible
  // Manual base64:
  return encodeBase64Manual(bytes);
}

/** @param {string} b64 */
function base64ToBytes(b64) {
  const cleaned = String(b64).replace(/\s+/g, "");
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(cleaned);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
  return decodeBase64Manual(cleaned);
}

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** @param {Uint8Array} bytes */
function encodeBase64Manual(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += B64[(triple >> 18) & 63];
    out += B64[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[triple & 63] : "=";
  }
  return out;
}

/** @param {string} b64 */
function decodeBase64Manual(b64) {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const outLen = Math.floor((clean.length * 3) / 4) - padding;
  const out = new Uint8Array(Math.max(0, outLen));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0;
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (triple >> 16) & 255;
    if (o < out.length) out[o++] = (triple >> 8) & 255;
    if (o < out.length) out[o++] = triple & 255;
  }
  return out;
}

/**
 * Encode a JSON-serializable value as Power BI Enter Data base64 payload.
 * @param {unknown} jsonValue
 */
export async function encodeJsonDeflateBase64(jsonValue) {
  const json = JSON.stringify(jsonValue);
  const bytes = new TextEncoder().encode(json);
  return deflateRawToBase64(bytes);
}

/**
 * @param {string} b64
 * @returns {Promise<unknown>}
 */
export async function decodeJsonDeflateBase64(b64) {
  const bytes = await inflateRawFromBase64(b64);
  const text = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new ConvertError("Decompressed Binary.FromText payload is not valid JSON");
  }
}
