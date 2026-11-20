import { describe, expect, it } from "vitest";
import {
  renderIndexHtml,
  robotsTxt,
  siteUrl,
  sitemapXml,
} from "./site-files.js";

const appUrl = new URL("https://mail.example.com/");

describe("site files", () => {
  it("fills in absolute links, so social cards and canonical links work", () => {
    const html = renderIndexHtml(
      '<link rel="canonical" href="__APP_URL__/"><meta property="og:image" content="__APP_URL__/og-image.png">',
      appUrl,
    );
    expect(html).toBe(
      '<link rel="canonical" href="https://mail.example.com/"><meta property="og:image" content="https://mail.example.com/og-image.png">',
    );
    expect(siteUrl(new URL("https://example.com/mail/"))).toBe(
      "https://example.com/mail",
    );
  });

  it("lists the site for search engines and keeps them out of the APIs", () => {
    expect(robotsTxt(appUrl)).toContain("Disallow: /v1/");
    expect(robotsTxt(appUrl)).toContain(
      "Sitemap: https://mail.example.com/sitemap.xml",
    );
    expect(sitemapXml(appUrl, new Date("2026-11-20T12:00:00Z"))).toContain(
      "<loc>https://mail.example.com/</loc>\n    <lastmod>2026-11-20</lastmod>",
    );
  });
});
