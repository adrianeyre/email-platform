// Builds the project website (GitHub Pages) in `site/dist/` with Vite: the
// page, its stylesheet and its one script from `site/`. The screenshots from
// `docs/images/` and the icons from `src/ui/public/` are copied in, not kept
// twice in Git. `.github/workflows/pages.yml` runs it and publishes
// `site/dist/`. Run it yourself with `pnpm site:build`, then serve
// `site/dist/` with `pnpm site:preview`; `pnpm site:dev` serves the page as
// you edit it. The files for search engines come from `site/seo.ts`.
//
// SITE_URL is the address the site is published at (pages.yml gives it the
// one GitHub Pages reports); SITE_DOMAIN, when set, is written to CNAME for a
// custom domain.
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { build, createServer, preview, type InlineConfig } from "vite";
import {
  llmsTxt,
  pageImages,
  robotsTxt,
  sitemapXml,
  structuredData,
} from "./seo.ts";

/** The repository, named once: every link to it on the page comes from here. */
export const repositoryUrl = "https://github.com/adrianeyre/email-template";

const root = join(import.meta.dirname, "..");
const source = import.meta.dirname;
const output = join(source, "dist");

const siteDomain = process.env.SITE_DOMAIN ?? "";
const siteUrl = (
  process.env.SITE_URL ??
  (siteDomain === ""
    ? "https://adrianeyre.github.io/email-template"
    : `https://${siteDomain}`)
).replace(/\/+$/u, "");

const page = readFileSync(join(source, "index.html"), "utf8");
const images = pageImages(page);
const packageJson: unknown = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
const version =
  typeof packageJson === "object" &&
  packageJson !== null &&
  "version" in packageJson &&
  typeof packageJson.version === "string"
    ? packageJson.version
    : "0.0.0";

/** Each `{{NAME}}` placeholder in the page, and what it becomes. */
const placeholders: Record<string, string> = {
  REPO_URL: repositoryUrl,
  SITE_URL: siteUrl,
  VERSION: version,
  STRUCTURED_DATA: structuredData({ siteUrl, repositoryUrl, version, images }),
};

/** The files the page names by path, and the files for crawlers, in a folder Vite copies into `dist/` as they are. */
function gatherPublicFiles(): string {
  const folder = mkdtempSync(join(tmpdir(), "email-platform-site-"));
  cpSync(join(root, "docs/images"), join(folder, "images"), {
    recursive: true,
  });
  for (const file of [
    "favicon.ico",
    "favicon.svg",
    "apple-touch-icon.png",
    "icon-192.png",
    "icon-512.png",
    "og-image.png",
  ]) {
    cpSync(join(root, "src/ui/public", file), join(folder, file));
  }
  writeFileSync(
    join(folder, "site.webmanifest"),
    JSON.stringify(
      {
        name: "Email Platform",
        short_name: "Email",
        start_url: "./",
        display: "browser",
        background_color: "#f3f7fe",
        theme_color: "#1d4ed8",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      null,
      2,
    ),
  );
  if (siteDomain !== "") {
    writeFileSync(join(folder, "CNAME"), `${siteDomain}\n`);
  }
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(
    join(folder, "sitemap.xml"),
    sitemapXml(siteUrl, today, images),
  );
  writeFileSync(join(folder, "robots.txt"), robotsTxt(siteUrl));
  writeFileSync(join(folder, "llms.txt"), llmsTxt(siteUrl, repositoryUrl));
  writeFileSync(join(folder, ".nojekyll"), "");
  return folder;
}

const config = (publicDir: string): InlineConfig => ({
  configFile: false,
  root: source,
  // Relative, so the built page works under /email-template/ on github.io as well as at a domain's root.
  base: "./",
  publicDir,
  logLevel: "warn",
  plugins: [
    // The illustrations are Stageshow scenes, which are React.
    react(),
    {
      name: "email-platform-placeholders",
      transformIndexHtml: (html) =>
        html.replaceAll(/\{\{([A-Z_]+)\}\}/gu, (match, name: string) => {
          const value = placeholders[name];
          if (value === undefined) {
            throw new Error(
              `site/index.html names an unknown placeholder ${match}`,
            );
          }
          return value;
        }),
    },
  ],
  build: { outDir: output, emptyOutDir: true, target: "es2022" },
  resolve: { dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 4330, strictPort: true },
});

const mode = process.argv[2];
const publicDir = gatherPublicFiles();

if (mode === "--dev") {
  const server = await createServer(config(publicDir));
  await server.listen();
  server.printUrls();
} else if (mode === "--preview") {
  const server = await preview(config(publicDir));
  server.printUrls();
} else {
  try {
    await build(config(publicDir));
  } finally {
    rmSync(publicDir, { recursive: true, force: true });
  }
  console.log(`Built the website in ${output} for ${siteUrl}`);
}
