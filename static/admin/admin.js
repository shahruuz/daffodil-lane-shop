// Daffodil Lane shop dashboard. Plain JS; talks to /api/admin/*.
(function () {
  const app = document.getElementById("app");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = c => (c == null ? "" : "$" + (c / 100).toFixed(c % 100 === 0 ? 0 : 2));
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const logo = `<svg viewBox="0 0 40 40" aria-hidden="true"><g fill="#f2c230" stroke="#1d211c" stroke-width="1.6">${[0, 60, 120, 180, 240, 300].map(a => `<ellipse cx="20" cy="9" rx="6" ry="9" transform="rotate(${a} 20 20)"/>`).join("")}</g><circle cx="20" cy="20" r="6.5" fill="#d9a81a" stroke="#1d211c" stroke-width="1.6"/></svg>`;
  const TAGS = [["reader", "Book lovers"], ["nurse", "Nurses"], ["mama", "New moms"], ["self-care", "Self-care"], ["stocking", "Stocking stuffers"], ["personalized", "Personalized"], ["under-20", "Under $20"]];

  // Must match variantKey() in src/lib.js and static/app.js.
  const variantKey = (id, options) => id + "|" + Object.keys(options).sort().map(k => k + "=" + options[k]).join(";");
  const variants = opts => opts.reduce((acc, o) => acc.flatMap(a => o.values.map(v => ({ ...a, [o.name]: v }))), [{}]);
  const thumb = u => (u && u.includes("static.wixstatic.com/media/") ? `${u}/v1/fill/w_200,h_200,al_c,q_80,enc_auto/${u.split("/").pop()}` : u || "/favicon.svg");

  let state = { catalog: null, stock: {}, orders: null, subs: null };

  async function api(path, { method = "GET", body, raw, type } = {}) {
    const headers = { "X-Requested-With": "dl-admin" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (raw) headers["Content-Type"] = type;
    const res = await fetch(path, { method, headers, body: raw || (body !== undefined ? JSON.stringify(body) : undefined), credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== "/api/admin/login") { renderLogin(); throw new Error("Please sign in."); }
    if (!res.ok) throw new Error(data.error || "Something went wrong (" + res.status + ").");
    return data;
  }

  function toast(msg) {
    let t = $(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ---------- Login ----------
  function renderLogin(configured = true) {
    app.innerHTML = `<div class="login"><form class="card" novalidate>
      <h1>${logo} Shop dashboard</h1>
      ${configured ? "" : `<p class="err">The dashboard password isn't set yet. In Cloudflare, open the daffodil-lane Worker → Settings → Variables and Secrets, and add a secret named ADMIN_PASSWORD.</p>`}
      <label class="f">Password<input type="password" name="password" autocomplete="current-password" required autofocus></label>
      <button class="btn primary" type="submit">Sign in</button>
      <p class="err" role="alert"></p>
      <p class="hint">You'll stay signed in on this device for 30 days.</p>
    </form></div>`;
    const f = $("form", app);
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = $("button", f); btn.disabled = true;
      try {
        await api("/api/admin/login", { method: "POST", body: { password: f.password.value } });
        await load(); route();
      } catch (err) { $(".err[role=alert]", f).textContent = err.message; }
      finally { btn.disabled = false; }
    });
  }

  // ---------- Shell ----------
  function shell(active, inner) {
    const tabs = [["products", "Products"], ["orders", "Orders"], ["signups", "Sign-ups"], ["settings", "Settings"]];
    app.innerHTML = `<header class="top"><div class="in">
      <a class="brand" href="#products">${logo}Daffodil Lane</a>
      <nav class="tabs">${tabs.map(([k, l]) => `<a href="#${k}"${k === active ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
      <div class="right"><a href="/" target="_blank" rel="noopener">View shop ↗</a><button type="button" data-logout>Sign out</button></div>
    </div></header><main>${inner}</main>`;
    $("[data-logout]").addEventListener("click", async () => { await api("/api/admin/logout", { method: "POST" }).catch(() => {}); renderLogin(); });
  }

  async function load() {
    const data = await api("/api/admin/catalog");
    state.catalog = data.catalog; state.stock = data.stock;
  }

  function stockSummary(p) {
    const keys = variants(p.options).map(v => variantKey(p.id, v));
    const tracked = keys.filter(k => k in state.stock);
    if (!tracked.length) return `<span class="chip">Made to order</span>`;
    const total = tracked.reduce((n, k) => n + state.stock[k], 0);
    const out = tracked.filter(k => state.stock[k] <= 0).length;
    const low = tracked.filter(k => state.stock[k] > 0 && state.stock[k] <= 3).length;
    if (out === tracked.length) return `<span class="chip bad">Sold out</span>`;
    return `<span class="chip ${out ? "bad" : low ? "warn" : "ok"}">${total} in stock${out ? ` · ${out} sold out` : low ? ` · ${low} low` : ""}</span>`;
  }

  // ---------- Products ----------
  function renderProducts() {
    const { catalog } = state;
    const colName = s => catalog.collections.find(c => c.slug === s)?.name || s;
    shell("products", `
      <div class="head"><div><h1>Products</h1><p class="sub">${catalog.products.length} products. Changes show on the shop within about a minute.</p></div>
        <a class="btn primary" href="#product/new">+ Add product</a></div>
      <div class="toolbar"><input type="search" placeholder="Search products" aria-label="Search products"></div>
      <ul class="plist">${catalog.products.map((p, i) => `
        <li class="prow" data-id="${p.id}" tabindex="0">
          <img src="${esc(thumb(p.images[0]))}" alt="">
          <div><h3>${esc(p.name)}</h3><div class="meta"><span>${esc(colName(p.collection))}</span>${p.active === false ? '<span class="chip off">Hidden</span>' : ""}${p.featured ? '<span class="chip">On home page</span>' : ""}</div></div>
          <div class="end"><span class="price">${money(p.price)}</span>${stockSummary(p)}
            <div class="move" aria-label="Reorder"><button type="button" data-up="${i}" aria-label="Move ${esc(p.name)} up">▲</button><button type="button" data-down="${i}" aria-label="Move ${esc(p.name)} down">▼</button></div></div>
        </li>`).join("") || `<li class="empty">No products yet.</li>`}</ul>`);
    $$(".prow").forEach(row => {
      const open = () => (location.hash = "#product/" + row.dataset.id);
      row.addEventListener("click", e => { if (!e.target.closest(".move")) open(); });
      row.addEventListener("keydown", e => { if (e.key === "Enter") open(); });
    });
    $(".toolbar input").addEventListener("input", e => {
      const q = e.target.value.toLowerCase();
      $$(".prow").forEach(r => (r.hidden = !r.textContent.toLowerCase().includes(q)));
    });
    $$("[data-up],[data-down]").forEach(b => b.addEventListener("click", async () => {
      const i = Number(b.dataset.up ?? b.dataset.down), j = b.dataset.up != null ? i - 1 : i + 1;
      const list = [...catalog.products];
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      catalog.products = list; renderProducts();
      await api("/api/admin/order", { method: "PUT", body: { ids: list.map(p => p.id) } }).catch(err => toast(err.message));
    }));
  }

  // ---------- Product editor ----------
  async function resizeImage(file) {
    if (file.type === "image/gif") return file;
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) return file;
    const max = 1600, scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise(r => c.toBlob(b => r(b || file), "image/jpeg", 0.86));
  }

  function renderEditor(id) {
    const { catalog } = state;
    const isNew = id === "new";
    const orig = catalog.products.find(p => p.id === id);
    if (!isNew && !orig) { location.hash = "#products"; return; }
    const p = JSON.parse(JSON.stringify(orig || {
      id: "", name: "", price: 1000, collection: catalog.collections[0]?.slug, description: "", images: [], options: [], tags: [], featured: false, active: true
    }));
    const tracked = !isNew && variants(p.options).some(v => variantKey(p.id, v) in state.stock);
    let stockDraft = {};
    if (!isNew) variants(p.options).forEach(v => { const k = variantKey(p.id, v); if (k in state.stock) stockDraft[k] = state.stock[k]; });

    shell("products", `
      <div class="head"><div><p class="sub"><a href="#products">← Products</a></p><h1>${isNew ? "Add a product" : esc(p.name)}</h1></div>
        ${isNew ? "" : `<a class="btn small" href="/products/${esc(p.slug)}/" target="_blank" rel="noopener">View on shop ↗</a>`}</div>
      <form class="form" novalidate>
        <section class="card"><div class="section-title"><h2>Photos</h2><span class="hint">The first photo is the main one. Big photos are shrunk automatically.</span></div>
          <div class="photos" data-photos></div></section>

        <section class="card form">
          <label class="f">Name<input type="text" name="name" maxlength="80" required value="${esc(p.name)}"></label>
          <div class="grid3">
            <label class="f">Collection<select name="collection">${catalog.collections.map(c => `<option value="${esc(c.slug)}"${c.slug === p.collection ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
            <label class="f">Price<div class="money"><span>$</span><input type="number" name="price" min="0.5" step="0.01" inputmode="decimal" required value="${(p.price / 100).toFixed(2)}"></div></label>
            <div class="f" style="display:grid;gap:10px;align-content:end">
              <label class="check"><input type="checkbox" name="active"${p.active !== false ? " checked" : ""}> Show in the shop</label>
              <label class="check"><input type="checkbox" name="featured"${p.featured ? " checked" : ""}> Feature on the home page</label>
            </div>
          </div>
          <label class="f">Description<textarea name="description" maxlength="2000">${esc(p.description)}</textarea></label>
          <div class="f"><span>Gift guides and labels <small>— where this product shows up</small></span>
            <div class="checks">${TAGS.map(([t, l]) => `<label><input type="checkbox" name="tag" value="${t}"${(p.tags || []).includes(t) ? " checked" : ""}> ${l}</label>`).join("")}</div></div>
        </section>

        <section class="card"><div class="section-title"><h2>Options</h2><span class="hint">Like Size or Color. Up to 3. Separate choices with commas.</span></div>
          <div data-options></div>
          <button type="button" class="btn small" data-add-option style="margin-top:12px">+ Add option</button></section>

        <section class="card form"><h2>Personalization</h2>
          <label class="check"><input type="checkbox" name="pers"${p.personalization ? " checked" : ""}> Customer types a name or short text</label>
          <div class="grid2" data-pers ${p.personalization ? "" : "hidden"}>
            <label class="f">Box label<input type="text" name="persLabel" maxlength="40" value="${esc(p.personalization?.label || "Name to add")}"></label>
            <label class="f">Most characters<input type="number" name="persMax" min="1" max="60" value="${esc(p.personalization?.maxLength || 20)}"></label>
            <label class="f" style="grid-column:1/-1">Note under the box <small>(optional)</small><input type="text" name="persNote" maxlength="200" value="${esc(p.personalization?.note || "")}"></label>
          </div>
        </section>

        <section class="card"><div class="section-title"><h2>Inventory</h2></div>
          <div class="seg" role="radiogroup" aria-label="Inventory">
            <label><input type="radio" name="inv" value="mto"${tracked ? "" : " checked"}>Made to order</label>
            <label><input type="radio" name="inv" value="track"${tracked ? " checked" : ""}>Track stock</label>
          </div>
          <p class="hint" data-inv-hint></p>
          <div data-stock></div>
        </section>

        ${isNew ? "" : `<section class="card"><h2>Delete</h2><p class="hint">Removes the product from the shop. Past orders keep their details.</p>
          <button type="button" class="btn danger small" data-delete>Delete this product</button>
          <span data-confirm hidden> Are you sure? <button type="button" class="btn danger small" data-delete-yes>Yes, delete</button> <button type="button" class="linkbtn" data-delete-no>Cancel</button></span></section>`}
      </form>
      <div class="savebar"><div class="in"><span class="msg" role="status"></span><a class="btn" href="#products">Cancel</a><button class="btn primary" type="button" data-save>${isNew ? "Add product" : "Save changes"}</button></div></div>`);

    const form = $("form.form");
    const msg = $(".savebar .msg");

    // Photos
    const photosEl = $("[data-photos]");
    function drawPhotos() {
      photosEl.innerHTML = p.images.map((u, i) => `<div class="photo">${i === 0 ? '<span class="first">Main</span>' : ""}<img src="${esc(thumb(u))}" alt="">
        <div class="tools"><button type="button" data-left="${i}" aria-label="Move left"${i === 0 ? " disabled" : ""}>←</button><button type="button" data-remove="${i}" aria-label="Remove photo">✕</button><button type="button" data-right="${i}" aria-label="Move right"${i === p.images.length - 1 ? " disabled" : ""}>→</button></div></div>`).join("")
        + (p.images.length < 8 ? `<label class="addphoto"><span>+ Add photos<br><small>JPG, PNG or WebP</small></span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple></label>` : "");
      $$("[data-remove]", photosEl).forEach(b => b.addEventListener("click", () => { p.images.splice(Number(b.dataset.remove), 1); drawPhotos(); }));
      $$("[data-left]", photosEl).forEach(b => b.addEventListener("click", () => { const i = Number(b.dataset.left); [p.images[i - 1], p.images[i]] = [p.images[i], p.images[i - 1]]; drawPhotos(); }));
      $$("[data-right]", photosEl).forEach(b => b.addEventListener("click", () => { const i = Number(b.dataset.right); [p.images[i + 1], p.images[i]] = [p.images[i], p.images[i + 1]]; drawPhotos(); }));
      const input = $("input[type=file]", photosEl);
      if (input) input.addEventListener("change", async () => {
        const files = [...input.files].slice(0, 8 - p.images.length);
        for (const file of files) {
          msg.className = "msg"; msg.textContent = "Uploading " + file.name + "…";
          try {
            const blob = await resizeImage(file);
            const { url } = await api("/api/admin/images", { method: "POST", raw: blob, type: blob.type || file.type });
            p.images.push(url); drawPhotos();
          } catch (err) { msg.className = "msg err"; msg.textContent = err.message; return; }
        }
        msg.textContent = files.length ? "Photos added. Save to keep them." : "";
      });
    }
    drawPhotos();

    // Options
    const optEl = $("[data-options]");
    function readOptions() {
      return $$(".opt", optEl).map(r => ({ name: $("[name=optName]", r).value.trim(), values: $("[name=optValues]", r).value.split(",").map(v => v.trim()).filter(Boolean) }))
        .filter(o => o.name && o.values.length);
    }
    function drawOptions() {
      optEl.innerHTML = p.options.map((o, i) => `<div class="opt">
        <label class="f">Option name<input type="text" name="optName" maxlength="30" placeholder="e.g. Color" value="${esc(o.name)}"></label>
        <label class="f">Choices<input type="text" name="optValues" placeholder="e.g. Sage, Lavender, Blush" value="${esc(o.values.join(", "))}"></label>
        <button type="button" class="btn small danger" data-rm-opt="${i}">Remove</button></div>`).join("") || `<p class="hint">No options. Customers just pick a quantity.</p>`;
      $$("[data-rm-opt]", optEl).forEach(b => b.addEventListener("click", () => { p.options = readOptions(); p.options.splice(Number(b.dataset.rmOpt), 1); drawOptions(); drawStock(); }));
      $$("input", optEl).forEach(i => i.addEventListener("change", () => { p.options = readOptionsKeepEmpty(); drawStock(); }));
    }
    function readOptionsKeepEmpty() {
      return $$(".opt", optEl).map(r => ({ name: $("[name=optName]", r).value.trim(), values: $("[name=optValues]", r).value.split(",").map(v => v.trim()).filter(Boolean) }));
    }
    $("[data-add-option]").addEventListener("click", () => {
      p.options = readOptionsKeepEmpty();
      if (p.options.length >= 3) return toast("Up to 3 options");
      p.options.push({ name: "", values: [] }); drawOptions();
      $$("[name=optName]", optEl).pop().focus();
    });
    drawOptions();

    // Personalization
    form.pers.addEventListener("change", () => ($("[data-pers]").hidden = !form.pers.checked));

    // Inventory
    const stockEl = $("[data-stock]");
    const tempId = p.id || "00000000-0000-4000-8000-000000000000";
    function drawStock() {
      const track = form.inv.value === "track";
      $("[data-inv-hint]").textContent = track
        ? "Stock goes down by itself when an order is paid. At 0 the item shows as sold out."
        : "No limit. Each order is made after it comes in.";
      if (!track) { stockEl.innerHTML = ""; return; }
      const opts = readOptions();
      const vs = variants(opts);
      stockEl.innerHTML = `<table class="stock"><thead><tr><th>${opts.length ? "Variant" : "Item"}</th><th>In stock</th></tr></thead><tbody>${vs.map(v => {
        const label = Object.values(v).join(" / ") || "All";
        const k = variantKey(tempId, v);
        const cur = stockDraft[k] ?? (p.id ? state.stock[k] : undefined);
        return `<tr><td>${esc(label)}</td><td><input type="number" min="0" step="1" inputmode="numeric" data-k="${esc(k)}" value="${cur ?? 0}" aria-label="Stock for ${esc(label)}"></td></tr>`;
      }).join("")}</tbody></table>`;
      $$("input[data-k]", stockEl).forEach(i => i.addEventListener("input", () => (stockDraft[i.dataset.k] = i.value)));
    }
    $$("input[name=inv]").forEach(r => r.addEventListener("change", drawStock));
    drawStock();

    // Delete
    if (!isNew) {
      $("[data-delete]").addEventListener("click", () => ($("[data-confirm]").hidden = false));
      $("[data-delete-no]").addEventListener("click", () => ($("[data-confirm]").hidden = true));
      $("[data-delete-yes]").addEventListener("click", async () => {
        try { await api("/api/admin/products/" + p.id, { method: "DELETE" }); await load(); toast("Deleted"); location.hash = "#products"; }
        catch (err) { toast(err.message); }
      });
    }

    // Save
    $("[data-save]").addEventListener("click", async () => {
      const btn = $("[data-save]");
      const options = readOptions();
      const product = {
        name: form.name.value, price: Math.round(parseFloat(form.price.value) * 100), collection: form.collection.value,
        description: form.description.value, images: p.images, options,
        tags: $$("input[name=tag]:checked").map(i => i.value), featured: form.featured.checked, active: form.active.checked,
        personalization: form.pers.checked ? { label: form.persLabel.value, maxLength: form.persMax.value, note: form.persNote.value, placeholder: p.personalization?.placeholder } : null,
        preview: !!p.preview, slug: p.slug
      };
      if (!product.name.trim()) { msg.className = "msg err"; msg.textContent = "Give the product a name."; form.name.focus(); return; }
      if (!p.images.length) { msg.className = "msg err"; msg.textContent = "Add at least one photo."; return; }
      btn.disabled = true; msg.className = "msg"; msg.textContent = "Saving…";
      try {
        // Stock keys use the real id; for a new product the server assigns it, so save first, then set stock.
        const track = form.inv.value === "track";
        const stockFor = realId => Object.fromEntries(variants(options).map(v => {
          const draft = stockDraft[variantKey(tempId, v)];
          const val = track ? Math.max(0, parseInt(draft ?? state.stock[variantKey(realId, v)] ?? 0, 10) || 0) : null;
          return [variantKey(realId, v), val];
        }));
        let saved;
        if (isNew) {
          saved = (await api("/api/admin/products", { method: "POST", body: { product } })).product;
          await api("/api/admin/products/" + saved.id, { method: "PUT", body: { product: saved, stock: stockFor(saved.id) } });
        } else {
          // Clear stock for variants that no longer exist when options change.
          const old = variants(orig.options).map(v => variantKey(p.id, v)).filter(k => k in state.stock);
          saved = (await api("/api/admin/products/" + p.id, { method: "PUT", body: { product, stock: stockFor(p.id) } })).product;
          const keep = new Set(variants(saved.options).map(v => variantKey(saved.id, v)));
          const gone = Object.fromEntries(old.filter(k => !keep.has(k)).map(k => [k, null]));
          if (Object.keys(gone).length) await api("/api/admin/stock", { method: "PUT", body: gone });
        }
        await load();
        toast(isNew ? "Product added" : "Saved");
        location.hash = "#products";
      } catch (err) { msg.className = "msg err"; msg.textContent = err.message; }
      finally { btn.disabled = false; }
    });
  }

  // ---------- Orders ----------
  async function renderOrders() {
    shell("orders", `<div class="head"><div><h1>Orders</h1><p class="sub">Paid orders appear here automatically.</p></div></div><div data-orders><p class="empty">Loading…</p></div>`);
    try { state.orders = (await api("/api/admin/orders")).orders; } catch (err) { $("[data-orders]").innerHTML = `<p class="err">${esc(err.message)}</p>`; return; }
    const orders = state.orders;
    const openCount = orders.filter(o => o.status !== "shipped").length;
    const revenue = orders.reduce((n, o) => n + (o.total || 0), 0);
    $("[data-orders]").innerHTML = (orders.length ? `<div class="stats"><div class="stat"><b>${openCount}</b><span>to make or ship</span></div><div class="stat"><b>${orders.length}</b><span>orders</span></div><div class="stat"><b>${money(revenue)}</b><span>total sales</span></div></div>` : "")
      + (orders.map(o => {
        const a = o.shipTo;
        const addr = a ? [a.name, a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(", ")].filter(Boolean).join("\n") : "";
        return `<article class="card order">
          <div class="row1"><div><span class="who">${esc(o.name || o.email || "Customer")}</span> <span class="when">${esc(new Date(o.createdAt).toLocaleString())}</span></div>
            <div><strong>${money(o.total)}</strong> <select data-status="${esc(o.key)}" aria-label="Order status">${["new", "making", "shipped"].map(s => `<option value="${s}"${o.status === s ? " selected" : ""}>${{ new: "New", making: "Making", shipped: "Shipped" }[s]}</option>`).join("")}</select></div></div>
          <ul>${(o.items || []).map(i => `<li>${i.qty} × ${esc(i.name)}${Object.keys(i.options || {}).length ? ` — ${esc(Object.entries(i.options).map(([k, v]) => k + ": " + v).join(", "))}` : ""}${i.personalization ? ` — <strong>Name: ${esc(i.personalization)}</strong>` : ""}</li>`).join("")}</ul>
          ${o.giftMessage ? `<div class="note"><strong>Gift message:</strong> ${esc(o.giftMessage)}</div>` : ""}
          ${o.makerNotes ? `<div class="note"><strong>Notes:</strong> ${esc(o.makerNotes)}</div>` : ""}
          <div class="addr">${esc(addr)}${o.email ? "\n" + esc(o.email) : ""}</div>
        </article>`;
      }).join("") || `<div class="card empty">No orders yet. When someone pays, the order shows up here and stock updates by itself.</div>`);
    $$("[data-status]").forEach(s => s.addEventListener("change", async () => {
      try { await api("/api/admin/orders/" + encodeURIComponent(s.dataset.status), { method: "PATCH", body: { status: s.value } }); toast("Marked " + s.selectedOptions[0].text.toLowerCase()); }
      catch (err) { toast(err.message); }
    }));
  }

  // ---------- Sign-ups ----------
  async function renderSignups() {
    shell("signups", `<div class="head"><div><h1>Newsletter sign-ups</h1><p class="sub">From the "Slow mail" boxes on the shop.</p></div><a class="btn" href="/api/admin/subscribers?format=csv">Download CSV</a></div><div data-subs><p class="empty">Loading…</p></div>`);
    try { state.subs = (await api("/api/admin/subscribers")).subscribers; } catch (err) { $("[data-subs]").innerHTML = `<p class="err">${esc(err.message)}</p>`; return; }
    $("[data-subs]").innerHTML = state.subs.length
      ? `<div class="stats"><div class="stat"><b>${state.subs.length}</b><span>people</span></div></div><table class="simple"><thead><tr><th>Email</th><th>Signed up</th><th>Where</th></tr></thead><tbody>${state.subs.slice(0, 200).map(s => `<tr><td>${esc(s.email)}</td><td>${esc(s.at ? new Date(s.at).toLocaleDateString() : "")}</td><td>${esc(s.source || "")}</td></tr>`).join("")}</tbody></table>`
      : `<div class="card empty">No sign-ups yet.</div>`;
  }

  // ---------- Settings ----------
  function renderSettings() {
    const { shop, collections } = state.catalog;
    const a = shop.announcement || {};
    shell("settings", `<div class="head"><h1>Settings</h1></div>
      <form class="form" novalidate>
        <section class="card form"><h2>Banner at the top of the shop</h2>
          <label class="check"><input type="checkbox" name="aOn"${a.enabled ? " checked" : ""}> Show the banner</label>
          <label class="f">Text<input type="text" name="aText" maxlength="160" value="${esc(a.text)}"></label>
          <div class="grid3">
            <label class="f">Link to <small>(a page on the shop, like /gifts/)</small><input type="text" name="aLink" value="${esc(a.link)}"></label>
            <label class="f">Link text<input type="text" name="aLinkText" maxlength="30" value="${esc(a.linkText)}"></label>
            <label class="f">Hide it on <small>(optional)</small><input type="date" name="aUntil" value="${esc(a.until)}"></label>
          </div></section>
        <section class="card form"><h2>Shipping (US)</h2>
          <div class="grid2">
            <label class="f">Shipping per order<div class="money"><span>$</span><input type="number" name="flat" min="0" step="0.01" value="${(shop.shipping.flatCents / 100).toFixed(2)}"></div></label>
            <label class="f">Free shipping on orders over<div class="money"><span>$</span><input type="number" name="free" min="0" step="0.01" value="${(shop.shipping.freeOverCents / 100).toFixed(2)}"></div></label>
          </div></section>
        <section class="card form"><h2>Collections</h2><p class="hint">The groups in the shop's menu. A collection with no visible products is hidden automatically.</p>
          <div data-cols>${collections.map(c => `<div class="grid2" data-col data-slug="${esc(c.slug)}" style="margin-bottom:10px"><label class="f">Name<input type="text" name="cName" maxlength="40" value="${esc(c.name)}"></label><label class="f">Short description<input type="text" name="cBlurb" maxlength="160" value="${esc(c.blurb)}"></label></div>`).join("")}</div>
          <button type="button" class="btn small" data-add-col>+ Add collection</button></section>
      </form>
      <div class="savebar"><div class="in"><span class="msg" role="status"></span><button class="btn primary" type="button" data-save>Save settings</button></div></div>`);
    const f = $("form.form");
    $("[data-add-col]").addEventListener("click", () => {
      $("[data-cols]").insertAdjacentHTML("beforeend", `<div class="grid2" data-col data-slug="" style="margin-bottom:10px"><label class="f">Name<input type="text" name="cName" maxlength="40"></label><label class="f">Short description<input type="text" name="cBlurb" maxlength="160"></label></div>`);
      $$("[name=cName]").pop().focus();
    });
    $("[data-save]").addEventListener("click", async () => {
      const msg = $(".savebar .msg"), btn = $("[data-save]");
      btn.disabled = true; msg.className = "msg"; msg.textContent = "Saving…";
      try {
        const data = await api("/api/admin/settings", { method: "PUT", body: {
          announcement: { enabled: f.aOn.checked, text: f.aText.value, link: f.aLink.value, linkText: f.aLinkText.value, until: f.aUntil.value },
          shipping: { flatCents: Math.round(parseFloat(f.flat.value || "0") * 100), freeOverCents: Math.round(parseFloat(f.free.value || "0") * 100) },
          collections: $$("[data-col]").map(r => ({ slug: r.dataset.slug, name: $("[name=cName]", r).value, blurb: $("[name=cBlurb]", r).value }))
        } });
        state.catalog = data.catalog; msg.textContent = ""; toast("Settings saved"); renderSettings();
      } catch (err) { msg.className = "msg err"; msg.textContent = err.message; }
      finally { btn.disabled = false; }
    });
  }

  // ---------- Router ----------
  function route() {
    const h = location.hash.slice(1) || "products";
    if (h.startsWith("product/")) return renderEditor(h.slice(8));
    if (h === "orders") return renderOrders();
    if (h === "signups") return renderSignups();
    if (h === "settings") return renderSettings();
    return renderProducts();
  }
  addEventListener("hashchange", () => { if (state.catalog) route(); });

  (async function start() {
    try {
      const s = await fetch("/api/admin/session", { credentials: "same-origin" }).then(r => r.json());
      if (!s.authed) return renderLogin(s.configured);
      await load(); route();
    } catch (err) { app.innerHTML = `<p class="boot">Couldn't load the dashboard: ${esc(err.message)}</p>`; }
  })();
})();
