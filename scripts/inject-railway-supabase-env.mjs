#!/usr/bin/env node
/**
 * Injects Supabase URL + anon key into dist/index.html at container start.
 * Railway (and similar) expose env at runtime; Vite only bakes import.meta.env at build time.
 * Reads VITE_* first, then non-prefixed fallbacks some teams set on Railway.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const indexPath = join(root, "dist", "index.html");

if (!existsSync(indexPath)) {
  console.error("inject-railway-supabase-env: dist/index.html not found. Run `npm run build` before start.");
  process.exit(1);
}

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

let html = readFileSync(indexPath, "utf8");

// Strip any previous injection so restarts / redeploys stay idempotent.
html = html.replace(/<script>\s*window\.__STUDYDECK_SUPABASE__=[\s\S]*?<\/script>\s*/g, "");

const payload = JSON.stringify({ url, anon });
const inject = `<script>window.__STUDYDECK_SUPABASE__=${payload}<\/script>`;

if (!html.includes("<body")) {
  console.error("inject-railway-supabase-env: <body> not found in dist/index.html");
  process.exit(1);
}

html = html.replace("<body>", `<body>${inject}`);
writeFileSync(indexPath, html);
console.log(
  `[inject-railway-supabase-env] Runtime config injected (url: ${Boolean(url)}, anon key: ${Boolean(anon)}).`,
);
