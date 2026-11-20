// POST /api/subscribe { email, source, company } -> stores sub:<email> in KV. Export from the dashboard (/admin).
import { json, cleanText } from "../lib.js";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

export async function subscribe(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "That didn't look right." }, 400); }
  if (body?.company) return json({ ok: true }); // honeypot field filled: quietly ignore bots
  const email = cleanText(body?.email, 254).toLowerCase();
  if (!EMAIL.test(email)) return json({ error: "Please enter a valid email address." }, 400);
  if (!env.SHOP) return json({ error: "Sign-up isn't available right now." }, 503);

  const key = "sub:" + email;
  if (!(await env.SHOP.get(key))) {
    await env.SHOP.put(key, JSON.stringify({
      at: new Date().toISOString(),
      source: cleanText(body?.source, 60),
      country: request.cf?.country || ""
    }));
  }
  return json({ ok: true });
}
