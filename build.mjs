// Builds the static storefront into ./dist from catalog.json.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const catalog = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));
const SITE_URL = process.env.SITE_URL || "https://thedaffodillane.com";
const { shop, collections, products } = catalog;

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = c => "$" + (c / 100).toFixed(c % 100 === 0 ? 0 : 2);

// Wix CDN can resize on the fly; local images (/img/...) are served as-is.
const img = (url, w) => {
  if (!url.includes("static.wixstatic.com/media/")) return url;
  const file = url.split("/").pop();
  return `${url}/v1/fill/w_${w},h_${w},al_c,q_85,enc_auto/${file}`;
};

const logo = `<svg viewBox="0 0 40 40" aria-hidden="true"><g fill="#f2c230" stroke="#1d211c" stroke-width="1.6">${
  [0, 60, 120, 180, 240, 300].map(a => `<ellipse cx="20" cy="9" rx="6" ry="9" transform="rotate(${a} 20 20)"/>`).join("")
}</g><circle cx="20" cy="20" r="6.5" fill="#d9a81a" stroke="#1d211c" stroke-width="1.6"/></svg>`;

function layout({ title, description, path, body, page = "", head = "" }) {
  const canonical = SITE_URL + path;
  const nav = collections.map(c => `<a class="collection-link" href="/collections/${c.slug}/"${path === `/collections/${c.slug}/` ? ' aria-current="page"' : ""}>${esc(c.name)}</a>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="website">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,400..800&family=Literata:opsz,wght@7..72,400;7..72,600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
${head}
</head>
<body data-page="${page}">
<a class="sr-only" href="#main">Skip to content</a>
<header class="site-head"><div class="wrap">
  <a class="brand" href="/">${logo}<span>${esc(shop.name)}</span></a>
  <nav class="nav" aria-label="Main">${nav}<a href="/shop/"${path === "/shop/" ? ' aria-current="page"' : ""}>Shop all</a>
    <button class="bag-btn" type="button" data-open-bag>Bag (<span data-bag-count>0</span>)</button></nav>
</div></header>
<main id="main">
${body}
</main>
<footer class="site-foot"><div class="wrap">
  <div><h2>${esc(shop.name)}</h2><p>${esc(shop.tagline)}</p></div>
  <div><h3>Shop</h3><ul>${collections.map(c => `<li><a href="/collections/${c.slug}/">${esc(c.name)}</a></li>`).join("")}<li><a href="/shop/">Everything</a></li></ul></div>
  <div><h3>Help</h3><ul><li><a href="/about/">Our story</a></li><li><a href="/shipping-returns/">Shipping and returns</a></li><li><a href="mailto:hello@thedaffodillane.com">hello@thedaffodillane.com</a></li></ul></div>
  <p class="fine">© ${new Date().getFullYear()} ${esc(shop.name)}. Handmade in El Paso, Texas. Payments are processed securely by Stripe.</p>
</div></footer>
<div class="scrim"></div>
<aside class="drawer" aria-label="Your bag" inert>
  <header><h2>Your bag</h2><button class="close-btn" type="button">Close</button></header>
  <div class="bag-items"></div>
  <footer>
    <div class="totals"><span>Subtotal</span><span data-subtotal>$0</span></div>
    <p class="free-ship" data-free-ship></p>
    <button class="btn btn-ink checkout-btn" type="button">Check out</button>
    <p class="checkout-err" role="alert"></p>
  </footer>
</aside>
<script>window.__CATALOG__=${JSON.stringify(catalog)};</script>
<script src="/app.js" defer></script>
</body>
</html>`;
}

function card(p) {
  return `<a class="card" href="/products/${p.slug}/" data-product-card="${p.id}">
  <div class="ph"><img src="${img(p.images[0], 700)}" alt="${esc(p.name)}" loading="lazy" width="700" height="700"></div>
  <h3>${esc(p.name)}</h3><div class="price">${money(p.price)}</div></a>`;
}

function write(path, html) {
  const file = path.endsWith("/") ? join(dist, path, "index.html") : join(dist, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

// Home
const heroImg = products.find(p => p.slug === "reading-nook-marker") || products[0];
const featured = ["arch-acrylic-bookmark", "hope-resin-charm", "nurses-need-rest", "gentle-reminders-bookmark", "self-care-token", "breathe-in-tee"]
  .map(s => products.find(p => p.slug === s)).filter(Boolean);
write("/", layout({
  title: `${shop.name}: handmade bookmarks, keychains and tees`,
  description: shop.tagline,
  path: "/",
  page: "home",
  body: `
<section class="hero"><div class="wrap">
  <div>
    <h1>Small things for slow moments.</h1>
    <p>${esc(shop.tagline)}</p>
    <div class="cta-row"><a class="btn btn-ink" href="/shop/">Shop everything</a><a class="btn btn-line" href="/collections/bookmarks/">Personalized bookmarks</a></div>
  </div>
  <div class="hero-photo"><img src="${img(heroImg.images[0], 900)}" alt="${esc(heroImg.name)}" width="900" height="900" fetchpriority="high"></div>
</div></section>
<nav class="lanes" aria-label="Collections"><ul>${collections.map(c => {
    const n = products.filter(p => p.collection === c.slug).length;
    return `<li><a href="/collections/${c.slug}/"><strong>${esc(c.name)}</strong><span>${esc(c.blurb)} ${n} designs.</span></a></li>`;
  }).join("")}</ul></nav>
<section class="section"><div class="wrap">
  <div class="section-head"><h2>Made to be given</h2><a href="/shop/">See all ${products.length}</a></div>
  <div class="grid">${featured.map(card).join("")}</div>
</div></section>
<section class="story"><div class="wrap">
  <h2>Every piece is made by hand, one order at a time.</h2>
  <div><p>Daffodil Lane started with a stack of bookmarks made for friends. Now it's a small shop of keepsakes for the people who keep everyone else going: readers, nurses, new mamas, and anyone who could use a reminder to rest.</p>
  <p><a href="/about/">Read our story</a></p></div>
</div></section>`
}));

// Shop all
write("/shop/", layout({
  title: `Shop all | ${shop.name}`,
  description: `All ${products.length} handmade bookmarks, keychains and tees from ${shop.name}.`,
  path: "/shop/",
  body: `<section class="section"><div class="wrap"><div class="section-head"><h1 class="page-title">Everything</h1><p>${products.length} designs</p></div><div class="grid">${products.map(card).join("")}</div></div></section>`
}));

// Collections
for (const c of collections) {
  const items = products.filter(p => p.collection === c.slug);
  write(`/collections/${c.slug}/`, layout({
    title: `${c.name} | ${shop.name}`,
    description: `${c.blurb} Handmade ${c.name.toLowerCase()} from ${shop.name}.`,
    path: `/collections/${c.slug}/`,
    body: `<section class="section"><div class="wrap"><div class="section-head"><h1 class="page-title">${esc(c.name)}</h1><p>${esc(c.blurb)}</p></div><div class="grid">${items.map(card).join("")}</div></div></section>`
  }));
}

// Product pages
for (const p of products) {
  const c = collections.find(x => x.slug === p.collection);
  const options = p.options.map(o => `<fieldset><legend>${esc(o.name)}</legend><div class="pills">${o.values.map((v, i) =>
    `<label><input type="radio" name="${esc(o.name)}" value="${esc(v)}"${i === 0 ? " checked" : ""}><span>${esc(v)}</span></label>`).join("")}</div></fieldset>`).join("");
  const pers = p.personalization ? `<div class="field"><label for="pers">${esc(p.personalization.label)}</label>
    <input id="pers" type="text" name="personalization" maxlength="${p.personalization.maxLength}" placeholder="${esc(p.personalization.placeholder)}" autocomplete="off">
    <p class="hint">${esc(p.personalization.note)}</p></div>` : "";
  const thumbs = p.images.length > 1 ? `<div class="thumbs">${p.images.map((u, i) =>
    `<button type="button" aria-pressed="${i === 0}" data-src="${img(u, 1000)}" aria-label="Photo ${i + 1} of ${p.images.length}"><img src="${img(u, 160)}" alt=""></button>`).join("")}</div>` : "";
  const ld = {
    "@context": "https://schema.org", "@type": "Product", name: p.name, description: p.description,
    image: p.images.map(u => img(u, 1000)), brand: { "@type": "Brand", name: shop.name },
    offers: { "@type": "Offer", priceCurrency: "USD", price: (p.price / 100).toFixed(2), availability: "https://schema.org/InStock", url: `${SITE_URL}/products/${p.slug}/` }
  };
  write(`/products/${p.slug}/`, layout({
    title: `${p.name} | ${shop.name}`,
    description: p.description,
    path: `/products/${p.slug}/`,
    head: `<meta property="og:image" content="${img(p.images[0], 1000)}"><script type="application/ld+json">${JSON.stringify(ld)}</script>`,
    body: `<div class="wrap">
<p class="crumbs"><a href="/shop/">Shop</a> / <a href="/collections/${c.slug}/">${esc(c.name)}</a></p>
<div class="pdp">
  <div class="gallery"><div class="main"><img src="${img(p.images[0], 1000)}" alt="${esc(p.name)}" width="1000" height="1000"></div>${thumbs}</div>
  <form class="buy" data-id="${p.id}">
    <h1>${esc(p.name)}</h1>
    <p class="price">${money(p.price)}</p>
    <p class="desc">${esc(p.description)}</p>
    ${options}${pers}
    <div class="qty-row">
      <div class="qty"><button type="button" data-minus aria-label="Decrease quantity">−</button><output aria-live="polite">1</output><button type="button" data-plus aria-label="Increase quantity">+</button></div>
      <button class="btn btn-ink add-btn" type="submit">Add to bag</button>
    </div>
    <p class="ship-note">Made by hand and shipped within 3 to 5 business days. Free US shipping on orders over ${money(shop.shipping.freeOverCents)}.</p>
  </form>
</div></div>`
  }));
}

// Simple pages
const simple = (path, title, html, description, page = "") =>
  write(path, layout({ title: `${title} | ${shop.name}`, description, path, page, body: `<div class="wrap"><article class="page"><h1 class="page-title">${title}</h1>${html}</article></div>` }));

simple("/about/", "Our story", `
<p>Daffodil Lane is a small, handmade shop from El Paso, Texas. It began with bookmarks made for friends and grew into a collection of keepsakes for readers, nurses, new mamas, and anyone who needs a gentle reminder to slow down.</p>
<p>Each bookmark, keychain and tee is made or finished by hand, one order at a time. If you'd like something custom, a name, a color, or a gift for a whole team, write to <a href="mailto:hello@thedaffodillane.com">hello@thedaffodillane.com</a>.</p>`,
  "The story behind Daffodil Lane, a handmade gift shop from El Paso, Texas.");

simple("/shipping-returns/", "Shipping and returns", `
<p>Orders are made by hand and ship within 3 to 5 business days. We ship within the United States. Shipping is ${money(shop.shipping.flatCents)} per order, and free on orders over ${money(shop.shipping.freeOverCents)}.</p>
<p>Personalized items can't be returned unless they arrive damaged or with a mistake on our side. For everything else, write to us within 14 days of delivery and we'll make it right.</p>
<p>Questions about an order? Email <a href="mailto:hello@thedaffodillane.com">hello@thedaffodillane.com</a> with your order number.</p>`,
  "Shipping times, costs and returns for Daffodil Lane orders.");

simple("/thanks/", "Thank you for your order", `
<p>Your payment went through, and a receipt is on its way to your email. We'll start making your order and email you when it ships.</p>
<p><a class="btn btn-ink" href="/shop/">Keep browsing</a></p>`,
  "Order confirmation.", "thanks");

write("/404.html", layout({ title: `Page not found | ${shop.name}`, description: "Page not found.", path: "/404.html",
  body: `<div class="wrap"><article class="page"><h1 class="page-title">This page isn't here.</h1><p>The link may be old or mistyped. <a href="/shop/">Browse the shop</a> instead.</p></article></div>` }));

// Static assets
copyFileSync(join(root, "src/styles.css"), join(dist, "styles.css"));
copyFileSync(join(root, "src/app.js"), join(dist, "app.js"));
writeFileSync(join(dist, "favicon.svg"), logo.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '));
if (existsSync(join(root, "public"))) cpSync(join(root, "public"), dist, { recursive: true });

const urls = ["/", "/shop/", ...collections.map(c => `/collections/${c.slug}/`), ...products.map(p => `/products/${p.slug}/`), "/about/", "/shipping-returns/"];
writeFileSync(join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${SITE_URL}${u}</loc></url>`).join("")}</urlset>\n`);
writeFileSync(join(dist, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${SITE_URL}/sitemap.xml\n`);

// Catalog module for Pages Functions (server-side price checks)
writeFileSync(join(root, "functions/_catalog.js"), "export default " + JSON.stringify(catalog) + ";\n");

console.log(`Built ${urls.length + 2} pages into dist/`);
