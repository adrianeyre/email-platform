# Search engines and icons

## The app

The app's `index.html` has:

- a description and a canonical link;
- Open Graph and X (Twitter) cards with a 1200×630 image;
- JSON-LD structured data.

The server fills in their absolute links from `APP_URL`, and serves `robots.txt` and `sitemap.xml`. Every page's title starts `Email Template - `, such as `Email Template - Logs`.

Icons cover every major device:

- an SVG favicon and a 16, 32 and 48 px `favicon.ico`;
- an Apple touch icon;
- Android and PWA icons, including maskable ones, in `site.webmanifest`;
- a Windows tile and a Safari pinned-tab icon.

## The website

`site/build.ts` writes `sitemap.xml` (with every picture on the page), `robots.txt`, `llms.txt` and the page's JSON-LD from `site/seo.ts`, and `site/seo.test.ts` checks the title and description lengths, the social preview and that every picture has alt text and a size. See [Website, CI and releases](website-ci-and-releases.md).
