// The files search engines and AI crawlers read alongside the project
// website: `sitemap.xml`, `robots.txt` and `llms.txt`, and the page's
// structured data. site/build.ts writes them from the page itself, so a
// screenshot added to the page is in the sitemap without listing it twice.

/** The site's one-line pitch, shared by `llms.txt` and the structured data. */
export const tagline =
  "A self-hosted email platform: design email templates visually, share headers and footers, send from your apps with one REST call through your own SMTP provider, and see every email sent.";

/** Every screenshot the page shows, in page order and once each: the `images/…` files its `<img>` tags name. */
export function pageImages(page: string): string[] {
  const found = page.matchAll(/<img\b[^>]*\bsrc="(images\/[^"]+)"/gu);
  return [...new Set([...found].map((match) => match[1] ?? ""))];
}

const escapeXml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

/** The sitemap: the one page, when it was built, and its screenshots for image search. */
export function sitemapXml(
  siteUrl: string,
  lastModified: string,
  images: readonly string[],
): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    "  <url>",
    `    <loc>${escapeXml(`${siteUrl}/`)}</loc>`,
    `    <lastmod>${lastModified}</lastmod>`,
    ...images.flatMap((image) => [
      "    <image:image>",
      `      <image:loc>${escapeXml(`${siteUrl}/${image}`)}</image:loc>`,
      "    </image:image>",
    ]),
    "  </url>",
    "</urlset>",
    "",
  ].join("\n");
}

/** Every crawler may read everything, and is told where the sitemap is. */
export const robotsTxt = (siteUrl: string): string =>
  `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`;

/** A plain summary for AI crawlers (llmstxt.org). */
export const llmsTxt = (siteUrl: string, repositoryUrl: string): string =>
  [
    "# Email Platform",
    "",
    `> ${tagline}`,
    "",
    "## Docs",
    "",
    `- [README](${repositoryUrl}#readme): what it does, local setup and configuration`,
    `- [Templates](${repositoryUrl}/blob/main/docs/guide/templates.md): the visual designer, headers, footers and built-in emails`,
    `- [Sending](${repositoryUrl}/blob/main/docs/guide/sending.md): POST /v1/messages, by template ID or name`,
    `- [Email client](${repositoryUrl}/tree/main/packages/email-client): the typed Node client on GitHub Packages`,
    "",
    "## Optional",
    "",
    `- [Website](${siteUrl}/)`,
    `- [Source code](${repositoryUrl})`,
    "",
  ].join("\n");

/** The page's JSON-LD: the software, its source and its screenshots. */
export function structuredData({
  siteUrl,
  repositoryUrl,
  version,
  images,
}: {
  siteUrl: string;
  repositoryUrl: string;
  version: string;
  images: readonly string[];
}): string {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        url: `${siteUrl}/`,
        name: "Email Platform",
        inLanguage: "en-GB",
      },
      {
        "@type": "SoftwareApplication",
        name: "Email Platform",
        description: tagline,
        url: `${siteUrl}/`,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Linux, macOS, Windows (Docker)",
        softwareVersion: version,
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
        author: { "@type": "Person", name: "Adrian Eyre" },
        codeRepository: repositoryUrl,
        image: `${siteUrl}/og-image.png`,
        screenshot: images.map((image) => `${siteUrl}/${image}`),
      },
    ],
  };
  // Safe inside <script>: no "</" can end the element early.
  return JSON.stringify(data).replaceAll("</", "<\\/");
}
