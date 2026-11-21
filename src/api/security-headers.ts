import { createHash } from "node:crypto";

/**
 * The headers every response carries, the UI, its files, /v1, /app, /auth, /docs and /health alike (pen test I1, #170).
 *
 * The policy lets no other origin frame a page (`frame-ancestors 'none'`, and `X-Frame-Options: DENY` for browsers that
 * predate it), and loads scripts, styles, images, fonts and connections from the platform's own origin only. The
 * previews' and the designer's `srcdoc` frames inherit it, so an author's HTML loads nothing remote either: no tracking
 * image, stylesheet or font (#155). Styles may be inline, as every email's are and as the designer and CodeMirror set
 * them; scripts may not, beyond the UI page's own inline scripts, allowed by their hashes. Swagger UI at /docs runs
 * under the same policy: it loads its scripts and styles from /docs/static and its icons are `data:` images.
 */
export interface SecurityHeaderParts {
  appUrl: URL;
  /** The UI page's HTML, whose inline scripts the policy allows by their hashes; `undefined` with no UI. */
  indexHtml: string | undefined;
}

/** How long a browser keeps to `https:` once told: one year, the figure HSTS preload lists ask for. */
const strictTransportSecurityMaxAge = 365 * 86_400;

/** The SHA-256 hash, as CSP writes it, of every inline `<script>` in `html` (one with no `src`). */
export const inlineScriptHashes = (html: string): string[] =>
  [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)]
    .filter(([, attributes = ""]) => !/\bsrc\s*=/iu.test(attributes))
    .map(
      ([, , body = ""]) =>
        `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`,
    );

export const contentSecurityPolicy = (indexHtml: string | undefined): string =>
  [
    "default-src 'self'",
    [
      "script-src 'self'",
      ...(indexHtml === undefined ? [] : inlineScriptHashes(indexHtml)),
    ].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

/** The headers, by lower-case name, every response sends. */
export const securityHeaders = (
  parts: SecurityHeaderParts,
): Record<string, string> => ({
  "content-security-policy": contentSecurityPolicy(parts.indexHtml),
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "cross-origin-opener-policy": "same-origin",
  ...(parts.appUrl.protocol === "https:"
    ? {
        "strict-transport-security": `max-age=${String(strictTransportSecurityMaxAge)}`,
      }
    : {}),
});
