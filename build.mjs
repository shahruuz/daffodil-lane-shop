// Builds the static storefront into ./dist from catalog.json.
// Cloudflare Pages: build command `node build.mjs`, output directory `dist`.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const catalog = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));
const SITE_URL = process.env.SITE_URL || "https://thedaffodillane.com";
const BUILD_DATE = new Date().toISOString().slice(0, 10);
const { shop, collections, products, guides = [], faq = [] } = catalog;

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// ---------- helpers ----------
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = c => "$" + (c / 100).toFixed(c % 100 === 0 ? 0 : 2);
const byTag = t => products.filter(p => (p.tags || []).includes(t));
const ld = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
const abs = u => (u.startsWith("http") ? u : SITE_URL + u);

// Wix CDN can resize on the fly; local images (/img/...) are served as-is.
const img = (url, w) => {
  if (!url.includes("static.wixstatic.com/media/")) return url;
  const file = url.split("/").pop();
  return `${url}/v1/fill/w_${w},h_${w},al_c,q_85,enc_auto/${file}`;
};
const srcset = (url, sizes) => url.includes("static.wixstatic.com/media/") ? sizes.map(w => `${img(url, w)} ${w}w`).join(", ") : "";

const hash = f => createHash("sha256").update(readFileSync(join(root, f))).digest("hex").slice(0, 10);
const V = { css: hash("src/styles.css"), js: hash("src/app.js") };

const logo = `<svg viewBox="0 0 40 40" aria-hidden="true"><g fill="#f2c230" stroke="#1d211c" stroke-width="1.6">${
  [0, 60, 120, 180, 240, 300].map(a => `<ellipse cx="20" cy="9" rx="6" ry="9" transform="rotate(${a} 20 20)"/>`).join("")
}</g><circle cx="20" cy="20" r="6.5" fill="#d9a81a" stroke="#1d211c" stroke-width="1.6"/></svg>`;

const icons = {
  hand: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5v-6a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v5m0-2.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3.2 15.4a1.6 1.6 0 0 1 2.5-2L8 15.5"/></svg>`,
  box: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>`,
  gift: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`
};

const shipLine = `Free US shipping over ${money(shop.shipping.freeOverCents)}`;
const trust = [
  [icons.hand, `Made by hand in ${shop.city.split(",")[0]}`, "One order at a time"],
  [icons.box, `Ships in ${shop.processing}`, shipLine],
  [icons.gift, "Gift-ready", "Add a gift message at checkout"],
  [icons.lock, "Secure checkout", "Payments by Stripe"]
];
const trustStrip = `<section class="trust" aria-label="Why shop with us"><div class="wrap"><ul>${trust.map(([i, a, b]) =>
  `<li>${i}<div><strong>${esc(a)}</strong><span>${esc(b)}</span></div></li>`).join("")}</ul></div></section>`;

const announcementOn = shop.announcement?.enabled && (!shop.announcement.until || BUILD_DATE < shop.announcement.until);
const announcement = announcementOn
  ? `<div class="announce" data-until="${esc(shop.announcement.until || "")}"><div class="wrap"><p>${esc(shop.announcement.text)}${shop.announcement.link ? ` <a href="${esc(shop.announcement.link)}">${esc(shop.announcement.linkText || "Learn more")}</a>` : ""}</p></div></div>`
  : "";

const newsletter = (source, heading = "Slow mail", text = "A short note when new designs drop or a holiday deadline is coming up. No more than once or twice a month.") =>
  `<section class="letters"><div class="wrap">
  <div><h2>${esc(heading)}</h2><p>${esc(text)}</p></div>
  <form class="sub-form" data-source="${esc(source)}" novalidate>
    <label class="sr-only" for="sub-${esc(source)}">Email address</label>
    <div class="sub-row"><input id="sub-${esc(source)}" type="email" name="email" placeholder="you@example.com" autocomplete="email" required>
    <input class="hp" type="text" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button class="btn btn-ink" type="submit">Sign up</button></div>
    <p class="sub-msg" role="status"></p>
  </form>
</div></section>`;

