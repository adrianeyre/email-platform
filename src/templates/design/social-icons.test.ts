import { describe, expect, it } from "vitest";
import {
  glyphColorOn,
  isSocialNetwork,
  socialIconColors,
  socialIcons,
  socialIconSvg,
  socialNetworks,
} from "./social-icons.js";

const look = {
  shape: "circle",
  colorMode: "brand",
  customColor: "#111827",
} as const;

describe("the built-in social icons", () => {
  it("has a label, a brand colour and path data for every network", () => {
    expect(socialNetworks.length).toBeGreaterThanOrEqual(27);
    for (const network of socialNetworks) {
      const icon = socialIcons[network];
      expect(icon.label).not.toBe("");
      expect(icon.color).toMatch(/^#[0-9A-F]{6}$/u);
      expect(icon.path).toMatch(/^[Mm][MmLlHhVvCcSsQqTtAaZz0-9.,\-\s]+$/u);
    }
    expect(isSocialNetwork("linkedin")).toBe(true);
    expect(isSocialNetwork("myspace")).toBe(false);
  });

  it("puts white on a dark brand colour and near-black on a light one", () => {
    expect(glyphColorOn("#0A66C2")).toBe("#ffffff");
    expect(glyphColorOn("#FFFC00")).toBe("#111827");
    expect(glyphColorOn("#fff")).toBe("#111827");
    expect(glyphColorOn("not a colour")).toBe("#ffffff");
  });

  it("colours the shape, or the icon itself when Plain", () => {
    expect(socialIconColors("linkedin", look)).toEqual({
      background: "#0A66C2",
      glyph: "#ffffff",
    });
    expect(socialIconColors("snapchat", look).glyph).toBe("#111827");
    expect(socialIconColors("linkedin", { ...look, shape: "plain" })).toEqual({
      background: undefined,
      glyph: "#0A66C2",
    });
    expect(socialIconColors("x", { ...look, colorMode: "light" })).toEqual({
      background: "#f3f4f6",
      glyph: "#111827",
    });
    expect(
      socialIconColors("x", {
        ...look,
        colorMode: "custom",
        customColor: "#be185d",
      }),
    ).toEqual({ background: "#be185d", glyph: "#ffffff" });
    // A custom colour that isn't one falls back rather than reaching the SVG.
    expect(
      socialIconColors("x", {
        ...look,
        colorMode: "custom",
        customColor: '"/><script>',
      }).background,
    ).toBe("#111827");
  });

  it("draws one icon as self-contained, labelled SVG", () => {
    const svg = socialIconSvg("github", look, 32);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/u);
    expect(svg).toContain('width="32" height="32"');
    expect(svg).toContain('role="img" aria-label="GitHub"');
    expect(svg).toContain("<title>GitHub</title>");
    expect(svg).toContain(
      '<rect width="24" height="24" rx="12" fill="#181717"/>',
    );
    expect(svg).toContain("scale(0.55)");
    expect(svg).not.toContain("http://cdn");

    const plainOutline = socialIconSvg(
      "email",
      { ...look, shape: "plain" },
      20,
    );
    expect(plainOutline).not.toContain("<rect");
    expect(plainOutline).toContain('fill="none" stroke="#2563EB"');
  });
});
