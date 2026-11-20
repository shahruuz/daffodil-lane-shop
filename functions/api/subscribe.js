// POST /api/subscribe { email, source, company }  -> stores sub:<email> in the STOCK KV namespace.
// Export later from the Cloudflare dashboard (Workers & Pages > KV > keys starting with "sub:").
import { json, cleanText } from "../_lib.js";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "That didn't look right." }, 400); }
  if (body?.company) return json({ ok: true }); // honeypot field filled: quietly ignore bots
  const email = cleanText(body?.email, 254).toLowerCase();
  if (!EMAIL.test(email)) return json({ error: "Please enter a valid email address." }, 400);
  if (!env.STOCK) return json({ error: "Sign-up isn't available right now." }, 503);

  const key = "sub:" + email;
  if (!(await env.STOCK.get(key))) {
    await env.STOCK.put(key, JSON.stringify({
      at: new Date().toISOString(),
      source: cleanText(body?.source, 60),
      country: request.cf?.country || ""
    }));
  }
  return json({ ok: true });
}

export function onRequest() {
  return json({ error: "Use POST." }, 405, { Allow: "POST" });
}
