const BASE122_SPECIALS = [0, 10, 13, 34, 38, 92, 60];
const BASE122_REF = /@b122:([A-Za-z0-9_-]+)/g;
const MAX_PACKED_BYTES = 8 * 1024 * 1024;

let brotliReady;

export function decodeBase122(text) {
  let out = new Uint8Array(Math.max(16, Math.floor(text.length * 1.75) + 8));
  let length = 0;
  let acc = 0;
  let bits = 0;

  const emit = (symbol) => {
    let value = symbol;
    value <<= 1;
    acc |= value >>> bits;
    bits += 7;
    if (bits >= 8) {
      if (length >= out.length) {
        const next = new Uint8Array(out.length * 2);
        next.set(out);
        out = next;
      }
      out[length++] = acc;
      bits -= 8;
      acc = (value << (7 - bits)) & 255;
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 127) {
      const specialIndex = (code >>> 8) & 7;
      if (specialIndex !== 7) emit(BASE122_SPECIALS[specialIndex]);
      emit(code & 127);
    } else {
      emit(code);
    }
  }

  return out.subarray(0, length);
}

export async function unpackPlayableScripts(pkg) {
  const sources = collectSources(pkg);
  if (!sources.length) return { text: "", decoded: 0, failed: 0 };

  const chunks = [];
  let decoded = 0;
  let failed = 0;
  const seen = new Set();

  for (const html of sources) {
    for (const id of referencedIds(html)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const body = readPackedPre(html, id);
      if (body == null) continue;
      try {
        const compressed = decodeBase122(body);
        if (!compressed.length || compressed.length > MAX_PACKED_BYTES) {
          failed += 1;
          continue;
        }
        const inflated = await brotliDecompress(compressed);
        if (inflated.length > MAX_PACKED_BYTES) {
          failed += 1;
          continue;
        }
        const text = new TextDecoder("utf-8", { fatal: false }).decode(inflated);
        if (!looksLikeScript(text)) continue;
        chunks.push(text);
        decoded += 1;
      } catch {
        failed += 1;
      }
    }
  }

  return { text: chunks.join("\n/* --- unpacked base122 script --- */\n"), decoded, failed };
}

function collectSources(pkg) {
  const sources = [];
  for (const entry of pkg?.entries || []) {
    if (typeof entry?.text === "string" && entry.text.includes("@b122:")) sources.push(entry.text);
  }
  if (!sources.length && typeof pkg?.mainHtmlText === "string" && pkg.mainHtmlText.includes("@b122:")) {
    sources.push(pkg.mainHtmlText);
  }
  return sources;
}

function referencedIds(html) {
  return [...html.matchAll(BASE122_REF)].map((match) => match[1]);
}

function readPackedPre(html, id) {
  const pattern = new RegExp(
    `<pre\\b(?=[^>]*\\bid=["']${id}["'])(?=[^>]*\\bdata-base122\\b)[^>]*>([\\s\\S]*?)<\\/pre>`,
    "i",
  );
  const match = html.match(pattern);
  return match ? match[1] : null;
}

function looksLikeScript(text) {
  if (!text || text.length < 16) return false;
  const sample = text.slice(0, 8000);
  const replacementChars = sample.match(/\uFFFD/g);
  if (replacementChars && replacementChars.length > 8) return false;
  return /function\b|=>|\b(?:var|let|const)\b|ALPlayable|mraid/.test(sample);
}

async function brotliDecompress(bytes) {
  const brotli = await loadBrotli();
  return brotli.decompress(bytes);
}

function loadBrotli() {
  if (!brotliReady) {
    brotliReady = (async () => {
      const brotli = await import("./vendor/brotli-dec-wasm/pkg/brotli_dec_wasm.js");
      if (globalThis.process?.versions?.node) {
        const { readFile } = await import("node:fs/promises");
        const { fileURLToPath } = await import("node:url");
        const wasmPath = fileURLToPath(new URL("./vendor/brotli-dec-wasm/pkg/brotli_dec_wasm_bg.wasm", import.meta.url));
        await brotli.default({ module_or_path: await readFile(wasmPath) });
      } else {
        await brotli.default();
      }
      return brotli;
    })();
  }
  return brotliReady;
}
