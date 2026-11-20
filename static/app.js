(function () {
  const CATALOG = window.__CATALOG__;
  const SHIP = CATALOG.shop.shipping;
  const byId = Object.fromEntries(CATALOG.products.map(p => [p.id, p]));
  const KEY = "dl-bag-v1";
  const money = c => "$" + (c / 100).toFixed(c % 100 === 0 ? 0 : 2);
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  let stock = {};
  let bag = load();

  function load() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
    // Keep saved bags valid when the catalog changes: drop removed products, refresh prices, fill new options.
    return saved.filter(i => byId[i.id]).map(i => {
      const p = byId[i.id];
      const options = {};
      p.options.forEach(o => { options[o.name] = o.values.includes((i.options || {})[o.name]) ? i.options[o.name] : o.values[0]; });
      const key = variantKey(p.id, options) + (i.personalization ? "#" + i.personalization : "");
      return Object.assign({}, i, { name: p.name, price: p.price, image: p.images[0], options, key });
    });
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(bag)); } catch (e) { /* storage unavailable */ }
    render();
  }
  function variantKey(id, options) {
    return id + "|" + Object.keys(options).sort().map(k => k + "=" + options[k]).join(";");
  }
  function available(key) {
    return Object.prototype.hasOwnProperty.call(stock, key) ? stock[key] : Infinity;
  }
  function imgUrl(url, w) {
    if (url.indexOf("static.wixstatic.com/media/") === -1) return url;
    const file = url.split("/").pop();
    return url + "/v1/fill/w_" + w + ",h_" + w + ",al_c,q_85,enc_auto/" + file;
  }

  // Announcement bar hides itself once its date passes, even before the next build.
  const ann = $(".announce");
  if (ann && ann.dataset.until && new Date().toISOString().slice(0, 10) >= ann.dataset.until) ann.remove();

  // Bag drawer
  const drawer = $(".drawer");
  const countEls = $$("[data-bag-count]");
  const itemsEl = $(".bag-items");
  const subtotalEl = $("[data-subtotal]");
  const meter = $("[data-ship-meter]");
  const freeEl = $("[data-free-ship]");
  const upsellEl = $("[data-upsell]");
  const errEl = $(".checkout-err");
  const checkoutBtn = $(".checkout-btn");
  let lastFocus = null;

  function openBag() {
    lastFocus = document.activeElement;
    document.body.classList.add("bag-open");
    drawer.removeAttribute("inert");
    $(".close-btn", drawer).focus();
  }
  function closeBag() {
    const wasOpen = document.body.classList.contains("bag-open");
    document.body.classList.remove("bag-open");
    drawer.setAttribute("inert", "");
    if (wasOpen && lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $$("[data-open-bag]").forEach(b => b.addEventListener("click", openBag));
  $(".scrim").addEventListener("click", closeBag);
  $(".close-btn", drawer).addEventListener("click", closeBag);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeBag(); });

  function upsell(subtotal) {
    const inBag = new Set(bag.map(i => i.id));
    const left = SHIP.freeOverCents - subtotal;
    const pool = CATALOG.products.filter(p => !inBag.has(p.id)).sort((a, b) => a.price - b.price);
    if (!pool.length || left <= 0) return null;
    return pool.find(p => p.price >= left) || pool[pool.length - 1];
  }

  function render() {
    const count = bag.reduce((n, i) => n + i.qty, 0);
    countEls.forEach(el => (el.textContent = count));
    const subtotal = bag.reduce((n, i) => n + i.price * i.qty, 0);
    subtotalEl.textContent = money(subtotal);
    if (!bag.length) {
      itemsEl.innerHTML = '<p class="bag-empty">Your bag is empty. Not sure where to start? Try the <a href="/gifts/">gift guides</a>.</p>';
      meter.hidden = true;
      upsellEl.hidden = true;
      checkoutBtn.disabled = true;
      return;
    }
    checkoutBtn.disabled = false;
    meter.hidden = false;
    const left = SHIP.freeOverCents - subtotal;
    freeEl.textContent = left > 0
      ? "You're " + money(left) + " away from free shipping. Otherwise shipping is " + money(SHIP.flatCents) + "."
      : "Your order ships free.";
    $(".bar span", meter).style.width = Math.min(100, Math.round((subtotal / SHIP.freeOverCents) * 100)) + "%";

    const u = upsell(subtotal);
    if (u) {
      upsellEl.hidden = false;
      upsellEl.innerHTML = '<img alt="" src="' + imgUrl(u.images[0], 160) + '"><p></p><a class="btn btn-line">See it</a>';
      const p = $("p", upsellEl);
      const strong = document.createElement("strong");
      strong.textContent = u.name;
      p.append("Add a ", strong, " (" + money(u.price) + ")" + (u.price >= left ? " and shipping is free." : " to get closer to free shipping."));
      $("a", upsellEl).href = "/products/" + u.slug + "/";
    } else upsellEl.hidden = true;

    itemsEl.innerHTML = "";
    bag.forEach((item, idx) => {
      const opts = Object.entries(item.options).map(([k, v]) => k + ": " + v);
      if (item.personalization) opts.push("Name: " + item.personalization);
      const row = document.createElement("div");
      row.className = "bag-item";
      row.innerHTML =
        '<img alt="" src="' + imgUrl(item.image, 160) + '">' +
        "<div><h3></h3><div class=\"meta\"></div>" +
        '<div class="line-qty"><button type="button" aria-label="Remove one">−</button><span></span>' +
        '<button type="button" aria-label="Add one">+</button><button type="button" class="remove">Remove</button></div></div>' +
        "<div>" + money(item.price * item.qty) + "</div>";
      $("h3", row).textContent = item.name;
      $(".meta", row).textContent = opts.join(", ");
      $(".line-qty span", row).textContent = item.qty;
      const [minus, plus, remove] = $$("button", row);
      minus.addEventListener("click", () => { item.qty -= 1; if (item.qty < 1) bag.splice(idx, 1); save(); });
      plus.addEventListener("click", () => {
        if (item.qty + 1 > available(variantKey(item.id, item.options))) return toast("Only " + available(variantKey(item.id, item.options)) + " left");
        item.qty += 1; save();
      });
      remove.addEventListener("click", () => { bag.splice(idx, 1); save(); });
      itemsEl.appendChild(row);
    });
  }

  function toast(msg) {
    let t = $(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove("show"), 2400);
  }

  // Checkout
  checkoutBtn.addEventListener("click", async () => {
    errEl.textContent = "";
    checkoutBtn.disabled = true;
    checkoutBtn.textContent = "Opening secure checkout…";
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: bag.map(i => ({ id: i.id, options: i.options, personalization: i.personalization || "", qty: i.qty })) })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || "Checkout is unavailable right now.");
      window.location.href = data.url;
    } catch (err) {
      errEl.textContent = err.message + " Please try again in a minute.";
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = "Check out";
    }
  });
  // Restore the button if the visitor comes back with the browser's back button.
  window.addEventListener("pageshow", () => { checkoutBtn.textContent = "Check out"; render(); });

  const params = new URLSearchParams(location.search);
  if (params.get("checkout") === "cancelled") setTimeout(() => toast("Checkout cancelled. Your bag is saved."), 300);

  // Product page
  const form = $("form.buy");
  if (form) {
    const product = byId[form.dataset.id];
    const qtyOut = $("output", form);
    const addBtn = $(".add-btn", form);
    let qty = 1;
    const setQty = n => { qty = n; qtyOut.textContent = qty; addBtn.textContent = "Add to bag · " + money(product.price * qty); };
    $("[data-minus]", form).addEventListener("click", () => setQty(Math.max(1, qty - 1)));
    $("[data-plus]", form).addEventListener("click", () => setQty(Math.min(20, qty + 1)));

    $$("fieldset", form).forEach(fs => fs.addEventListener("change", e => {
      const chosen = $("[data-chosen]", fs);
      if (chosen && e.target.checked) chosen.textContent = e.target.value;
      updatePreview();
    }));

    const persInput = $('input[name="personalization"]', form);
    const countEl = persInput && document.getElementById(persInput.dataset.countTarget);
    const pvText = $("[data-pv-text]");
    const fonts = { Script: "'Dancing Script', cursive", Serif: "Literata, Georgia, serif", Print: "'Bricolage Grotesque', system-ui, sans-serif" };
    function updatePreview() {
      if (countEl) {
        const n = persInput.value.length, max = persInput.maxLength;
        countEl.textContent = n ? n + " of " + max : "";
      }
      if (!pvText) return;
      const name = (persInput && persInput.value.trim()) || (persInput && persInput.placeholder.replace(/^e\.g\.\s*/, "")) || "Name";
      pvText.textContent = name;
      const letter = $('input[name="Lettering"]:checked', form);
      pvText.setAttribute("font-family", fonts[letter ? letter.value : "Script"] || fonts.Script);
      pvText.setAttribute("font-size", String(Math.max(14, Math.min(34, 220 / Math.max(name.length, 1) * 1.6))));
      const finish = $('input[name="Finish"]:checked', form);
      const tassel = finish && finish.value === "Tassel";
      const rib = $("[data-ribbon]"), tas = $("[data-tassel]");
      if (rib) rib.style.display = tassel ? "none" : "";
      if (tas) tas.hidden = !tassel;
    }
    if (persInput) persInput.addEventListener("input", updatePreview);
    updatePreview();

    form.addEventListener("submit", e => {
      e.preventDefault();
      const options = {};
      product.options.forEach(o => {
        const checked = $('input[name="' + CSS.escape(o.name) + '"]:checked', form);
        options[o.name] = checked ? checked.value : o.values[0];
      });
      const personalization = persInput ? persInput.value.trim() : "";
      if (persInput && !personalization) { persInput.focus(); return toast("Add the name you want on it"); }
      const key = variantKey(product.id, options) + (personalization ? "#" + personalization : "");
      const stockKey = variantKey(product.id, options);
      const existing = bag.find(i => i.key === key);
      const inBag = bag.filter(i => variantKey(i.id, i.options) === stockKey).reduce((n, i) => n + i.qty, 0);
      if (inBag + qty > available(stockKey)) return toast(available(stockKey) > 0 ? "Only " + available(stockKey) + " left" : "That one is sold out");
      if (existing) existing.qty += qty;
      else bag.push({ key, id: product.id, name: product.name, price: product.price, image: product.images[0], options, personalization, qty });
      save();
      $$(".bag-btn").forEach(b => { b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); });
      openBag();
    });

    // Sticky add-to-bag bar on phones once the main button scrolls away.
    const sticky = $(".sticky-buy");
    if (sticky) {
      let ticking = false;
      const check = () => {
        ticking = false;
        const show = addBtn.getBoundingClientRect().bottom < 0;
        if (show === sticky.classList.contains("show")) return;
        sticky.classList.toggle("show", show);
        sticky.setAttribute("aria-hidden", String(!show));
        $("[data-sticky-add]", sticky).tabIndex = show ? 0 : -1;
      };
      addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(check); } }, { passive: true });
      check();
      $("[data-sticky-add]", sticky).addEventListener("click", () => {
        if (persInput && !persInput.value.trim()) { persInput.scrollIntoView({ block: "center", behavior: "smooth" }); persInput.focus({ preventScroll: true }); return toast("Add the name you want on it"); }
        form.requestSubmit();
      });
    }

    // Gallery thumbs
    const main = $(".gallery .main img");
    $$(".thumbs button").forEach(b => b.addEventListener("click", () => {
      $$(".thumbs button").forEach(x => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      main.removeAttribute("srcset");
      main.src = b.dataset.src;
    }));
  }

  // Shop filters and sort
  const grid = $("[data-shop-grid]");
  if (grid) {
    const cards = $$(".card", grid);
    const chips = $$(".chip");
    const sortEl = $("[data-sort]");
    const countEl = $("[data-result-count]");
    const emptyEl = $("[data-empty]");
    let filter = "all";
    const fromUrl = params.get("for") ? "t:" + params.get("for") : params.get("in") ? "c:" + params.get("in") : null;
    if (fromUrl && chips.some(c => c.dataset.filter === fromUrl)) filter = fromUrl;

    function apply() {
      let shown = 0;
      cards.forEach(card => {
        let ok = true;
        if (filter.startsWith("c:")) ok = card.dataset.collection === filter.slice(2);
        if (filter.startsWith("t:")) ok = card.dataset.tags.split(" ").includes(filter.slice(2));
        card.hidden = !ok;
        if (ok) shown++;
      });
      chips.forEach(c => c.setAttribute("aria-pressed", String(c.dataset.filter === filter)));
      const s = sortEl.value;
      const sorted = cards.slice().sort((a, b) =>
        s === "price-asc" ? a.dataset.price - b.dataset.price :
        s === "price-desc" ? b.dataset.price - a.dataset.price : a.dataset.order - b.dataset.order);
      sorted.forEach(c => grid.appendChild(c));
      countEl.textContent = shown + (shown === 1 ? " design" : " designs");
      emptyEl.hidden = shown > 0;
    }
    $$("[data-filter]").forEach(b => b.addEventListener("click", () => {
      filter = b.dataset.filter;
      const url = new URL(location.href);
      url.searchParams.delete("for"); url.searchParams.delete("in");
      if (filter.startsWith("t:")) url.searchParams.set("for", filter.slice(2));
      if (filter.startsWith("c:")) url.searchParams.set("in", filter.slice(2));
      history.replaceState(null, "", url);
      apply();
    }));
    sortEl.addEventListener("change", apply);
    apply();
  }

  // Newsletter sign-up
  $$(".sub-form").forEach(f => f.addEventListener("submit", async e => {
    e.preventDefault();
    const msg = $(".sub-msg", f);
    const btn = $("button", f);
    const email = f.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = "Please enter a valid email address."; f.email.focus(); return; }
    btn.disabled = true;
    try {
      const res = await fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, company: f.company.value, source: f.dataset.source }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      f.reset();
      msg.textContent = "You're on the list. Thank you!";
    } catch (err) {
      msg.textContent = err.message + " You can also email " + CATALOG.shop.email + ".";
    } finally { btn.disabled = false; }
  }));

  // Team order request: composes an email for the visitor to send.
  const bulk = $("[data-bulk]");
  if (bulk) bulk.addEventListener("submit", e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(bulk));
    if (!d.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email || "")) { toast("Add your name and email"); (d.name ? bulk.email : bulk.name).focus(); return; }
    const body = [
      "Hi Daffodil Lane,", "",
      "I'd like a quote for a team or event order.", "",
      "Name: " + d.name, "Email: " + d.email, "Occasion: " + d.occasion,
      "About how many: " + (d.quantity || "not sure yet"), "Items: " + (d.items || "open to ideas"),
      "Needed by: " + (d.date || "flexible"), "", d.notes || ""
    ].join("\n");
    location.href = "mailto:" + CATALOG.shop.email + "?subject=" + encodeURIComponent("Team order: " + d.occasion + " (" + (d.quantity || "?") + ")") + "&body=" + encodeURIComponent(body);
  });

  // Live stock (optional; site works without it)
  fetch("/api/stock").then(r => (r.ok ? r.json() : {})).then(s => {
    stock = s || {};
    $$("[data-product-card]").forEach(card => {
      const p = byId[card.dataset.productCard];
      const keys = Object.keys(stock).filter(k => k.startsWith(p.id + "|"));
      if (keys.length && keys.every(k => stock[k] <= 0) && !$(".soldout-tag", card)) {
        const tag = document.createElement("span");
        tag.className = "soldout-tag";
        tag.textContent = "Sold out";
        $("h3", card).appendChild(tag);
      }
    });
  }).catch(() => {});

  // Thank-you page clears the bag
  if (document.body.dataset.page === "thanks") { bag = []; save(); }

  closeBag();
  render();
})();
