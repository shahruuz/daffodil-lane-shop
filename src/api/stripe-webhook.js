// POST /api/stripe-webhook  (Stripe event: checkout.session.completed, checkout.session.async_payment_succeeded)
// Verifies Stripe's signature, then lowers stock for tracked variants once per paid session.
import { json, variantKey, getCatalog } from "../lib.js";

const TOLERANCE_SECONDS = 300;

async function hmacHex(secret, payload) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verify(secret, header, body, now = Math.floor(Date.now() / 1000)) {
  let t = null;
  const sigs = [];
  for (const part of String(header || "").split(",")) {
    const i = part.indexOf("=");
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    if (k === "v1") sigs.push(v);
  }
  if (!t || !sigs.length || Math.abs(now - Number(t)) > TOLERANCE_SECONDS) return false;
  const expected = await hmacHex(secret, `${t}.${body}`);
  return sigs.some(s => safeEqual(s, expected));
}

export async function stripeWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "not configured" }, 503);
  const body = await request.text();
  if (!(await verify(env.STRIPE_WEBHOOK_SECRET, request.headers.get("Stripe-Signature"), body))) {
    return json({ error: "bad signature" }, 400);
  }

  const event = JSON.parse(body);
  const handled = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];
  if (!handled.includes(event.type)) return json({ received: true });

  const s = event.data.object;
  if (s.payment_status !== "paid") return json({ received: true });

  const doneKey = "done:" + s.id;
  if (await env.SHOP.get(doneKey)) return json({ received: true, duplicate: true });

  const meta = s.metadata || {};
  let packed = "";
  for (let n = 0; meta["items_" + n] !== undefined; n++) packed += meta["items_" + n];
  let lines = [];
  try { lines = packed ? JSON.parse(packed) : []; } catch { lines = []; }

  // Lower stock for variants that are tracked (have a count); made-to-order variants have none.
  const need = {};
  for (const [id, qty, options] of lines) {
    const key = variantKey(id, options || {});
    need[key] = (need[key] || 0) + Number(qty);
  }
  for (const [key, qty] of Object.entries(need)) {
    const cur = await env.SHOP.get("stock:" + key);
    if (cur === null) continue;
    await env.SHOP.put("stock:" + key, String(Math.max(0, parseInt(cur, 10) - qty)));
  }

  // Order log for the dashboard. Key sorts newest first.
  const catalog = await getCatalog(env, { fresh: true });
  const byId = Object.fromEntries(catalog.products.map(p => [p.id, p]));
  const field = k => (s.custom_fields || []).find(f => f.key === k)?.text?.value || "";
  const ship = s.collected_information?.shipping_details || s.shipping_details || null;
  const created = (s.created || Math.floor(Date.now() / 1000)) * 1000;
  const order = {
    id: s.id,
    createdAt: new Date(created).toISOString(),
    status: "new",
    email: s.customer_details?.email || "",
    name: s.customer_details?.name || ship?.name || "",
    shipTo: ship ? { name: ship.name, ...ship.address } : null,
    items: lines.map(([id, qty, options, personalization]) => ({
      id, qty, options: options || {}, personalization: personalization || "",
      name: byId[id]?.name || "(removed product)", price: byId[id]?.price ?? null
    })),
    giftMessage: field("giftmessage"),
    makerNotes: field("makernotes"),
    subtotal: s.amount_subtotal, shipping: s.total_details?.amount_shipping ?? null, discount: s.total_details?.amount_discount ?? 0,
    total: s.amount_total, currency: s.currency
  };
  const orderKey = `order:${String(9999999999999 - created).padStart(13, "0")}:${s.id}`;
  await env.SHOP.put(orderKey, JSON.stringify(order));
  await env.SHOP.put(doneKey, orderKey, { expirationTtl: 60 * 60 * 24 * 120 });
  return json({ received: true });
}
