// Run with `npm test` after `npm run build` (the build writes functions/_catalog.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import * as checkout from "../functions/api/checkout.js";
import * as webhook from "../functions/api/stripe-webhook.js";
import * as stockFn from "../functions/api/stock.js";
import * as subscribe from "../functions/api/subscribe.js";
import catalog from "../functions/_catalog.js";

function kv(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, String(v)); },
    async list({ prefix = "" } = {}) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
  };
}
const post = (url, body, headers = {}) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const P = slug => catalog.products.find(p => p.slug === slug);

let lastStripe;
globalThis.fetch = async (url, init) => {
  lastStripe = { url, params: new URLSearchParams(init.body.toString()) };
  return new Response(JSON.stringify({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" }), { status: 200 });
};

test("checkout builds a Stripe session with server-side prices", async () => {
  const arch = P("arch-acrylic-bookmark"), tee = P("breathe-in-tee");
  const res = await checkout.onRequestPost({
    request: post("https://thedaffodillane.com/api/checkout", { items: [
      { id: arch.id, options: { Lettering: "Serif", Finish: "Tassel" }, personalization: "Maya", qty: 2 },
      { id: tee.id, options: { Fit: "Oversized", Color: "Mint" }, qty: 1 }
    ] }),
    env: { STRIPE_SECRET_KEY: "sk_test_x", STOCK: kv() }
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).url, "https://checkout.stripe.com/c/pay/cs_test_1");
  const p = lastStripe.params;
  assert.equal(p.get("line_items[0][price_data][unit_amount]"), String(arch.price));
  assert.equal(p.get("line_items[0][quantity]"), "2");
  assert.match(p.get("line_items[0][price_data][product_data][description]"), /Lettering: Serif · Finish: Tassel · Name: Maya/);
  // subtotal 2*15 + 35 = $65 -> free shipping
  assert.equal(p.get("shipping_options[0][shipping_rate_data][fixed_amount][amount]"), "0");
  assert.equal(p.get("custom_fields[0][key]"), "giftmessage");
  assert.equal(p.get("allow_promotion_codes"), "true");
  assert.equal(p.get("success_url"), "https://thedaffodillane.com/thanks/?session_id={CHECKOUT_SESSION_ID}");
});

test("checkout charges flat shipping under the threshold", async () => {
  const g = P("gentle-reminders-bookmark");
  await checkout.onRequestPost({ request: post("https://x.test/api/checkout", { items: [{ id: g.id, options: { Style: "Rest" }, qty: 1 }] }), env: { STRIPE_SECRET_KEY: "sk", STOCK: kv() } });
  assert.equal(lastStripe.params.get("shipping_options[0][shipping_rate_data][fixed_amount][amount]"), String(catalog.shop.shipping.flatCents));
});

test("checkout rejects bad input", async () => {
  const env = { STRIPE_SECRET_KEY: "sk", STOCK: kv() };
  const g = P("gentle-reminders-bookmark"), arch = P("arch-acrylic-bookmark");
  const cases = [
    { items: [] },
    { items: [{ id: "nope", options: {}, qty: 1 }] },
    { items: [{ id: g.id, options: { Style: "Fake" }, qty: 1 }] },
    { items: [{ id: g.id, options: { Style: "Rest" }, qty: 0 }] },
    { items: [{ id: g.id, options: { Style: "Rest" }, qty: 99 }] },
    { items: [{ id: arch.id, options: { Lettering: "Serif", Finish: "Ribbon" }, personalization: "   ", qty: 1 }] }
  ];
  for (const body of cases) {
    const res = await checkout.onRequestPost({ request: post("https://x.test/api/checkout", body), env });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test("checkout enforces tracked stock and records it for the webhook", async () => {
  const s = P("self-care-token");
  const key = `${s.id}|Color=Sage`;
  const env = { STRIPE_SECRET_KEY: "sk", STOCK: kv({ ["stock:" + key]: "1" }) };
  let res = await checkout.onRequestPost({ request: post("https://x.test/api/checkout", { items: [{ id: s.id, options: { Color: "Sage" }, qty: 2 }] }), env });
  assert.equal(res.status, 409);
  res = await checkout.onRequestPost({ request: post("https://x.test/api/checkout", { items: [{ id: s.id, options: { Color: "Sage" }, qty: 1 }] }), env });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(lastStripe.params.get("metadata[stock_0]")), [[key, 1]]);
});

function signed(secret, payload, t = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${sig}`;
}

test("webhook verifies signature and lowers stock once", async () => {
  const secret = "whsec_test";
  const key = "abc|Color=Sage";
  const STOCK = kv({ ["stock:" + key]: "5" });
  const event = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "paid", amount_total: 1700, metadata: { stock_0: JSON.stringify([[key, 2]]) } } } });
  const env = { STRIPE_WEBHOOK_SECRET: secret, STOCK };
  let res = await webhook.onRequestPost({ request: post("https://x.test/api/stripe-webhook", event, { "Stripe-Signature": "t=1,v1=bad" }), env });
  assert.equal(res.status, 400);
  res = await webhook.onRequestPost({ request: post("https://x.test/api/stripe-webhook", event, { "Stripe-Signature": signed(secret, event) }), env });
  assert.equal(res.status, 200);
  assert.equal(await STOCK.get("stock:" + key), "3");
  await webhook.onRequestPost({ request: post("https://x.test/api/stripe-webhook", event, { "Stripe-Signature": signed(secret, event) }), env });
  assert.equal(await STOCK.get("stock:" + key), "3", "duplicate delivery must not lower stock twice");
  const old = signed(secret, event, Math.floor(Date.now() / 1000) - 1000);
  res = await webhook.onRequestPost({ request: post("https://x.test/api/stripe-webhook", event, { "Stripe-Signature": old }), env });
  assert.equal(res.status, 400, "stale timestamps are rejected");
});

test("stock lists only stock: keys", async () => {
  const res = await stockFn.onRequestGet({ env: { STOCK: kv({ "stock:a|x=1": "4", "sub:me@x.com": "{}", "order:cs": "{}" }) } });
  assert.deepEqual(await res.json(), { "a|x=1": 4 });
});

test("subscribe validates and stores emails", async () => {
  const STOCK = kv();
  let res = await subscribe.onRequestPost({ request: post("https://x.test/api/subscribe", { email: "nope" }), env: { STOCK } });
  assert.equal(res.status, 400);
  res = await subscribe.onRequestPost({ request: post("https://x.test/api/subscribe", { email: " Reader@Example.com ", source: "home" }), env: { STOCK } });
  assert.equal(res.status, 200);
  assert.ok(await STOCK.get("sub:reader@example.com"));
  res = await subscribe.onRequestPost({ request: post("https://x.test/api/subscribe", { email: "bot@example.com", company: "spam" }), env: { STOCK } });
  assert.equal(res.status, 200);
  assert.equal(await STOCK.get("sub:bot@example.com"), null);
});
