// Shared helpers: responses, catalog storage, stock.
import seedCatalog from "../catalog.json" with { type: "json" };

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });

// Must match variantKey() in static/app.js and static/admin/admin.js:
// "<id>|<opt>=<val>;<opt>=<val>" with option names sorted.
export function variantKey(id, options) {
  return id + "|" + Object.keys(options).sort().map(k => k + "=" + options[k]).join(";");
}

// Every combination of a product's option values (one empty combination when it has no options).
export function variants(p) {
  return p.options.reduce((acc, o) => acc.flatMap(a => o.values.map(v => ({ ...a, [o.name]: v }))), [{}]);
}

// Strips control characters and trims; keeps ordinary punctuation and accents.
export function cleanText(s, max) {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

const CATALOG_KEY = "catalog";

// The catalog lives in KV so the dashboard can change it. First run seeds it from catalog.json.
export async function getCatalog(env, { fresh = false } = {}) {
  let cat = await env.SHOP.get(CATALOG_KEY, fresh ? { type: "json" } : { type: "json", cacheTtl: 30 });
  if (!cat) {
    cat = { ...seedCatalog, rev: 1 };
    await env.SHOP.put(CATALOG_KEY, JSON.stringify(cat));
  }
  return cat;
}

export async function saveCatalog(env, cat) {
  const next = { ...cat, rev: (cat.rev || 0) + 1, updatedAt: new Date().toISOString() };
  await env.SHOP.put(CATALOG_KEY, JSON.stringify(next));
  return next;
}

export async function readStock(env, key) {
  const v = await env.SHOP.get("stock:" + key);
  if (v === null) return Infinity; // not tracked: made to order
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : Infinity;
}

export async function allStock(env) {
  const out = {};
  let cursor;
  do {
    const page = await env.SHOP.list({ prefix: "stock:", cursor });
    const values = await Promise.all(page.keys.map(k => env.SHOP.get(k.name)));
    page.keys.forEach((k, i) => {
      const n = parseInt(values[i], 10);
      if (Number.isFinite(n)) out[k.name.slice(6)] = n;
    });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
