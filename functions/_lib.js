// Shared helpers for Pages Functions.
import catalog from "./_catalog.js";

export { catalog };

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });

// Must match variantKey() in src/app.js: "<id>|<opt>=<val>;<opt>=<val>" with option names sorted.
export function variantKey(id, options) {
  return id + "|" + Object.keys(options).sort().map(k => k + "=" + options[k]).join(";");
}

// Strips control characters and trims; keeps ordinary punctuation and accents.
export function cleanText(s, max) {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export async function readStock(env, key) {
  if (!env.STOCK) return Infinity;
  const v = await env.STOCK.get("stock:" + key);
  if (v === null) return Infinity; // not tracked: made to order
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : Infinity;
}
