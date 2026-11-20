// POST /api/stripe-webhook  (Stripe event: checkout.session.completed, checkout.session.async_payment_succeeded)
// Verifies Stripe's signature, then lowers stock for tracked variants once per paid session.
import { json } from "../_lib.js";

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

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "not configured" }, 503);
  const body = await request.text();
  if (!(await verify(env.STRIPE_WEBHOOK_SECRET, request.headers.get("Stripe-Signature"), body))) {
    return json({ error: "bad signature" }, 400);
  }

  const event = JSON.parse(body);
  const handled = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];
  if (!handled.includes(event.type)) return json({ received: true });

  const session = event.data.object;
  if (session.payment_status !== "paid" || !env.STOCK) return json({ received: true });

  const doneKey = "order:" + session.id;
  if (await env.STOCK.get(doneKey)) return json({ received: true, duplicate: true });

  const meta = session.metadata || {};
  let packed = "";
  for (let n = 0; meta["stock_" + n] !== undefined; n++) packed += meta["stock_" + n];
  let tracked = [];
  try { tracked = packed ? JSON.parse(packed) : []; } catch { tracked = []; }

  for (const [key, qty] of tracked) {
    const cur = await env.STOCK.get("stock:" + key);
    if (cur === null) continue;
    const next = Math.max(0, parseInt(cur, 10) - Number(qty));
    await env.STOCK.put("stock:" + key, String(next));
  }
  await env.STOCK.put(doneKey, JSON.stringify({ at: new Date().toISOString(), total: session.amount_total }), { expirationTtl: 60 * 60 * 24 * 90 });
  return json({ received: true });
}
