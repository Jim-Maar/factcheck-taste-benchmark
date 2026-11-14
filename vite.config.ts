import * as path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";

const folder = (name: string) => path.resolve(import.meta.dirname, name);

/* GitHub Pages serves the site under /factcheck-taste-benchmark/, so the
 * deploy workflow sets BASE_PATH. Local development serves it at /. */
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@cn/core": folder("src/core"),
      "@cn/ui": folder("src/ui"),
      "@cn/features": folder("src/features"),
      "@cn/shared": folder("src/shared"),
    },
  },
  css: { postcss: { plugins: [tailwindcss({ config: folder("tailwind.config.ts") })] } },
});
