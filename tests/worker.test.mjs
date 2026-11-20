// `npm test` builds first (writes src/version.js), then runs these against the Worker with an in-memory KV.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker from "../src/worker.js";
import seed from "../catalog.json" with { type: "json" };

function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, { v: typeof v === "string" ? v : JSON.stringify(v) }]));
  return {
    m,
    async get(k, o) { const e = m.get(k); if (!e) return null; const t = typeof o === "string" ? o : o?.type; return t === "json" ? JSON.parse(e.v) : e.v; },
    async getWithMetadata(k) { const e = m.get(k); return { value: e ? e.v : null, metadata: e?.meta ?? null }; },
    async put(k, v, o = {}) { m.set(k, { v: v instanceof ArrayBuffer ? v : String(v), meta: o.metadata }); },
    async delete(k) { m.delete(k); },
    async list({ prefix = "" } = {}) { return { keys: [...m.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }; }
  };
}
const ORIGIN = "https://thedaffodillane.com";
const call = (env, path, init = {}) => worker.fetch(new Request(ORIGIN + path, init), env);
const post = (env, path, body, headers = {}) => call(env, path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const P = slug => seed.products.find(p => p.slug === slug);
const newEnv = (extra = {}) => ({ SHOP: kv(), SITE_URL: ORIGIN, ADMIN_PASSWORD: "correct horse", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_test", ...extra });

let lastStripe;
globalThis.fetch = async (url, init) => {
  lastStripe = { url, params: new URLSearchParams(init.body.toString()) };
  return new Response(JSON.stringify({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" }), { status: 200 });
};

async function signIn(env) {
  const res = await post(env, "/api/admin/login", { password: "correct horse" });
  assert.equal(res.status, 200);
  const cookie = res.headers.get("Set-Cookie").split(";")[0];
  return (path, init = {}) => call(env, path, { ...init, headers: { Cookie: cookie, "X-Requested-With": "dl-admin", "Content-Type": "application/json", ...(init.headers || {}) } });
}

test("storefront pages render from the seeded catalog", async () => {
  const env = newEnv();
  for (const path of ["/", "/shop/", "/gifts/nurses/", "/products/arch-acrylic-bookmark/", "/faq/", "/bulk-orders/"]) {
    const res = await call(env, path);
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), /Daffodil Lane/);
  }
  assert.equal((await call(env, "/nope")).status, 404);
  assert.equal((await call(env, "/shop")).headers.get("Location"), ORIGIN + "/shop/");
  assert.match(await (await call(env, "/feeds/google-merchant.xml")).text(), /<g:id>arch-acrylic-bookmark<\/g:id>/);
  assert.equal((await call(env, "/x", { headers: {} }).then(() => worker.fetch(new Request("https://www.thedaffodillane.com/shop/"), env))).status, 301);
});

test("checkout builds a Stripe session with server-side prices and packed items", async () => {
  const env = newEnv();
  const arch = P("arch-acrylic-bookmark"), tee = P("breathe-in-tee");
  const res = await post(env, "/api/checkout", { items: [
    { id: arch.id, options: { Lettering: "Serif", Finish: "Tassel" }, personalization: "Maya", qty: 2 },
    { id: tee.id, options: { Fit: "Oversized", Color: "Mint" }, qty: 1 }
  ] });
  assert.equal(res.status, 200);
  const p = lastStripe.params;
  assert.equal(p.get("line_items[0][price_data][unit_amount]"), String(arch.price));
  assert.match(p.get("line_items[0][price_data][product_data][description]"), /Lettering: Serif · Finish: Tassel · Name: Maya/);
  assert.equal(p.get("shipping_options[0][shipping_rate_data][fixed_amount][amount]"), "0");
  assert.equal(JSON.parse(p.get("metadata[items_0]")).length, 2);
});

test("checkout rejects bad input, hidden products and oversold stock", async () => {
  const env = newEnv();
  const g = P("gentle-reminders-bookmark"), s = P("self-care-token");
  for (const body of [{ items: [] }, { items: [{ id: "nope", options: {}, qty: 1 }] }, { items: [{ id: g.id, options: { Style: "Fake" }, qty: 1 }] }, { items: [{ id: g.id, options: { Style: "Rest" }, qty: 0 }] }]) {
    assert.equal((await post(env, "/api/checkout", body)).status, 400, JSON.stringify(body));
  }
  await env.SHOP.put(`stock:${s.id}|Color=Sage`, "1");
  assert.equal((await post(env, "/api/checkout", { items: [{ id: s.id, options: { Color: "Sage" }, qty: 2 }] })).status, 409);
  assert.equal((await call(env, "/api/checkout", { method: "POST", body: "{}" , headers: {"Content-Type":"application/json"}})).status, 400);
  assert.equal((await post(newEnv({ STRIPE_SECRET_KEY: undefined }), "/api/checkout", { items: [] })).status, 503);
});

const sign = (secret, payload, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;

test("paid webhook lowers tracked stock once and logs the order", async () => {
  const env = newEnv();
  const s = P("self-care-token"), arch = P("arch-acrylic-bookmark");
  await env.SHOP.put(`stock:${s.id}|Color=Sage`, "5");
  const items = JSON.stringify([[s.id, 2, { Color: "Sage" }, ""], [arch.id, 1, { Lettering: "Script", Finish: "Ribbon" }, "Ana"]]);
  const event = JSON.stringify({ type: "checkout.session.completed", data: { object: {
    id: "cs_1", created: 1795000000, payment_status: "paid", amount_total: 3900, amount_subtotal: 3900, currency: "usd",
    total_details: { amount_shipping: 0, amount_discount: 0 }, metadata: { items_0: items },
    customer_details: { email: "a@b.com", name: "Ana B" },
    collected_information: { shipping_details: { name: "Ana B", address: { line1: "1 Main", city: "El Paso", state: "TX", postal_code: "79901", country: "US" } } },
    custom_fields: [{ key: "giftmessage", text: { value: "Happy birthday!" } }, { key: "makernotes", text: { value: null } }]
  } } });
  assert.equal((await post(env, "/api/stripe-webhook", event, { "Stripe-Signature": "t=1,v1=bad" })).status, 400);
  assert.equal((await post(env, "/api/stripe-webhook", event, { "Stripe-Signature": sign("whsec_test", event) })).status, 200);
  await post(env, "/api/stripe-webhook", event, { "Stripe-Signature": sign("whsec_test", event) });
  assert.equal(await env.SHOP.get(`stock:${s.id}|Color=Sage`), "3", "stock lowered exactly once");
  const admin = await signIn(env);
  const { orders } = await (await admin("/api/admin/orders")).json();
  assert.equal(orders.length, 1);
  assert.equal(orders[0].giftMessage, "Happy birthday!");
  assert.equal(orders[0].items[1].personalization, "Ana");
  assert.equal(orders[0].shipTo.city, "El Paso");
  assert.equal((await admin("/api/admin/orders/" + encodeURIComponent(orders[0].key), { method: "PATCH", body: JSON.stringify({ status: "shipped" }) })).status, 200);
});

test("dashboard requires the password and blocks cross-site writes", async () => {
  const env = newEnv();
  assert.equal((await call(env, "/api/admin/catalog")).status, 401);
  assert.equal((await post(env, "/api/admin/login", { password: "wrong" })).status, 401);
  assert.equal((await post(newEnv({ ADMIN_PASSWORD: undefined }), "/api/admin/login", { password: "" })).status, 503);
  const admin = await signIn(env);
  assert.equal((await admin("/api/admin/catalog")).status, 200);
  const noHeader = await call(env, "/api/admin/stock", { method: "PUT", headers: { Cookie: (await post(env, "/api/admin/login", { password: "correct horse" })).headers.get("Set-Cookie").split(";")[0] }, body: "{}" });
  assert.equal(noHeader.status, 400);
  const forged = await call(env, "/api/admin/catalog", { headers: { Cookie: "dl_admin=9999999999999.forged" } });
  assert.equal(forged.status, 401);
});

test("dashboard adds a product with photo and stock, and the shop shows it", async () => {
  const env = newEnv();
  const admin = await signIn(env);
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
  const up = await admin("/api/admin/images", { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
  const { url } = await up.json();
  assert.match(url, /^\/media\/[0-9a-f-]{36}$/);
  assert.equal((await call(env, url)).headers.get("Content-Type"), "image/png");

  const product = { name: "Sunflower Pin", price: 1400, collection: "keychains", description: "Enamel pin.", images: [url], options: [{ name: "Color", values: ["Gold", "Silver"] }], tags: ["self-care", "bogus"], featured: true, active: true };
  const created = await (await admin("/api/admin/products", { method: "POST", body: JSON.stringify({ product }) })).json();
  assert.equal(created.product.slug, "sunflower-pin");
  assert.deepEqual(created.product.tags, ["self-care"]);
  const id = created.product.id;
  await admin("/api/admin/products/" + id, { method: "PUT", body: JSON.stringify({ product: created.product, stock: { [`${id}|Color=Gold`]: 4, [`${id}|Color=Silver`]: 0, "evil|x=1": 9 } }) });
  const stock = await (await call(env, "/api/stock")).json();
  assert.equal(stock[`${id}|Color=Gold`], 4);
  assert.equal(stock["evil|x=1"], undefined);

  const page = await call(env, "/products/sunflower-pin/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Sunflower Pin/);
  assert.match(await (await call(env, "/gifts/self-care/")).text(), /Sunflower Pin/);

  // Sold-out variant can't be bought
  assert.equal((await post(env, "/api/checkout", { items: [{ id, options: { Color: "Silver" }, qty: 1 }] })).status, 409);

  // Validation
  assert.equal((await admin("/api/admin/products", { method: "POST", body: JSON.stringify({ product: { ...product, images: [] } }) })).status, 400);
  assert.equal((await admin("/api/admin/products", { method: "POST", body: JSON.stringify({ product: { ...product, price: 0 } }) })).status, 400);

  // Hide, then delete
  await admin("/api/admin/products/" + id, { method: "PUT", body: JSON.stringify({ product: { ...created.product, active: false } }) });
  assert.equal((await call(env, "/products/sunflower-pin/")).status, 404);
  assert.equal((await admin("/api/admin/products/" + id, { method: "DELETE" })).status, 200);
  assert.equal((await (await call(env, "/api/stock")).json())[`${id}|Color=Gold`], undefined);
});

test("settings, sign-ups and CSV export", async () => {
  const env = newEnv();
  const admin = await signIn(env);
  const r = await admin("/api/admin/settings", { method: "PUT", body: JSON.stringify({ announcement: { enabled: true, text: "Hello there", link: "javascript:alert(1)", linkText: "x", until: "2999-01-01" }, shipping: { flatCents: 600, freeOverCents: 5000 } }) });
  const { catalog } = await r.json();
  assert.equal(catalog.shop.announcement.link, "", "unsafe link dropped");
  assert.match(await (await call(env, "/")).text(), /Hello there/);
  await post(env, "/api/subscribe", { email: "Reader@Example.com", source: "home" });
  await post(env, "/api/subscribe", { email: "=cmd@evil.com", source: "home" });
  const csv = await (await admin("/api/admin/subscribers?format=csv")).text();
  assert.match(csv, /reader@example.com/);
  assert.match(csv, /'=cmd@evil.com/, "formula injection neutralised");
});
