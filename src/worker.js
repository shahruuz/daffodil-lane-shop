// Daffodil Lane: storefront, checkout, Stripe webhook and the owner's dashboard in one Worker.
// Static files (styles, scripts, dashboard page) are served from ./static by the assets binding before this runs.
import { createSite } from "./site.js";
import version from "./version.js";
import { json, getCatalog, allStock } from "./lib.js";
import { checkout } from "./api/checkout.js";
import { stripeWebhook } from "./api/stripe-webhook.js";
import { subscribe } from "./api/subscribe.js";
import { admin } from "./api/admin.js";

const REDIRECTS = {
  "/collections": "/shop/", "/collections/": "/shop/", "/products": "/shop/", "/products/": "/shop/",
  "/gift-guide": "/gifts/", "/gift-guides": "/gifts/", "/contact": "/faq/", "/bulk": "/bulk-orders/",
  "/wholesale": "/bulk-orders/", "/admin": "/admin/"
};

// One rendered site per catalog revision, kept for the life of this isolate.
let cached = { rev: -1, site: null };
async function siteFor(env, origin) {
  const catalog = await getCatalog(env);
  if (cached.rev !== catalog.rev || cached.origin !== origin) {
    cached = { rev: catalog.rev, origin, site: createSite({ catalog, siteUrl: env.SITE_URL || origin, version }) };
  }
  return cached.site;
}

const pageHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "public, max-age=0, s-maxage=60",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN"
};

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Send www to the bare domain.
  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
    return Response.redirect(url.toString(), 301);
  }

  if (path.startsWith("/api/")) {
    if (path === "/api/checkout") return method === "POST" ? checkout(request, env) : json({ error: "Use POST." }, 405, { Allow: "POST" });
    if (path === "/api/stripe-webhook") return method === "POST" ? stripeWebhook(request, env) : json({ error: "Use POST." }, 405, { Allow: "POST" });
    if (path === "/api/subscribe") return method === "POST" ? subscribe(request, env) : json({ error: "Use POST." }, 405, { Allow: "POST" });
    if (path === "/api/stock") return json(await allStock(env), 200, { "Cache-Control": "public, max-age=30" });
    if (path.startsWith("/api/admin/")) return admin(request, env, path);
    return json({ error: "Not found." }, 404);
  }

  if (method !== "GET" && method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });

  // Product photos uploaded from the dashboard.
  const media = path.match(/^\/media\/([0-9a-f-]{36})$/);
  if (media) {
    const { value, metadata } = await env.SHOP.getWithMetadata("img:" + media[1], { type: "arrayBuffer", cacheTtl: 86400 });
    if (!value) return new Response("Not found", { status: 404 });
    return new Response(value, { headers: { "Content-Type": metadata?.type || "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
  }

  if (REDIRECTS[path]) return Response.redirect(url.origin + REDIRECTS[path] + url.search, 301);

  const site = await siteFor(env, url.origin);
  if (site.files[path]) {
    const f = site.files[path]();
    return new Response(f.body, { headers: { "Content-Type": f.type, "Cache-Control": "public, max-age=300" } });
  }
  if (site.pages[path]) return new Response(site.pages[path](), { headers: pageHeaders });
  if (!path.endsWith("/") && site.pages[path + "/"]) return Response.redirect(url.origin + path + "/" + url.search, 301);
  return new Response(site.pages["/404.html"](), { status: 404, headers: { ...pageHeaders, "Cache-Control": "no-store" } });
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      console.log("error", request.method, new URL(request.url).pathname, err && err.stack);
      return new Response("Something went wrong. Please try again in a minute.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  }
};
