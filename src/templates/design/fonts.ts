export interface FontChoice {
  label: string;
  /** The CSS font-family stack written into the email. */
  stack: string;
  /** Loaded from Google Fonts where the mail app supports web fonts; the stack falls back elsewhere. */
  googleFamily?: string;
}

export const fontChoices: readonly FontChoice[] = [
  { label: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", stack: "Helvetica, Arial, sans-serif" },
  { label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", stack: "Tahoma, Verdana, sans-serif" },
  { label: "Trebuchet MS", stack: "'Trebuchet MS', Helvetica, sans-serif" },
  {
    label: "System UI",
    stack:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  { label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { label: "Times New Roman", stack: "'Times New Roman', Times, serif" },
  {
    label: "Palatino",
    stack: "'Palatino Linotype', 'Book Antiqua', Palatino, serif",
  },
  { label: "Courier New", stack: "'Courier New', Courier, monospace" },
  {
    label: "Inter",
    stack: "Inter, Arial, Helvetica, sans-serif",
    googleFamily: "Inter",
  },
  {
    label: "Roboto",
    stack: "Roboto, Arial, Helvetica, sans-serif",
    googleFamily: "Roboto",
  },
  {
    label: "Open Sans",
    stack: "'Open Sans', Arial, Helvetica, sans-serif",
    googleFamily: "Open Sans",
  },
  {
    label: "Lato",
    stack: "Lato, Arial, Helvetica, sans-serif",
    googleFamily: "Lato",
  },
  {
    label: "Montserrat",
    stack: "Montserrat, Arial, Helvetica, sans-serif",
    googleFamily: "Montserrat",
  },
  {
    label: "Poppins",
    stack: "Poppins, Arial, Helvetica, sans-serif",
    googleFamily: "Poppins",
  },
  {
    label: "Nunito",
    stack:
      "Nunito, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    googleFamily: "Nunito",
  },
  {
    label: "Merriweather",
    stack: "Merriweather, Georgia, serif",
    googleFamily: "Merriweather",
  },
  {
    label: "Playfair Display",
    stack: "'Playfair Display', Georgia, serif",
    googleFamily: "Playfair Display",
  },
  { label: "Lora", stack: "Lora, Georgia, serif", googleFamily: "Lora" },
];

const normalise = (stack: string) =>
  stack
    .replaceAll(/["']/gu, "")
    .replaceAll(/\s*,\s*/gu, ",")
    .trim()
    .toLowerCase();

export const findFont = (stack: string): FontChoice | undefined =>
  fontChoices.find((font) => normalise(font.stack) === normalise(stack));

export const fontLabel = (stack: string): string => {
  const first = stack.split(",")[0]?.replaceAll(/["']/gu, "").trim() ?? "";
  return findFont(stack)?.label ?? (first === "" ? "Default" : first);
};

export const googleFontsUrl = (families: readonly string[]): string =>
  `https://fonts.googleapis.com/css2?${families
    .map(
      (family) =>
        `family=${encodeURIComponent(family).replaceAll("%20", "+")}:ital,wght@0,400;0,700;1,400;1,700`,
    )
    .join("&")}&display=swap`;
