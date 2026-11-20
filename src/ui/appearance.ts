/**
 * Colour mode and theme. Each theme is a set of colour tokens for light and dark, checked by
 * appearance.test.ts to meet WCAG 2.2 AA contrast: 4.5:1 for text and 3:1 for controls and focus.
 */

export const colourModes = ["system", "light", "dark"] as const;
export type ColourMode = (typeof colourModes)[number];

export const themeNames = [
  "sky",
  "grape",
  "forest",
  "sunset",
  "berry",
  "lagoon",
] as const;
export type ThemeName = (typeof themeNames)[number];

export interface Appearance {
  colourMode: ColourMode;
  themeName: ThemeName;
}

export const defaultAppearance: Appearance = {
  colourMode: "system",
  themeName: "sky",
};

export const appearanceStorageKey = "email-platform.appearance";

/** Every colour the UI uses, by role. */
export interface Palette {
  page: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  textMuted: string;
  border: string;
  inputBorder: string;
  accent: string;
  accentHover: string;
  accentText: string;
  accentSoft: string;
  focus: string;
  danger: string;
  errorBackground: string;
  errorText: string;
  successBackground: string;
  successText: string;
  warningBackground: string;
  warningText: string;
  handlebars: string;
}

export interface Theme {
  name: ThemeName;
  label: string;
  description: string;
  light: Palette;
  dark: Palette;
}

const lightBase = {
  surface: "#ffffff",
  text: "#0f172a",
  textMuted: "#475569",
  inputBorder: "#64748b",
  accentText: "#ffffff",
  danger: "#b91c1c",
  errorBackground: "#fef2f2",
  errorText: "#991b1b",
  successBackground: "#f0fdf4",
  successText: "#166534",
  warningBackground: "#fffbeb",
  warningText: "#92400e",
  handlebars: "#7e22ce",
};

const darkBase = {
  text: "#e8edf6",
  textMuted: "#aab4c6",
  inputBorder: "#8391a7",
  accentText: "#0b1020",
  danger: "#fca5a5",
  errorBackground: "#3a1418",
  errorText: "#fecaca",
  successBackground: "#0e2a1a",
  successText: "#86efac",
  warningBackground: "#33280a",
  warningText: "#fde68a",
  handlebars: "#d8b4fe",
};

const theme = (
  name: ThemeName,
  label: string,
  description: string,
  light: Omit<Palette, keyof typeof lightBase | "focus">,
  dark: Omit<Palette, keyof typeof darkBase | "focus">,
): Theme => ({
  name,
  label,
  description,
  light: { ...lightBase, ...light, focus: light.accent },
  dark: { ...darkBase, ...dark, focus: dark.accent },
});

export const themes: readonly Theme[] = [
  theme(
    "sky",
    "Sky",
    "Calm blue",
    {
      page: "#f3f7fe",
      surfaceMuted: "#eaf1fd",
      border: "#d5e1f7",
      accent: "#1d4ed8",
      accentHover: "#1e40af",
      accentSoft: "#dbeafe",
    },
    {
      page: "#0b1222",
      surface: "#141d31",
      surfaceMuted: "#1c2740",
      border: "#2b3a5a",
      accent: "#7cb4fb",
      accentHover: "#a5cbfd",
      accentSoft: "#1e3358",
    },
  ),
  theme(
    "grape",
    "Grape",
    "Rich violet",
    {
      page: "#f7f5ff",
      surfaceMuted: "#f1edfe",
      border: "#e2daf8",
      accent: "#6d28d9",
      accentHover: "#5b21b6",
      accentSoft: "#ede9fe",
    },
    {
      page: "#100c1f",
      surface: "#1a1530",
      surfaceMuted: "#241d3f",
      border: "#3a2f62",
      accent: "#b9a4fb",
      accentHover: "#d2c5fd",
      accentSoft: "#2f2557",
    },
  ),
  theme(
    "forest",
    "Forest",
    "Deep green",
    {
      page: "#f2fbf5",
      surfaceMuted: "#e9f6ee",
      border: "#cdead8",
      accent: "#15803d",
      accentHover: "#166534",
      accentSoft: "#dcfce7",
    },
    {
      page: "#07140d",
      surface: "#0f1f16",
      surfaceMuted: "#172b20",
      border: "#24452f",
      accent: "#5fe08f",
      accentHover: "#93ecb3",
      accentSoft: "#163d26",
    },
  ),
  theme(
    "sunset",
    "Sunset",
    "Warm orange",
    {
      page: "#fff8f1",
      surfaceMuted: "#fdf0e4",
      border: "#f6dcc4",
      accent: "#c2410c",
      accentHover: "#9a3412",
      accentSoft: "#ffedd5",
    },
    {
      page: "#170e07",
      surface: "#22160d",
      surfaceMuted: "#2e1f13",
      border: "#4a311d",
      accent: "#fb9a4b",
      accentHover: "#fdbb83",
      accentSoft: "#4a2a12",
    },
  ),
  theme(
    "berry",
    "Berry",
    "Bold pink",
    {
      page: "#fef4f9",
      surfaceMuted: "#fcebf4",
      border: "#f5d3e4",
      accent: "#be185d",
      accentHover: "#9d174d",
      accentSoft: "#fce7f3",
    },
    {
      page: "#180a12",
      surface: "#22111b",
      surfaceMuted: "#2e1825",
      border: "#4d2439",
      accent: "#f68cc4",
      accentHover: "#f9b4d8",
      accentSoft: "#4a1d35",
    },
  ),
  theme(
    "lagoon",
    "Lagoon",
    "Cool teal",
    {
      page: "#f1fbf9",
      surfaceMuted: "#e7f6f3",
      border: "#c9e9e3",
      accent: "#0f766e",
      accentHover: "#115e59",
      accentSoft: "#ccfbf1",
    },
    {
      page: "#061413",
      surface: "#0d1f1d",
      surfaceMuted: "#142b28",
      border: "#1f4541",
      accent: "#3ddcc6",
      accentHover: "#7ae8d9",
      accentSoft: "#123d39",
    },
  ),
];

