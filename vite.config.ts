import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** `serve -c` resolves the config path relative to the static root (`dist`), so copy it in. */
function copyServeJsonToDist(): { name: string; closeBundle: () => void } {
  return {
    name: "copy-serve-json-to-dist",
    closeBundle() {
      const src = resolve(__dirname, "serve.json");
      const dest = resolve(__dirname, "dist", "serve.json");
      if (!existsSync(src)) return;
      copyFileSync(src, dest);
    },
  };
}

export default defineConfig({
  plugins: [react(), copyServeJsonToDist()],
});
