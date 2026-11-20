// GET /api/stock -> { "<variant key>": count }. Variants without a KV entry are made to order and omitted.
import { json } from "../_lib.js";

export async function onRequestGet({ env }) {
  if (!env.STOCK) return json({});
  const out = {};
  let cursor;
  do {
    const page = await env.STOCK.list({ prefix: "stock:", cursor });
    const values = await Promise.all(page.keys.map(k => env.STOCK.get(k.name)));
    page.keys.forEach((k, i) => {
      const n = parseInt(values[i], 10);
      if (Number.isFinite(n)) out[k.name.slice(6)] = n;
    });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return json(out, 200, { "Cache-Control": "public, max-age=30" });
}
