# Daffodil Lane shop

Static storefront + Stripe Checkout, hosted on Cloudflare Pages.

- `catalog.json` — products, prices, options, shipping. Edit this to change the shop.
- `build.mjs` — builds the site into `dist/` (Cloudflare build command: `node build.mjs`, output: `dist`).
- `functions/api/checkout.js` — creates the Stripe Checkout session (prices checked server-side).
- `functions/api/stripe-webhook.js` — after payment, lowers stock for tracked items.
- `functions/api/stock.js` — live stock counts for the storefront.

Cloudflare Pages settings:
- Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- KV binding: `STOCK` (stock counts as `stock:<variant key>`; items without a count are made to order)
- Stripe webhook endpoint: `https://thedaffodillane.com/api/stripe-webhook` (event: `checkout.session.completed`)