const orgLd = {
  "@context": "https://schema.org", "@type": "OnlineStore", "@id": SITE_URL + "/#store", name: shop.name, url: SITE_URL + "/",
  logo: SITE_URL + "/favicon.svg", email: shop.email, description: shop.tagline,
  address: { "@type": "PostalAddress", addressLocality: "El Paso", addressRegion: "TX", addressCountry: "US" },
  hasMerchantReturnPolicy: { "@id": SITE_URL + "/#returns" }
};
const returnPolicy = {
  "@type": "MerchantReturnPolicy", "@id": SITE_URL + "/#returns", applicableCountry: "US",
  returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow", merchantReturnDays: shop.returnDays,
  returnMethod: "https://schema.org/ReturnByMail", returnFees: "https://schema.org/FreeReturn"
};
const shippingDetails = [
  { "@type": "OfferShippingDetails", shippingDestination: { "@type": "DefinedRegion", addressCountry: "US" },
    shippingRate: { "@type": "MonetaryAmount", value: (shop.shipping.flatCents / 100).toFixed(2), currency: "USD" },
    deliveryTime: { "@type": "ShippingDeliveryTime",
      handlingTime: { "@type": "QuantitativeValue", minValue: 3, maxValue: 5, unitCode: "DAY" },
      transitTime: { "@type": "QuantitativeValue", minValue: 2, maxValue: 5, unitCode: "DAY" } } }
];
const crumbsLd = items => ({ "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: abs(path) })) });
const faqLd = list => ({ "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: list.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });

// ---------- layout ----------
function layout({ title, description, path, body, page = "", head = "", image, jsonld = [], type = "website" }) {
  const canonical = SITE_URL + path;
  const ogImage = image || img(products.find(p => p.slug === "reading-nook-marker")?.images[0] || products[0].images[0], 1200);
  const cur = p => (path === p || (p !== "/" && path.startsWith(p)) ? ' aria-current="page"' : "");
  const nav = collections.map(c => `<a class="collection-link" href="/collections/${c.slug}/"${cur(`/collections/${c.slug}/`)}>${esc(c.name)}</a>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta name="theme-color" content="#f2c230">
<meta property="og:site_name" content="${esc(shop.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="${type}">
<meta property="og:image" content="${esc(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="preconnect" href="https://static.wixstatic.com">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,400..800&family=Literata:opsz,wght@7..72,400;7..72,600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css?v=${V.css}">
${head}
${jsonld.map(ld).join("\n")}
</head>
<body data-page="${page}">
<a class="sr-only skip" href="#main">Skip to content</a>
${announcement}
<header class="site-head"><div class="wrap">
  <a class="brand" href="/">${logo}<span>${esc(shop.name)}</span></a>
  <nav class="nav" aria-label="Main">${nav}<a href="/gifts/"${cur("/gifts/")}>Gifts</a><a href="/shop/"${cur("/shop/")}>Shop</a>
    <button class="bag-btn" type="button" data-open-bag>Bag (<span data-bag-count>0</span>)</button></nav>
</div></header>
<main id="main">
${body}
</main>
<footer class="site-foot"><div class="wrap">
  <div><h2>${esc(shop.name)}</h2><p>${esc(shop.tagline)}</p></div>
  <div><h3>Shop</h3><ul>${collections.map(c => `<li><a href="/collections/${c.slug}/">${esc(c.name)}</a></li>`).join("")}<li><a href="/shop/">Everything</a></li></ul></div>
  <div><h3>Gifts</h3><ul>${guides.map(g => `<li><a href="/gifts/${g.slug}/">${esc(g.name)}</a></li>`).join("")}<li><a href="/bulk-orders/">Team &amp; event orders</a></li></ul></div>
  <div><h3>Help</h3><ul><li><a href="/about/">Our story</a></li><li><a href="/faq/">FAQ</a></li><li><a href="/shipping-returns/">Shipping and returns</a></li><li><a href="mailto:${shop.email}">${shop.email}</a></li></ul></div>
  <p class="fine">© ${new Date().getFullYear()} ${esc(shop.name)}. Handmade in ${esc(shop.city)}. Payments are processed securely by Stripe.</p>
</div></footer>
<div class="scrim"></div>
<aside class="drawer" aria-label="Your bag" inert>
  <header><h2>Your bag</h2><button class="close-btn" type="button">Close</button></header>
  <div class="ship-meter" data-ship-meter hidden><p data-free-ship></p><div class="bar"><span></span></div></div>
  <div class="bag-items"></div>
  <div class="bag-upsell" data-upsell hidden></div>
  <footer>
    <div class="totals"><span>Subtotal</span><span data-subtotal>$0</span></div>
    <p class="fine-print">Shipping and any promo code are added at checkout. Add a gift message on the next page.</p>
    <button class="btn btn-ink checkout-btn" type="button">Check out</button>
    <p class="checkout-err" role="alert"></p>
  </footer>
</aside>
<script>window.__CATALOG__=${JSON.stringify({ shop, collections, products })};</script>
<script src="/app.js?v=${V.js}" defer></script>
</body>
</html>`;
}

function card(p, i = 0) {
  const badge = p.personalization ? `<span class="badge">Personalized</span>` : "";
  return `<a class="card" href="/products/${p.slug}/" data-product-card="${p.id}" data-collection="${p.collection}" data-tags="${(p.tags || []).join(" ")}" data-price="${p.price}" data-order="${i}">
  <div class="ph">${badge}<img src="${img(p.images[0], 700)}" srcset="${srcset(p.images[0], [400, 700, 1000])}" sizes="(max-width: 900px) 50vw, 360px" alt="${esc(p.name)}" loading="lazy" width="700" height="700"></div>
  <h3>${esc(p.name)}</h3><div class="price">${money(p.price)}</div></a>`;
}

function write(path, html) {
  const file = path.endsWith("/") ? join(dist, path, "index.html") : join(dist, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

const faqList = list => `<div class="faq">${list.map(f => `<details id="${esc(f.id)}"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</div>`;

// ---------- Home ----------
const heroImg = products.find(p => p.slug === "reading-nook-marker") || products[0];
const featured = ["arch-acrylic-bookmark", "hope-resin-charm", "nurses-need-rest", "gentle-reminders-bookmark", "self-care-token", "breathe-in-tee"]
  .map(s => products.find(p => p.slug === s)).filter(Boolean);
const guideTiles = list => `<ul class="guide-tiles">${list.map((g, i) => {
  const pics = byTag(g.tag).slice(0, 3);
  return `<li class="tone-${i % 4}"><a href="/gifts/${g.slug}/"><div class="stack">${pics.map(p => `<img src="${img(p.images[0], 300)}" alt="" loading="lazy" width="300" height="300">`).join("")}</div>
  <strong>${esc(g.name)}</strong><span>${byTag(g.tag).length} gifts</span></a></li>`;
}).join("")}</ul>`;

write("/", layout({
  title: `${shop.name}: handmade bookmarks, keychains and tees`,
  description: `${shop.tagline} Handmade in El Paso, Texas. ${shipLine}.`,
  path: "/",
  page: "home",
  jsonld: [orgLd, { "@context": "https://schema.org", "@type": "WebSite", name: shop.name, url: SITE_URL + "/" }],
  body: `
<section class="hero"><div class="wrap">
  <div class="hero-copy">
    <p class="eyebrow">Handmade in El Paso</p>
    <h1>Small things for slow moments.</h1>
    <p>${esc(shop.tagline)}</p>
    <div class="cta-row"><a class="btn btn-ink" href="/gifts/">Find a gift</a><a class="btn btn-line" href="/products/arch-acrylic-bookmark/">Personalize a bookmark</a></div>
  </div>
  <div class="hero-photo"><img src="${img(heroImg.images[0], 900)}" srcset="${srcset(heroImg.images[0], [500, 900, 1200])}" sizes="(max-width: 820px) 100vw, 520px" alt="${esc(heroImg.name)}" width="900" height="900" fetchpriority="high"></div>
</div></section>
${trustStrip}
<nav class="lanes" aria-label="Collections"><div class="wrap"><ul>${collections.map(c => {
    const n = products.filter(p => p.collection === c.slug).length;
    return `<li><a href="/collections/${c.slug}/"><strong>${esc(c.name)}</strong><span>${esc(c.blurb)} ${n} designs.</span></a></li>`;
  }).join("")}</ul></div></nav>
<section class="section"><div class="wrap">
  <div class="section-head"><h2>Made to be given</h2><a href="/shop/">See all ${products.length}</a></div>
  <div class="grid">${featured.map(card).join("")}</div>
</div></section>
<section class="section section-tint"><div class="wrap">
  <div class="section-head"><h2>Shop by who it's for</h2><a href="/gifts/">All gift guides</a></div>
  ${guideTiles(guides)}
</div></section>
<section class="story"><div class="wrap">
  <h2>Every piece is made by hand, one order at a time.</h2>
  <div><p>Daffodil Lane started with a stack of bookmarks made for friends. Now it's a small shop of keepsakes for the people who keep everyone else going: readers, nurses, new mamas, and anyone who could use a reminder to rest.</p>
  <p><a href="/about/">Read our story</a></p></div>
</div></section>
${newsletter("home")}`
}));

// ---------- Shop all (with filters) ----------
const filterChips = [["all", "Everything"], ...collections.map(c => ["c:" + c.slug, c.name]), ...guides.map(g => ["t:" + g.tag, g.name])];
write("/shop/", layout({
  title: `Shop all handmade gifts | ${shop.name}`,
  description: `All ${products.length} handmade bookmarks, keychains and tees from ${shop.name}. ${shipLine}.`,
  path: "/shop/",
  page: "shop",
  jsonld: [crumbsLd([["Home", "/"], ["Shop", "/shop/"]])],
  body: `<section class="section"><div class="wrap">
  <div class="section-head"><h1 class="page-title">Everything</h1><p data-result-count>${products.length} designs</p></div>
  <div class="filters" role="group" aria-label="Filter products">
    <div class="chips">${filterChips.map(([v, l], i) => `<button type="button" class="chip" data-filter="${v}" aria-pressed="${i === 0}">${esc(l)}</button>`).join("")}</div>
    <label class="sort"><span>Sort</span><select data-sort><option value="featured">Featured</option><option value="price-asc">Price, low to high</option><option value="price-desc">Price, high to low</option></select></label>
  </div>
  <div class="grid" data-shop-grid>${products.map(card).join("")}</div>
  <p class="empty-note" data-empty hidden>Nothing matches that yet. <button type="button" class="linklike" data-filter="all">Show everything</button></p>
</div></section>`
}));

// ---------- Collections ----------
for (const c of collections) {
  const items = products.filter(p => p.collection === c.slug);
  const related = guides.filter(g => items.some(p => (p.tags || []).includes(g.tag)));
  write(`/collections/${c.slug}/`, layout({
    title: `Handmade ${c.name.toLowerCase()} | ${shop.name}`,
    description: `${c.blurb} Handmade ${c.name.toLowerCase()} from ${shop.name} in El Paso, Texas. ${shipLine}.`,
    path: `/collections/${c.slug}/`,
    image: img(items[0].images[0], 1200),
    jsonld: [crumbsLd([["Home", "/"], ["Shop", "/shop/"], [c.name, `/collections/${c.slug}/`]])],
    body: `<section class="section"><div class="wrap"><div class="section-head"><h1 class="page-title">${esc(c.name)}</h1><p>${esc(c.blurb)}</p></div>
  <div class="grid">${items.map(card).join("")}</div>
  ${related.length ? `<p class="also">Shopping for someone? ${related.map(g => `<a href="/gifts/${g.slug}/">${esc(g.name.toLowerCase())}</a>`).join(" · ")}</p>` : ""}
</div></section>`
  }));
}

// ---------- Gift guides ----------
write("/gifts/", layout({
  title: `Handmade gift guides | ${shop.name}`,
  description: `Gift ideas for nurses, new moms, book lovers and anyone who needs a reminder to rest. Handmade in El Paso. ${shipLine}.`,
  path: "/gifts/",
  jsonld: [crumbsLd([["Home", "/"], ["Gifts", "/gifts/"]])],
  body: `<section class="section"><div class="wrap">
  <div class="section-head stacked"><h1 class="page-title">Gift guides</h1><p>Small handmade gifts, sorted by who you're shopping for.</p></div>
  ${guideTiles(guides)}
</div></section>
${trustStrip}`
}));

for (const g of guides) {
  const items = byTag(g.tag);
  const gFaq = faq.filter(f => ["timing", "holiday", "gift", "shipping"].includes(f.id));
  write(`/gifts/${g.slug}/`, layout({
    title: `${g.title}: handmade and made to order | ${shop.name}`,
    description: `${g.intro.split(". ")[0]}. ${items.length} handmade gift ideas from El Paso. ${shipLine}.`,
    path: `/gifts/${g.slug}/`,
    image: img(items[0].images[0], 1200),
    jsonld: [
      crumbsLd([["Home", "/"], ["Gifts", "/gifts/"], [g.title, `/gifts/${g.slug}/`]]),
      { "@context": "https://schema.org", "@type": "ItemList", name: g.title,
        itemListElement: items.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE_URL}/products/${p.slug}/`, name: p.name })) },
      faqLd(gFaq)
    ],
    body: `<section class="guide-hero"><div class="wrap">
  <p class="crumbs"><a href="/gifts/">Gift guides</a></p>
  <h1>${esc(g.title)}</h1>
  <p>${esc(g.intro)}</p>
</div></section>
<section class="section"><div class="wrap">
  <div class="grid">${items.map(card).join("")}</div>
  ${g.tip ? `<aside class="tip"><p>${esc(g.tip)}</p><a class="btn btn-line" href="${esc(g.tipLink)}">${esc(g.tipLinkText)}</a></aside>` : ""}
</div></section>
<section class="section section-tint"><div class="wrap narrow">
  <h2 class="h2">Good to know</h2>
  ${faqList(gFaq)}
</div></section>
<section class="section"><div class="wrap">
  <div class="section-head"><h2>More gift guides</h2></div>
  ${guideTiles(guides.filter(x => x.slug !== g.slug))}
</div></section>`
  }));
}

