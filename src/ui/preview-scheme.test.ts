import { describe, expect, it } from "vitest";
import { withPreviewScheme } from "./preview-scheme.js";

describe("withPreviewScheme", () => {
  const html =
    "<!doctype html><html><head><title>Hi</title></head><body>Hello</body></html>";

  it("leaves the email as written in light", () => {
    expect(withPreviewScheme(html, "light")).toBe(html);
  });

  it("adds the dark-mode style at the end of the head in dark", () => {
    const dark = withPreviewScheme(html, "dark");
    expect(dark).toContain("<title>Hi</title><style data-preview-scheme>");
    expect(dark).toContain("filter:invert(1) hue-rotate(180deg)");
    expect(dark).toMatch(/<\/style><\/head><body>Hello<\/body>/u);
  });

  it("keeps pictures and icons in their own colours", () => {
    expect(withPreviewScheme(html, "dark")).toMatch(/img,svg,video,picture/u);
  });

  it("puts the style first when the HTML has no head", () => {
    expect(withPreviewScheme("<p>Hi</p>", "dark")).toMatch(
      /^<style data-preview-scheme>.*<\/style><p>Hi<\/p>$/u,
    );
  });
});