const tokenNames: Record<keyof Palette, string> = {
  page: "--color-page",
  surface: "--color-surface",
  surfaceMuted: "--color-surface-muted",
  text: "--color-text",
  textMuted: "--color-text-muted",
  border: "--color-border",
  inputBorder: "--color-input-border",
  accent: "--color-accent",
  accentHover: "--color-accent-hover",
  accentText: "--color-accent-text",
  accentSoft: "--color-accent-soft",
  focus: "--color-focus",
  danger: "--color-danger",
  errorBackground: "--color-error-bg",
  errorText: "--color-error-text",
  successBackground: "--color-success-bg",
  successText: "--color-success-text",
  warningBackground: "--color-warning-bg",
  warningText: "--color-warning-text",
  handlebars: "--color-handlebars",
};

const paletteKeys = Object.keys(tokenNames).filter(
  (key): key is keyof Palette => key in tokenNames,
);

/** The CSS for every theme: light-dark() pairs that follow color-scheme, which the mode sets. */
export const themeStylesheet = (): string =>
  [
    ":root{color-scheme:light dark;}",
    ':root[data-colour-mode="light"]{color-scheme:light;}',
    ':root[data-colour-mode="dark"]{color-scheme:dark;}',
    ...themes.map((item, index) => {
      const selector =
        index === 0
          ? `:root,:root[data-theme="${item.name}"]`
          : `:root[data-theme="${item.name}"]`;
      const declarations = paletteKeys
        .map(
          (key) =>
            `${tokenNames[key]}:light-dark(${item.light[key]},${item.dark[key]});`,
        )
        .join("");
      return `${selector}{${declarations}}`;
    }),
  ].join("\n");

const isColourMode = (value: unknown): value is ColourMode =>
  colourModes.some((mode) => mode === value);

const isThemeName = (value: unknown): value is ThemeName =>
  themeNames.some((name) => name === value);

/** Reads the saved choice, falling back to the default when storage is empty, blocked or wrong. */
export const loadAppearance = (): Appearance => {
  try {
    const stored = localStorage.getItem(appearanceStorageKey);
    const value: unknown = stored === null ? {} : JSON.parse(stored);
    if (typeof value !== "object" || value === null) {
      return defaultAppearance;
    }
    return {
      colourMode:
        "colourMode" in value && isColourMode(value.colourMode)
          ? value.colourMode
          : defaultAppearance.colourMode,
      themeName:
        "themeName" in value && isThemeName(value.themeName)
          ? value.themeName
          : defaultAppearance.themeName,
    };
  } catch {
    return defaultAppearance;
  }
};

export const storeAppearance = (appearance: Appearance): void => {
  try {
    localStorage.setItem(appearanceStorageKey, JSON.stringify(appearance));
  } catch {
    // Private browsing can block storage; the choice still applies to this page.
  }
};

export const applyAppearance = (
  { colourMode, themeName }: Appearance,
  root: HTMLElement = document.documentElement,
): void => {
  root.dataset.colourMode = colourMode;
  root.dataset.theme = themeName;
};

/** Adds the theme stylesheet once. */
export const installThemes = (head: HTMLElement = document.head): void => {
  if (head.querySelector("style[data-themes]") !== null) {
    return;
  }
  const style = document.createElement("style");
  style.dataset.themes = "";
  style.textContent = themeStylesheet();
  head.prepend(style);
};
