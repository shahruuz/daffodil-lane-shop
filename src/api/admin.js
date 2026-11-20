// Dashboard API under /api/admin/*. Protected by a password the owner sets as the ADMIN_PASSWORD secret.
import { json, cleanText, getCatalog, saveCatalog, allStock, variants, variantKey } from "../lib.js";

const COOKIE = "dl_admin";
const SESSION_DAYS = 30;
const enc = new TextEncoder();

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, c => ({ "+": "-", "/": "_", "=": "" }[c]));
}
function same(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const sessionSecret = env => "session:" + env.ADMIN_PASSWORD;

async function isAuthed(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return same(sig, await hmac(sessionSecret(env), exp));
}

async function login(request, env) {
  if (!env.ADMIN_PASSWORD) return json({ error: "The dashboard password isn't set yet. Add ADMIN_PASSWORD in Cloudflare (Worker → Settings → Variables and Secrets)." }, 503);
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const rlKey = "rl:login:" + ip;
  const tries = parseInt((await env.SHOP.get(rlKey)) || "0", 10);
  if (tries >= 10) return json({ error: "Too many tries. Wait 15 minutes and try again." }, 429);
  const { password = "" } = await request.json().catch(() => ({}));
  // Compare HMACs so the comparison takes the same time whatever was typed.
  const ok = same(await hmac("pw", String(password)), await hmac("pw", env.ADMIN_PASSWORD));
  if (!ok) {
    await env.SHOP.put(rlKey, String(tries + 1), { expirationTtl: 900 });
    return json({ error: "That password didn't work." }, 401);
  }
  const exp = String(Date.now() + SESSION_DAYS * 864e5);
  const value = `${exp}.${await hmac(sessionSecret(env), exp)}`;
  return json({ ok: true }, 200, {
    "Set-Cookie": `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`
  });
}

const slugify = s => cleanText(s, 80).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";

// Validates a product sent by the dashboard and returns a clean copy, or throws a message.
function cleanProduct(input, catalog, existingId) {
  const name = cleanText(input.name, 80);
  if (!name) throw "Give the product a name.";
  const price = Math.round(Number(input.price));
  if (!(price >= 50 && price <= 1000000)) throw "Price must be between $0.50 and $10,000.";
  const collection = cleanText(input.collection, 40);
  if (!catalog.collections.some(c => c.slug === collection)) throw "Pick a collection.";
  const options = (Array.isArray(input.options) ? input.options : []).slice(0, 3).map(o => ({
    name: cleanText(o.name, 30),
    values: [...new Set((o.values || []).map(v => cleanText(v, 30)).filter(Boolean))].slice(0, 15)
  })).filter(o => o.name && o.values.length);
  if (new Set(options.map(o => o.name)).size !== options.length) throw "Two options have the same name.";
  if (options.some(o => /[|;=#]/.test(o.name) || o.values.some(v => /[|;=#]/.test(v)))) throw "Option names and values can't contain | ; = or #.";
  const images = (Array.isArray(input.images) ? input.images : []).map(u => String(u).trim())
    .filter(u => /^\/media\/[a-z0-9-]+$/i.test(u) || /^https:\/\/[^\s"'<>]+$/.test(u)).slice(0, 8);
  if (!images.length) throw "Add at least one photo.";
  let personalization = null;
  if (input.personalization) {
    const pz = input.personalization;
    personalization = {
      label: cleanText(pz.label, 40) || "Name to add",
      placeholder: cleanText(pz.placeholder, 40) || "e.g. Maya",
      maxLength: Math.min(60, Math.max(1, Math.round(Number(pz.maxLength) || 20))),
      note: cleanText(pz.note, 200)
    };
  }
  const tagsAllowed = new Set(["reader", "nurse", "mama", "self-care", "stocking", "personalized", "under-20", ...catalog.guides.map(g => g.tag)]);
  const tags = [...new Set((input.tags || []).filter(t => tagsAllowed.has(t)))];
  let slug = slugify(input.slug || name);
  const taken = new Set(catalog.products.filter(p => p.id !== existingId).map(p => p.slug));
  for (let i = 2, base = slug; taken.has(slug); i++) slug = `${base}-${i}`;
  return {
    id: existingId || crypto.randomUUID(), slug, name, collection, price,
    description: cleanText(input.description, 2000), images, options,
    ...(personalization ? { personalization } : {}),
    ...(input.preview && personalization ? { preview: true } : {}),
    tags, featured: !!input.featured, active: input.active !== false
  };
}

async function setStock(env, updates) {
  for (const [key, val] of Object.entries(updates || {})) {
    if (!/^[0-9a-f-]{36}\|/.test(key) || key.length > 400) continue;
    if (val === null || val === "") await env.SHOP.delete("stock:" + key);
    else {
      const n = Math.max(0, Math.min(100000, Math.floor(Number(val))));
      if (Number.isFinite(n)) await env.SHOP.put("stock:" + key, String(n));
    }
  }
}

async function listByPrefix(env, prefix, limit = 1000) {
  const keys = [];
  let cursor;
  do {
    const page = await env.SHOP.list({ prefix, cursor });
    keys.push(...page.keys);
    cursor = page.list_complete || keys.length >= limit ? undefined : page.cursor;
  } while (cursor);
  return keys.slice(0, limit);
}

const csvCell = v => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // keep spreadsheet apps from treating it as a formula
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function admin(request, env, path) {
  const method = request.method;
  if (path === "/api/admin/login" && method === "POST") return login(request, env);
  if (path === "/api/admin/logout" && method === "POST")
    return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
  if (path === "/api/admin/session") return json({ authed: await isAuthed(request, env), configured: !!env.ADMIN_PASSWORD });

  if (!(await isAuthed(request, env))) return json({ error: "Please sign in." }, 401);
  // Mutations must come from the dashboard page itself (with the cookie being SameSite=Strict, this blocks cross-site forms).
  if (method !== "GET" && request.headers.get("X-Requested-With") !== "dl-admin") return json({ error: "Bad request." }, 400);

  // Catalog + stock
  if (path === "/api/admin/catalog" && method === "GET") {
    const [catalog, stock] = await Promise.all([getCatalog(env, { fresh: true }), allStock(env)]);
    return json({ catalog, stock });
  }

  // Create or update a product: POST /api/admin/products, PUT /api/admin/products/<id>
  const pm = path.match(/^\/api\/admin\/products(?:\/([0-9a-f-]{36}))?$/);
  if (pm && (method === "POST" || method === "PUT")) {
    const body = await request.json().catch(() => null);
    if (!body?.product) return json({ error: "Missing product." }, 400);
    const catalog = await getCatalog(env, { fresh: true });
    const id = method === "PUT" ? pm[1] : undefined;
    if (id && !catalog.products.some(p => p.id === id)) return json({ error: "That product no longer exists." }, 404);
    let product;
    try { product = cleanProduct(body.product, catalog, id); } catch (msg) { return json({ error: String(msg) }, 400); }
    const products = id ? catalog.products.map(p => (p.id === id ? product : p)) : [...catalog.products, product];
    const saved = await saveCatalog(env, { ...catalog, products });
    // Stock: keys are rebuilt for the product's current variants. null = made to order.
    if (body.stock) {
      const valid = new Set(variants(product).map(v => variantKey(product.id, v)));
      await setStock(env, Object.fromEntries(Object.entries(body.stock).filter(([k]) => valid.has(k))));
    }
    return json({ product, rev: saved.rev });
  }
  if (pm && pm[1] && method === "DELETE") {
    const catalog = await getCatalog(env, { fresh: true });
    const products = catalog.products.filter(p => p.id !== pm[1]);
    if (products.length === catalog.products.length) return json({ error: "Not found." }, 404);
    await saveCatalog(env, { ...catalog, products });
    for (const k of await listByPrefix(env, "stock:" + pm[1] + "|")) await env.SHOP.delete(k.name);
    return json({ ok: true });
  }

  // Reorder products: PUT /api/admin/order { ids: [...] }
  if (path === "/api/admin/order" && method === "PUT") {
    const { ids = [] } = await request.json().catch(() => ({}));
    const catalog = await getCatalog(env, { fresh: true });
    const pos = new Map(ids.map((id, i) => [id, i]));
    const products = [...catalog.products].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
    await saveCatalog(env, { ...catalog, products });
    return json({ ok: true });
  }

  // Quick stock edits from the products list: PUT /api/admin/stock { "<variant key>": 5 | null }
  if (path === "/api/admin/stock" && method === "PUT") {
    await setStock(env, await request.json().catch(() => ({})));
    return json({ stock: await allStock(env) });
  }

  // Photo upload: POST /api/admin/images with the image file as the body.
  if (path === "/api/admin/images" && method === "POST") {
    const type = (request.headers.get("Content-Type") || "").split(";")[0];
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type)) return json({ error: "Use a JPG, PNG, WebP or GIF photo." }, 400);
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 8 * 1024 * 1024) return json({ error: "That photo is over 8 MB. Try a smaller one." }, 413);
    const id = crypto.randomUUID();
    await env.SHOP.put("img:" + id, buf, { metadata: { type, size: buf.byteLength, at: Date.now() } });
    return json({ url: "/media/" + id });
  }

  // Orders
  if (path === "/api/admin/orders" && method === "GET") {
    const keys = await listByPrefix(env, "order:", 200);
    const orders = await Promise.all(keys.map(async k => ({ key: k.name, ...(await env.SHOP.get(k.name, { type: "json" })) })));
    return json({ orders });
  }
  const om = path.match(/^\/api\/admin\/orders\/([^/]+)$/);
  if (om && method === "PATCH") {
    const key = decodeURIComponent(om[1]);
    if (!/^order:[0-9]+:[A-Za-z0-9_]+$/.test(key)) return json({ error: "Not found." }, 404);
    const order = await env.SHOP.get(key, { type: "json" });
    if (!order) return json({ error: "Not found." }, 404);
    const { status } = await request.json().catch(() => ({}));
    if (!["new", "making", "shipped"].includes(status)) return json({ error: "Unknown status." }, 400);
    await env.SHOP.put(key, JSON.stringify({ ...order, status, [`${status}At`]: new Date().toISOString() }));
    return json({ ok: true });
  }

  // Newsletter sign-ups
  if (path === "/api/admin/subscribers" && method === "GET") {
    const keys = await listByPrefix(env, "sub:", 5000);
    const rows = await Promise.all(keys.map(async k => ({ email: k.name.slice(4), ...(JSON.parse((await env.SHOP.get(k.name)) || "{}")) })));
    rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (new URL(request.url).searchParams.get("format") === "csv") {
      const csv = ["email,signed_up,source,country", ...rows.map(r => [r.email, r.at, r.source, r.country].map(csvCell).join(","))].join("\n");
      return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="daffodil-lane-signups.csv"', "Cache-Control": "no-store" } });
    }
    return json({ subscribers: rows });
  }

  // Shop settings: announcement bar, shipping, collections
  if (path === "/api/admin/settings" && method === "PUT") {
    const body = await request.json().catch(() => ({}));
    const catalog = await getCatalog(env, { fresh: true });
    const shop = { ...catalog.shop };
    if (body.announcement) {
      const a = body.announcement;
      shop.announcement = {
        enabled: !!a.enabled, text: cleanText(a.text, 160), link: /^\/[\w\-/]*$/.test(a.link || "") ? a.link : "",
        linkText: cleanText(a.linkText, 30), until: /^\d{4}-\d{2}-\d{2}$/.test(a.until || "") ? a.until : ""
      };
    }
    if (body.shipping) {
      const flat = Math.round(Number(body.shipping.flatCents)), free = Math.round(Number(body.shipping.freeOverCents));
      if (!(flat >= 0 && flat <= 10000 && free >= 0 && free <= 100000)) return json({ error: "Check the shipping amounts." }, 400);
      shop.shipping = { ...shop.shipping, flatCents: flat, freeOverCents: free };
    }
    let collections = catalog.collections;
    if (Array.isArray(body.collections)) {
      collections = body.collections.map(c => ({ slug: slugify(c.slug || c.name), name: cleanText(c.name, 40), blurb: cleanText(c.blurb, 160) })).filter(c => c.name);
      const inUse = new Set(catalog.products.map(p => p.collection));
      const missing = [...inUse].filter(s => !collections.some(c => c.slug === s));
      if (missing.length) return json({ error: "Move products out of a collection before removing it." }, 400);
    }
    const saved = await saveCatalog(env, { ...catalog, shop, collections });
    return json({ catalog: saved });
  }

  return json({ error: "Not found." }, 404);
}