// ---------- Product pages ----------
function related(p) {
  const score = q => (q.tags || []).filter(t => (p.tags || []).includes(t)).length + (q.collection !== p.collection ? 0.5 : 0);
  return products.filter(q => q.id !== p.id).sort((a, b) => score(b) - score(a) || a.price - b.price).slice(0, 3);
}

for (const p of products) {
  const c = collections.find(x => x.slug === p.collection);
  const options = p.options.map(o => `<fieldset><legend>${esc(o.name)}: <span data-chosen>${esc(o.values[0])}</span></legend><div class="pills">${o.values.map((v, i) =>
    `<label><input type="radio" name="${esc(o.name)}" value="${esc(v)}"${i === 0 ? " checked" : ""}><span>${esc(v)}</span></label>`).join("")}</div></fieldset>`).join("");
  const pers = p.personalization ? `<div class="field"><label for="pers">${esc(p.personalization.label)}</label>
    <input id="pers" type="text" name="personalization" maxlength="${p.personalization.maxLength}" placeholder="${esc(p.personalization.placeholder)}" autocomplete="off" data-count-target="pers-count">
    <p class="hint">${esc(p.personalization.note)} <span id="pers-count" class="count" aria-live="polite"></span></p></div>` : "";
  const preview = p.preview ? `<figure class="preview" aria-label="Lettering preview">
    <svg viewBox="0 0 160 300" role="img" aria-labelledby="pv-title"><title id="pv-title">Preview of your name on the bookmark</title>
      <defs><linearGradient id="acr" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#fff8dc"/><stop offset="1" stop-color="#f6e7b0"/></linearGradient></defs>
      <path d="M20 290V80a60 60 0 0 1 120 0v210Z" fill="url(#acr)" stroke="#1d211c" stroke-width="2"/>
      <circle cx="80" cy="44" r="7" fill="#fff" stroke="#1d211c" stroke-width="2"/>
      <g data-finish><path data-ribbon d="M80 37c-8-20-30-26-34-14M80 37c8-22 26-30 32-18" fill="none" stroke="#d98c8c" stroke-width="5" stroke-linecap="round"/>
      <g data-tassel hidden><path d="M80 37v-6" stroke="#2e5233" stroke-width="3"/><path d="M80 30c-6-8-10-22-6-28M80 30c0-10 0-20 0-28M80 30c6-8 10-22 6-28" fill="none" stroke="#2e5233" stroke-width="3" stroke-linecap="round"/></g></g>
      <text data-pv-text x="80" y="190" text-anchor="middle" transform="rotate(-90 80 190)" font-size="30" fill="#1d211c">Maya</text>
    </svg>
    <figcaption>Preview only. Your bookmark is lettered by hand.</figcaption></figure>` : "";
  const thumbs = p.images.length > 1 ? `<div class="thumbs">${p.images.map((u, i) =>
    `<button type="button" aria-pressed="${i === 0}" data-src="${img(u, 1000)}" aria-label="Photo ${i + 1} of ${p.images.length}"><img src="${img(u, 160)}" alt=""></button>`).join("")}</div>` : "";
  const productLd = {
    "@context": "https://schema.org", "@type": "Product", "@id": `${SITE_URL}/products/${p.slug}/#product`,
    name: p.name, description: p.description, sku: p.slug, category: c.name,
    image: p.images.map(u => img(u, 1000)), brand: { "@type": "Brand", name: shop.name },
    offers: { "@type": "Offer", priceCurrency: "USD", price: (p.price / 100).toFixed(2), availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition", url: `${SITE_URL}/products/${p.slug}/`, seller: { "@id": SITE_URL + "/#store" },
      shippingDetails, hasMerchantReturnPolicy: returnPolicy }
  };
  const rel = related(p);
  write(`/products/${p.slug}/`, layout({
    title: `${p.name}, handmade ${c.name.toLowerCase().replace(/s$/, "")} | ${shop.name}`,
    description: `${p.description} ${money(p.price)}. Made by hand in El Paso.`.slice(0, 300),
    path: `/products/${p.slug}/`,
    page: "product",
    type: "product",
    image: img(p.images[0], 1200),
    head: `<meta property="product:price:amount" content="${(p.price / 100).toFixed(2)}"><meta property="product:price:currency" content="USD">${p.preview ? `<link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&display=swap" rel="stylesheet">` : ""}`,
    jsonld: [productLd, crumbsLd([["Home", "/"], ["Shop", "/shop/"], [c.name, `/collections/${c.slug}/`], [p.name, `/products/${p.slug}/`]])],
    body: `<div class="wrap">
<p class="crumbs"><a href="/shop/">Shop</a> / <a href="/collections/${c.slug}/">${esc(c.name)}</a></p>
<div class="pdp">
  <div class="gallery"><div class="main"><img src="${img(p.images[0], 1000)}" srcset="${srcset(p.images[0], [600, 1000, 1400])}" sizes="(max-width: 860px) 100vw, 600px" alt="${esc(p.name)}" width="1000" height="1000"></div>${thumbs}</div>
  <form class="buy" data-id="${p.id}">
    <h1>${esc(p.name)}</h1>
    <p class="price">${money(p.price)}</p>
    <p class="desc">${esc(p.description)}</p>
    ${options}${pers}${preview}
    <div class="qty-row">
      <div class="qty"><button type="button" data-minus aria-label="Decrease quantity">−</button><output aria-live="polite">1</output><button type="button" data-plus aria-label="Increase quantity">+</button></div>
      <button class="btn btn-ink add-btn" type="submit">Add to bag · ${money(p.price)}</button>
    </div>
    <ul class="mini-trust"><li>${icons.hand} Made by hand, ships in ${esc(shop.processing)}</li><li>${icons.box} ${shipLine}</li><li>${icons.gift} Add a gift message at checkout</li></ul>
    <div class="accordion">
      <details open><summary>Details</summary><p>${esc(p.description)}</p>${p.options.length ? `<p>Options: ${p.options.map(o => `${esc(o.name.toLowerCase())} (${o.values.map(esc).join(", ")})`).join("; ")}.</p>` : ""}</details>
      <details><summary>Shipping and returns</summary><p>Made to order and shipped within ${esc(shop.processing)} inside the US. Shipping is ${money(shop.shipping.flatCents)}, or free on orders over ${money(shop.shipping.freeOverCents)}. If anything arrives damaged or wrong, email us within ${shop.returnDays} days and we'll make it right. <a href="/shipping-returns/">Full policy</a></p></details>
      <details><summary>Sending it as a gift</summary><p>Enter the recipient's address at checkout and write your note in the gift message box. We'll include it with the order.</p></details>
    </div>
  </form>
</div>
<section class="section related"><div class="section-head"><h2>Pairs well with</h2><a href="/collections/${c.slug}/">More ${esc(c.name.toLowerCase())}</a></div>
  <div class="grid">${rel.map(card).join("")}</div></section>
</div>
<div class="sticky-buy" aria-hidden="true"><div><strong>${esc(p.name)}</strong><span>${money(p.price)}</span></div><button class="btn btn-ink" type="button" data-sticky-add tabindex="-1">Add to bag</button></div>`
  }));
}

