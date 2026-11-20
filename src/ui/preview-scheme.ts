/**
 * The colour scheme the Preview tab shows an email in. Light is the email as written. Dark imitates the mail apps
 * (Gmail and Outlook among them) that darken an email which doesn't style itself for dark mode by inverting its
 * colours: light backgrounds turn dark and dark text turns light, while pictures, logos and icons keep their own
 * colours. It is a close guide, not an exact match for any one app.
 */
export type PreviewScheme = "light" | "dark";

/** Inverts the page, then inverts pictures back so they look as they were drawn. */
const darkStyle =
  "<style data-preview-scheme>" +
  "html{background:#ffffff;filter:invert(1) hue-rotate(180deg);}" +
  "img,svg,video,picture,[style*='background-image']{filter:invert(1) hue-rotate(180deg);}" +
  "</style>";

/** The email HTML to put in the preview frame for a scheme. */
export const withPreviewScheme = (
  html: string,
  scheme: PreviewScheme,
): string => {
  if (scheme === "light") {
    return html;
  }
  const headEnd = /<\/head>/iu.exec(html);
  return headEnd === null
    ? `${darkStyle}${html}`
    : `${html.slice(0, headEnd.index)}${darkStyle}${html.slice(headEnd.index)}`;
};
