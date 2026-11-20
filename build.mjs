// Prepares the Worker (writes src/version.js) and, for local previews, renders the whole site into ./dist.
// The live site is rendered by the Worker at request time from the catalog in KV (see src/worker.js).
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSite } from "./src/site.js";

const root = dirname(fileURLToPath(import.meta.url));
const version = createHash("sha256")
  .update(["static/styles.css", "static/app.js", "static/admin/admin.js", "static/admin/admin.css"].map(f => readFileSync(join(root, f), "utf8")).join(""))
  .digest("hex").slice(0, 10);
writeFileSync(join(root, "src/version.js"), `export default ${JSON.stringify(version)};\n`);

const catalog = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));
const site = createSite({ catalog, siteUrl: process.env.SITE_URL || "https://thedaffodillane.com", version });

const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });
const out = (path, body) => {
  const file = path.endsWith("/") ? join(dist, path, "index.html") : join(dist, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
};
for (const [path, render] of Object.entries(site.pages)) out(path, render());
for (const [path, render] of Object.entries(site.files)) out(path, render().body);
cpSync(join(root, "static"), dist, { recursive: true });

console.log(`Version ${version}. Rendered ${Object.keys(site.pages).length} pages into dist/ for preview.`);