// ---------- Simple pages ----------
const simple = (path, title, html, description, page = "", extra = {}) =>
  write(path, layout({ title: `${title} | ${shop.name}`, description, path, page, ...extra, body: `<div class="wrap"><article class="page"><h1 class="page-title">${title}</h1>${html}</article></div>${extra.after || ""}` }));

simple("/about/", "Our story", `
<p>Daffodil Lane is a small, handmade shop from El Paso, Texas. It began with bookmarks made for friends and grew into a collection of keepsakes for readers, nurses, new mamas, and anyone who needs a gentle reminder to slow down.</p>
<p>Each bookmark, keychain and tee is made or finished by hand, one order at a time. If you'd like something custom, a name, a color, or a gift for a whole team, write to <a href="mailto:${shop.email}">${shop.email}</a> or see <a href="/bulk-orders/">team and event orders</a>.</p>`,
  "The story behind Daffodil Lane, a handmade gift shop from El Paso, Texas.", "", { after: newsletter("about") });

simple("/shipping-returns/", "Shipping and returns", `
<p>Orders are made by hand and ship within ${esc(shop.processing)}. We ship within the United States. Shipping is ${money(shop.shipping.flatCents)} per order, and free on orders over ${money(shop.shipping.freeOverCents)}.</p>
<p>Personalized items can't be returned unless they arrive damaged or with a mistake on our side. For everything else, write to us within ${shop.returnDays} days of delivery and we'll make it right.</p>
<p>Questions about an order? Email <a href="mailto:${shop.email}">${shop.email}</a> with your order number.</p>`,
  "Shipping times, costs and returns for Daffodil Lane orders.");

