# Daffodil Lane shop

Static storefront + Stripe Checkout on Cloudflare Pages, for thedaffodillane.com.

## What's where

- `catalog.json` — products, prices, options, tags, gift guides, FAQ, shipping, the announcement bar. Edit this to change the shop.
- `build.mjs` — builds the site into `dist/` (Cloudflare build command: `node build.mjs`, output: `dist`).
- `src/styles.css`, `src/app.js` — the site's styles and browser script (bag, filters, personalization preview, sign-up).
- `functions/api/checkout.js` — creates the Stripe Checkout session. Prices, options and stock are checked on the server. Adds US shipping (free over the threshold), promo codes, and two optional boxes: gift message and notes for the maker.
- `functions/api/stripe-webhook.js` — verifies Stripe's signature; after payment, lowers stock for tracked items (once per order).
- `functions/api/stock.js` — live stock counts for the storefront.
- `functions/api/subscribe.js` — newsletter sign-ups, saved as `sub:<email>` keys in the same KV namespace.
- `tests/` — `npm test` (after `npm run build`) checks checkout, webhook, stock and sign-up with Stripe mocked.

## Cloudflare Pages settings (unchanged)

- Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- KV binding: `STOCK` (stock counts as `stock:<variant key>`; items without a count are made to order)
- Stripe webhook endpoint: `https://thedaffodillane.com/api/stripe-webhook` (events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`)

## Deploying

**From GitHub (recommended).** Every push to `main` builds, tests and deploys; every pull request gets a preview link. One-time setup in the repo's Settings → Secrets and variables → Actions:

- Secret `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with the "Cloudflare Pages: Edit" permission (dash.cloudflare.com → My Profile → API Tokens → Create token).
- Secret `CLOUDFLARE_ACCOUNT_ID`: the account ID of the Daffodil Lane Cloudflare account (shown on the Workers & Pages overview page).
- Variable `CF_PAGES_PROJECT`: the Pages project's name, as shown under Workers & Pages.

**From your Mac.** `CF_PAGES_PROJECT=<project name> npm run deploy`

## Everyday edits

- Holiday banner: `shop.announcement` in `catalog.json` (it hides itself after `until`).
- New product: add it to `products` with `tags` (`reader`, `nurse`, `mama`, `self-care`, `stocking`, `personalized`, `under-20`) and it shows up in the matching gift guides, filters, the sitemap and the Google product feed.
- Export newsletter sign-ups: Workers & Pages → KV → the STOCK namespace → keys starting with `sub:`.
- Product feed for Google Merchant Center and Pinterest: `https://thedaffodillane.com/feeds/google-merchant.xml`.
