import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  llmsTxt,
  pageImages,
  robotsTxt,
  sitemapXml,
  structuredData,
} from "./seo.ts";

const page = readFileSync(join(import.meta.dirname, "index.html"), "utf8");
const siteUrl = "https://adrianeyre.github.io/email-platform";

describe("the project website", () => {
  it("has a title and description search engines show in full", () => {
    const title = /<title>([^<]+)<\/title>/u.exec(page)?.[1] ?? "";
    const description =
      /<meta\s+name="description"\s+content="([^"]+)"/u.exec(page)?.[1] ?? "";
    expect(title.length).toBeGreaterThan(20);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(description.length).toBeGreaterThan(70);
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it("gives social previews a title, description and 1200 by 630 image", () => {
    for (const property of [
      'property="og:title"',
      'property="og:description"',
      'property="og:image" content="{{SITE_URL}}/og-image.png"',
      'property="og:image:width" content="1200"',
      'property="og:image:height" content="630"',
      'property="og:image:alt"',
      'name="twitter:card" content="summary_large_image"',
      'rel="canonical" href="{{SITE_URL}}/"',
    ]) {
      expect(page).toContain(property);
    }
  });

  it("gives every screenshot a description", () => {
    const images = [...page.matchAll(/<img\b[^>]*>/gu)].map(
      (match) => match[0],
    );
    expect(images.length).toBeGreaterThan(3);
    for (const image of images) {
      expect(image).toMatch(/\balt="[^"]*"/u);
      expect(image).toMatch(/\bwidth="\d+"/u);
      expect(image).toMatch(/\bheight="\d+"/u);
    }
  });

  it("lists the page and its screenshots for crawlers", () => {
    const images = pageImages(page);
    expect(images).toContain("images/ui/designer-header-footer.png");
    const sitemap = sitemapXml(siteUrl, "2026-11-20", images);
    expect(sitemap).toContain(`<loc>${siteUrl}/</loc>`);
    expect(sitemap).toContain(
      `<image:loc>${siteUrl}/images/ui/designer-header-footer.png</image:loc>`,
    );
    expect(robotsTxt(siteUrl)).toContain(`Sitemap: ${siteUrl}/sitemap.xml`);
    expect(llmsTxt(siteUrl, "https://github.com/x/y")).toMatch(
      /^# Email Platform\n/u,
    );
    const data = structuredData({
      siteUrl,
      repositoryUrl: "https://github.com/x/y",
      version: "1.2.3",
      images,
    });
    expect(JSON.parse(data)).toMatchObject({
      "@context": "https://schema.org",
    });
    expect(data).not.toContain("</");
  });
});