simple("/faq/", "Questions, answered", faqList(faq) + `<p class="after-faq">Still wondering about something? Email <a href="mailto:${shop.email}">${shop.email}</a>.</p>`,
  "Shipping times, holiday deadlines, gift messages, personalization and returns at Daffodil Lane.", "", { jsonld: [faqLd(faq)] });

simple("/bulk-orders/", "Team and event orders", `
<p class="lede">Matching keepsakes for a nurse unit, a baby shower, a book club, a classroom or a small business. Tell us what you have in mind and we'll reply with options and a quote, usually within two business days.</p>
<form class="bulk-form" data-bulk novalidate>
  <div class="two"><div class="field"><label for="b-name">Your name</label><input id="b-name" name="name" type="text" autocomplete="name" required></div>
  <div class="field"><label for="b-email">Email</label><input id="b-email" name="email" type="email" autocomplete="email" required></div></div>
  <div class="two"><div class="field"><label for="b-what">What for</label><select id="b-what" name="occasion"><option>Nurse or hospital unit</option><option>Baby shower</option><option>Book club</option><option>School or teachers</option><option>Business or event</option><option>Something else</option></select></div>
  <div class="field"><label for="b-qty">About how many</label><input id="b-qty" name="quantity" type="number" min="5" step="1" inputmode="numeric" placeholder="e.g. 25"></div></div>
  <div class="two"><div class="field"><label for="b-items">Which items interest you</label><input id="b-items" name="items" type="text" placeholder="e.g. Stethoscope Heart Tag, names on each"></div>
  <div class="field"><label for="b-date">Needed by</label><input id="b-date" name="date" type="date"></div></div>
  <div class="field"><label for="b-notes">Anything else</label><textarea id="b-notes" name="notes" rows="4" placeholder="Names, colors, budget, delivery address city"></textarea></div>
  <button class="btn btn-ink" type="submit">Write the email</button>
  <p class="hint">This opens your email app with everything filled in, addressed to ${shop.email}. Nothing is sent until you press send.</p>
</form>`,
  "Matching handmade keepsakes for nurse units, baby showers, book clubs, schools and events. Request a quote from Daffodil Lane.", "bulk");

