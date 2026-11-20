import { afterEach, describe, expect, it } from "vitest";
import {
  appearanceStorageKey,
  applyAppearance,
  defaultAppearance,
  installThemes,
  loadAppearance,
  storeAppearance,
  themeNames,
  themes,
  themeStylesheet,
  type Palette,
} from "./appearance.js";

const channel = (value: number) => {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string) => {
  const digits = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (digits === null) {
    throw new Error(`Not a #rrggbb colour: ${hex}`);
  }
  const [red, green, blue] = digits
    .slice(1)
    .map((part) => channel(Number.parseInt(part, 16)));
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
};

/** The WCAG 2.2 contrast ratio between two colours. */
const contrast = (first: string, second: string) => {
  const [lighter, darker] = [luminance(first), luminance(second)].toSorted(
    (a, b) => b - a,
  );
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
};

type Pair = readonly [keyof Palette, keyof Palette, number];

/** Foreground, background and the minimum ratio: 4.5 for text (1.4.3), 3 for controls and focus (1.4.11). */
const pairs: readonly Pair[] = [
  ["text", "page", 7],
  ["text", "surface", 7],
  ["text", "surfaceMuted", 7],
  ["text", "accentSoft", 4.5],
  ["textMuted", "page", 4.5],
  ["textMuted", "surface", 4.5],
  ["textMuted", "surfaceMuted", 4.5],
  ["accent", "page", 4.5],
  ["accent", "surface", 4.5],
  ["accent", "surfaceMuted", 4.5],
  ["accent", "accentSoft", 4.5],
  ["accentHover", "surface", 4.5],
  ["accentText", "accent", 4.5],
  ["accentText", "accentHover", 4.5],
  ["danger", "surface", 4.5],
  ["danger", "page", 4.5],
  ["errorText", "errorBackground", 4.5],
  ["successText", "successBackground", 4.5],
  ["warningText", "warningBackground", 4.5],
  ["handlebars", "surface", 4.5],
  ["inputBorder", "surface", 3],
  ["inputBorder", "page", 3],
  ["focus", "page", 3],
  ["focus", "surface", 3],
];

describe("themes", () => {
  it("are the six named themes", () => {
    expect(themes.map((item) => item.name)).toEqual([...themeNames]);
  });

  it.each(
    themes.flatMap((item) =>
      (["light", "dark"] as const).flatMap((mode) =>
        pairs.map(
          ([foreground, background, minimum]) =>
            [item.name, mode, foreground, background, minimum] as const,
        ),
      ),
    ),
  )(
    "%s %s: %s on %s is at least %s:1",
    (name, mode, foreground, background, minimum) => {
      const palette = themes.find((item) => item.name === name)?.[mode];
      if (palette === undefined) {
        throw new Error(`Missing theme ${name}`);
      }
      expect(
        contrast(palette[foreground], palette[background]),
      ).toBeGreaterThanOrEqual(minimum);
    },
  );

  it("writes a light-dark() pair for every token of every theme", () => {
    const css = themeStylesheet();
    expect(css).toContain(':root[data-colour-mode="dark"]{color-scheme:dark;}');
    expect(css).toContain(
      ':root,:root[data-theme="sky"]{--color-page:light-dark(#f3f7fe,#0b1222);',
    );
    expect(css.match(/data-theme=/gu)).toHaveLength(6);
  });
});

describe("the saved appearance", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to the system mode and the Sky theme", () => {
    expect(loadAppearance()).toEqual({
      colourMode: "system",
      themeName: "sky",
    });
    localStorage.setItem(appearanceStorageKey, "not json");
    expect(loadAppearance()).toEqual(defaultAppearance);
    localStorage.setItem(
      appearanceStorageKey,
      JSON.stringify({ colourMode: "purple", themeName: "lagoon" }),
    );
    expect(loadAppearance()).toEqual({
      colourMode: "system",
      themeName: "lagoon",
    });
  });

  it("stores, reloads and applies a choice", () => {
    storeAppearance({ colourMode: "dark", themeName: "berry" });
    const loaded = loadAppearance();
    const root = document.createElement("html");
    applyAppearance(loaded, root);
    expect(root.dataset).toMatchObject({
      colourMode: "dark",
      theme: "berry",
    });
    installThemes();
    installThemes();
    expect(document.head.querySelectorAll("style[data-themes]")).toHaveLength(
      1,
    );
  });
});
