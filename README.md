# Daffodil Lane shop

thedaffodillane.com: storefront, Stripe Checkout and the owner's dashboard in one Cloudflare Worker (`daffodil-lane`).

## Using the dashboard

Go to **https://thedaffodillane.com/admin/** and sign in with the dashboard password (the `ADMIN_PASSWORD` secret).

- **Products:** add, edit, hide or delete products. Upload photos (shrunk automatically), set price, collection, options (size, color…), personalization, gift-guide labels and "feature on home page". Reorder with the arrows.
- **Inventory:** each product is either *Made to order* (no limit) or *Track stock* with a count per variant. Stock goes down by itself when Stripe confirms payment; at 0 the variant shows as sold out and can't be bought.
- **Orders:** every paid order with items, names to engrave, gift message, maker notes and shipping address. Mark New → Making → Shipped.
- **Sign-ups:** newsletter emails, with CSV download.
- **Settings:** the top banner, shipping prices, collections.

Changes show on the shop within about a minute.

## How it works

- `src/worker.js`: routes requests: pages, `/api/*`, `/media/*` (uploaded photos).
- `src/site.js`: renders every shop page, the sitemap and the Google product feed from the catalog.
- `src/api/`: `checkout.js` (Stripe Checkout, prices checked on the server), `stripe-webhook.js` (lowers stock, logs the order), `subscribe.js`, `admin.js` (dashboard API).
- `static/`: styles and scripts for the shop, and the dashboard (`static/admin/`).
- `catalog.json`: the starting catalog. On first run it's copied into KV, and from then on the **dashboard is the source of truth**. Edits to this file after that don't change the live shop.

KV (`SHOP` binding) keys: `catalog`, `stock:<variant>`, `img:<id>`, `order:<…>`, `sub:<email>`.

## Cloudflare setup

- Secrets (Worker → Settings → Variables and Secrets): `ADMIN_PASSWORD`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Stripe webhook endpoint: `https://thedaffodillane.com/api/stripe-webhook`, events `checkout.session.completed` and `checkout.session.async_payment_succeeded`
- Deploys: Workers Builds is connected to this repo, so every push to `main` deploys with `npx wrangler deploy` (the build step in `wrangler.jsonc` runs `node build.mjs`).

## Developing

```
npm install
npm test          # builds, then runs the Worker tests with Stripe mocked
npm run dev       # local Worker at http://localhost:8787 (put test secrets in .dev.vars)
```