simple("/thanks/", "Thank you for your order", `
<p>Your payment went through, and a receipt is on its way to your email. We'll start making your order and email you when it ships.</p>
<p><a class="btn btn-ink" href="/shop/">Keep browsing</a></p>`,
  "Order confirmation.", "thanks", { after: newsletter("thanks", "While you wait", "Get a short note when new designs drop. We'll never share your email.") });

write("/404.html", layout({ title: `Page not found | ${shop.name}`, description: "Page not found.", path: "/404.html",
  body: `<div class="wrap"><article class="page"><h1 class="page-title">This page isn't here.</h1><p>The link may be old or mistyped. <a href="/shop/">Browse the shop</a> or see the <a href="/gifts/">gift guides</a>.</p></article></div>` }));

// ---------- Static assets ----------
cpSync(join(root, "src/styles.css"), join(dist, "styles.css"));
cpSync(join(root, "src/app.js"), join(dist, "app.js"));
writeFileSync(join(dist, "favicon.svg"), logo.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '));
writeFileSync(join(dist, "manifest.webmanifest"), JSON.stringify({
  name: shop.name, short_name: shop.name, start_url: "/", display: "browser", background_color: "#ffffff", theme_color: "#f2c230",
  icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }]
}, null, 2));
if (existsSync(join(root, "public"))) cpSync(join(root, "public"), dist, { recursive: true });

