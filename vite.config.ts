import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = "http://localhost:4320";

const packageJson: unknown = JSON.parse(readFileSync("package.json", "utf8"));
const version =
  typeof packageJson === "object" &&
  packageJson !== null &&
  "version" in packageJson &&
  typeof packageJson.version === "string"
    ? packageJson.version
    : "0.0.0";

export default defineConfig({
  root: "src/ui",
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    outDir: resolve("dist/ui"),
    emptyOutDir: true,
  },
  server: {
    port: 4321,
    strictPort: true,
    proxy: {
      "/v1": apiTarget,
      "/app": apiTarget,
      "/auth": apiTarget,
      "/docs": apiTarget,
      "/robots.txt": apiTarget,
      "/sitemap.xml": apiTarget,
    },
  },
});
