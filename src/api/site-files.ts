/** The address the app is reached at, without a trailing slash, for absolute links in metadata. */
export const siteUrl = (appUrl: URL): string =>
  `${appUrl.origin}${appUrl.pathname}`.replace(/\/+$/u, "");

/** The built index.html with its __APP_URL__ placeholders filled in, so social cards and canonical links are absolute. */
export const renderIndexHtml = (template: string, appUrl: URL): string =>
  template.replaceAll("__APP_URL__", siteUrl(appUrl));

export const robotsTxt = (appUrl: URL): string =>
  [
    "User-agent: *",
    "Allow: /",
    "Disallow: /app/",
    "Disallow: /auth/",
    "Disallow: /v1/",
    "",
    `Sitemap: ${siteUrl(appUrl)}/sitemap.xml`,
    "",
  ].join("\n");

export const sitemapXml = (appUrl: URL, lastModified: Date): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url>",
    `    <loc>${siteUrl(appUrl)}/</loc>`,
    `    <lastmod>${lastModified.toISOString().slice(0, 10)}</lastmod>`,
    "    <changefreq>monthly</changefreq>",
    "    <priority>1.0</priority>",
    "  </url>",
    "</urlset>",
    "",
  ].join("\n");
