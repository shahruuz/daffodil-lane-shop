// POST /api/checkout  { items: [{ id, options, personalization, qty }] }  ->  { url }
// Prices, options and stock are checked here against the catalog; the browser's numbers are never trusted.
import { catalog, json, variantKey, cleanText, readStock } from "../_lib.js";

const MAX_LINES = 30;
const MAX_QTY = 20;

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: "Checkout isn't set up yet." }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: "That request didn't look right." }, 400); }
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) return json({ error: "Your bag is empty." }, 400);
  if (items.length > MAX_LINES) return json({ error: "That's a lot of items. Email us for a team order." }, 400);

  const byId = Object.fromEntries(catalog.products.map(p => [p.id, p]));
  const lines = [];
  const stockNeed = {}; // tracked variant key -> qty
  let subtotal = 0;

  for (const raw of items) {
    const p = byId[raw?.id];
    if (!p) return json({ error: "One of the items in your bag is no longer available. Please remove it and try again." }, 400);

    const qty = Math.floor(Number(raw.qty));
    if (!(qty >= 1 && qty <= MAX_QTY)) return json({ error: `Please choose between 1 and ${MAX_QTY} of ${p.name}.` }, 400);

    const options = {};
    for (const o of p.options) {
      const v = raw.options?.[o.name];
      if (!o.values.includes(v)) return json({ error: `Please choose a ${o.name.toLowerCase()} for ${p.name}.` }, 400);
      options[o.name] = v;
    }

    let personalization = "";
    if (p.personalization) {
      personalization = cleanText(raw.personalization, p.personalization.maxLength);
      if (!personalization) return json({ error: `Please add the name for your ${p.name}.` }, 400);
    }

    const key = variantKey(p.id, options);
    stockNeed[key] = (stockNeed[key] || 0) + qty;
    subtotal += p.price * qty;
    lines.push({ p, options, personalization, qty, key });
  }

  for (const [key, need] of Object.entries(stockNeed)) {
    const have = await readStock(env, key);
    if (need > have) {
      const p = byId[key.split("|")[0]];
      return json({ error: have > 0 ? `Only ${have} of ${p.name} left in that option.` : `${p.name} is sold out in that option.` }, 409);
    }
  }

  const origin = new URL(request.url).origin;
  const ship = catalog.shop.shipping;
  const free = subtotal >= ship.freeOverCents;
  const f = new URLSearchParams();
  const set = (k, v) => f.append(k, String(v));

  set("mode", "payment");
  set("success_url", `${origin}/thanks/?session_id={CHECKOUT_SESSION_ID}`);
  set("cancel_url", `${origin}/shop/?checkout=cancelled`);
  set("allow_promotion_codes", "true");
  set("billing_address_collection", "auto");
  ship.countries.forEach((c, i) => set(`shipping_address_collection[allowed_countries][${i}]`, c));

  set("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
  set("shipping_options[0][shipping_rate_data][display_name]", free ? "Free US shipping" : "US shipping");
  set("shipping_options[0][shipping_rate_data][fixed_amount][amount]", free ? 0 : ship.flatCents);
  set("shipping_options[0][shipping_rate_data][fixed_amount][currency]", catalog.shop.currency);
  set("shipping_options[0][shipping_rate_data][delivery_estimate][minimum][unit]", "business_day");
  set("shipping_options[0][shipping_rate_data][delivery_estimate][minimum][value]", 5);
  set("shipping_options[0][shipping_rate_data][delivery_estimate][maximum][unit]", "business_day");
  set("shipping_options[0][shipping_rate_data][delivery_estimate][maximum][value]", 10);

  set("custom_fields[0][key]", "giftmessage");
  set("custom_fields[0][label][type]", "custom");
  set("custom_fields[0][label][custom]", "Gift message (optional)");
  set("custom_fields[0][type]", "text");
  set("custom_fields[0][optional]", "true");
  set("custom_fields[0][text][maximum_length]", 255);
  set("custom_fields[1][key]", "makernotes");
  set("custom_fields[1][label][type]", "custom");
  set("custom_fields[1][label][custom]", "Notes for the maker (colors etc.)");
  set("custom_fields[1][type]", "text");
  set("custom_fields[1][optional]", "true");
  set("custom_fields[1][text][maximum_length]", 255);

  lines.forEach((l, i) => {
    const desc = [...Object.entries(l.options).map(([k, v]) => `${k}: ${v}`), l.personalization && `Name: ${l.personalization}`]
      .filter(Boolean).join(" · ");
    const pre = `line_items[${i}]`;
    set(`${pre}[quantity]`, l.qty);
    set(`${pre}[price_data][currency]`, catalog.shop.currency);
    set(`${pre}[price_data][unit_amount]`, l.p.price);
    set(`${pre}[price_data][product_data][name]`, l.p.name);
    if (desc) set(`${pre}[price_data][product_data][description]`, desc);
    if (l.p.images[0]?.startsWith("https://")) set(`${pre}[price_data][product_data][images][0]`, l.p.images[0]);
    set(`${pre}[price_data][product_data][metadata][variant]`, l.key.slice(0, 500));
    if (l.personalization) set(`${pre}[price_data][product_data][metadata][personalization]`, l.personalization);
  });

  // Stock to lower after payment, only for tracked variants. Split across metadata keys (500 chars each).
  const tracked = [];
  for (const key of Object.keys(stockNeed)) if ((await readStock(env, key)) !== Infinity) tracked.push([key, stockNeed[key]]);
  const packed = JSON.stringify(tracked);
  for (let i = 0, n = 0; i < packed.length && n < 20; i += 480, n++) set(`metadata[stock_${n}]`, packed.slice(i, i + 480));

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: f
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) {
    console.log("stripe error", res.status, data?.error?.message);
    return json({ error: "Checkout is unavailable right now." }, 502);
  }
  return json({ url: data.url });
}

export function onRequest() {
  return json({ error: "Use POST." }, 405, { Allow: "POST" });
}