writeFileSync(join(dist, "_headers"), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Frame-Options: SAMEORIGIN
/styles.css
  Cache-Control: public, max-age=31536000, immutable
/app.js
  Cache-Control: public, max-age=31536000, immutable
/feeds/*
  Cache-Control: public, max-age=3600
`);
writeFileSync(join(dist, "_redirects"), `/collections /shop/ 301
/collections/ /shop/ 301
/products /shop/ 301
/products/ /shop/ 301
/gift-guide /gifts/ 301
/gift-guides /gifts/ 301
/contact /faq/ 301
/bulk /bulk-orders/ 301
/wholesale /bulk-orders/ 301
`);

// Google Merchant Center / Pinterest product feed (RSS 2.0 with g: namespace).
const gCategory = { bookmarks: "Office Supplies > Book Accessories > Bookmarks", keychains: "Apparel & Accessories > Handbag & Wallet Accessories > Keychains", apparel: "Apparel & Accessories > Clothing > Shirts & Tops" };
const x = s => esc(s);
mkdirSync(join(dist, "feeds"), { recursive: true });
writeFileSync(join(dist, "feeds/google-merchant.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>
<title>${x(shop.name)}</title><link>${SITE_URL}/</link><description>${x(shop.tagline)}</description>
${products.flatMap(p => {
  // Apparel is listed once per color and size so Google gets the attributes it requires for clothing.
  const colorOpt = p.options.find(o => /colou?r/i.test(o.name));
  const sizeOpt = p.options.find(o => o.name === "Size");
  if (p.collection !== "apparel") return [[p, null, null]];
  return (colorOpt ? colorOpt.values : [null]).flatMap(col => (sizeOpt ? sizeOpt.values : [null]).map(sz => [p, col, sz]));
}).map(([p, color, size]) => {
  const c = collections.find(cc => cc.slug === p.collection);
  const apparel = p.collection === "apparel";
  const id = [p.slug, color, size].filter(Boolean).join("-").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  return `<item>
<g:id>${x(id)}</g:id><g:title>${x(`${p.name} - Handmade ${c.name.replace(/s$/, "")}${color ? ", " + color : ""}${size ? ", size " + size : ""}`)}</g:title>
<g:description>${x(p.description)}</g:description><g:link>${SITE_URL}/products/${p.slug}/</g:link>
<g:image_link>${x(img(p.images[0], 1200))}</g:image_link>${p.images.slice(1, 10).map(u => `<g:additional_image_link>${x(img(u, 1200))}</g:additional_image_link>`).join("")}
<g:availability>in_stock</g:availability><g:price>${(p.price / 100).toFixed(2)} USD</g:price><g:condition>new</g:condition>
<g:brand>${x(shop.name)}</g:brand><g:identifier_exists>no</g:identifier_exists><g:google_product_category>${x(gCategory[p.collection] || "")}</g:google_product_category>
<g:product_type>${x(c.name)}</g:product_type>${apparel ? `<g:item_group_id>${x(p.slug)}</g:item_group_id><g:age_group>adult</g:age_group><g:gender>unisex</g:gender>` : ""}${color ? `<g:color>${x(color)}</g:color>` : ""}${size ? `<g:size>${x(size)}</g:size>` : ""}
<g:shipping><g:country>US</g:country><g:price>${(shop.shipping.flatCents / 100).toFixed(2)} USD</g:price></g:shipping>
</item>`;
}).join("\n")}
</channel></rss>
`);

const urls = ["/", "/shop/", ...collections.map(c => `/collections/${c.slug}/`), "/gifts/", ...guides.map(g => `/gifts/${g.slug}/`),
  ...products.map(p => `/products/${p.slug}/`), "/about/", "/faq/", "/bulk-orders/", "/shipping-returns/"];
writeFileSync(join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${SITE_URL}${u}</loc><lastmod>${BUILD_DATE}</lastmod></url>`).join("")}</urlset>\n`);
writeFileSync(join(dist, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /thanks/\nSitemap: ${SITE_URL}/sitemap.xml\n`);

// Catalog module for Pages Functions (server-side price checks)
writeFileSync(join(root, "functions/_catalog.js"), "export default " + JSON.stringify(catalog) + ";\n");

console.log(`Built ${urls.length + 2} pages and a product feed into dist/`);
