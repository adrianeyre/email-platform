/**
 * Turns a visual Design into email HTML: tables, inline styles, an Outlook (VML) button, columns that stack on phones
 * and a hidden preheader. Handlebars expressions such as {{name}} pass through untouched, to be rendered at send time.
 * Pure string building, so it runs in the browser (the designer) and on the server (the CLI).
 */
import { findFont, googleFontsUrl } from "./fonts.js";
import { socialIcons, socialIconSvg } from "./social-icons.js";
import { defaultFontFamily } from "./model.js";
import type {
  Block,
  ButtonBlock,
  ColumnsBlock,
  Design,
  DesignSettings,
  DividerBlock,
  ImageBlock,
  LeafBlock,
  SocialBlock,
  Spacing,
} from "./model.js";

const textEscapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/** Escapes text for an element body, leaving quotes alone so Handlebars helpers such as (eq a "b") keep working. */
export const escapeText = (value: string): string =>
  value.replaceAll(
    /[&<>]/gu,
    (character) => textEscapes[character] ?? character,
  );

export const escapeAttribute = (value: string): string =>
  value.replaceAll(
    /[&<>"]/gu,
    (character) => textEscapes[character] ?? character,
  );

const isColor = (value: string) =>
  /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent|[a-z]+)$/iu.test(
    value.trim(),
  );

/** Keeps a colour only when it is one, so a value can't break out of a style attribute. */
export const safeColor = (value: string, fallback = ""): string =>
  isColor(value) ? value.trim() : fallback;

/**
 * A CSS font stack: font names of letters, digits, spaces, hyphens and underscores, each bare or in matching quotes,
 * separated by commas. Nothing in it can end the declaration, add another, or leave a style attribute or a <style>.
 */
const fontName = /^(?:'[\w -]+'|"[\w -]+"|[\w -]+)$/u;

const isFontStack = (value: string): boolean =>
  value.split(",").every((name) => fontName.test(name.trim()));

/**
 * Keeps a font stack only when it is one, else the fallback, so a value can't add CSS of its own (#156). Double quotes
 * become single ones, as the stack is written into style="…" attributes.
 */
export const safeFont = (
  value: string,
  fallback = defaultFontFamily,
): string =>
  isFontStack(value) ? value.trim().replaceAll('"', "'") : fallback;

/** A Block's condition: one variable path such as isVip or user.isVip, so it can carry no Handlebars of its own. */
const conditionPath = /^@?[a-z_$][\w$-]*(?:\.[\w$-]+)*$/iu;

/** Keeps a Block's showIf only when it is a variable path, else none (#153). */
export const safeCondition = (value: string): string =>
  conditionPath.test(value.trim()) ? value.trim() : "";

/**
 * A Block's link or image source: an http(s), mailto or tel URL, a #fragment, or one starting with a {{variable}}
 * filled in when the email is sent.
 */
const safeUrlStart =
  /^(?:https?:\/\/|mailto:|tel:|#|\{\{\s*@?[\w$.-]+\s*\}\})/iu;

/** Keeps a Block's URL only when it is one of those, else "", so javascript:, data: and the like never reach the email (#154). */
export const safeUrl = (value: string): string =>
  safeUrlStart.test(value.trim()) ? value.trim() : "";

const px = (value: number) => `${String(Math.round(value))}px`;

const paddingCss = ({ top, right, bottom, left }: Spacing) =>
  `${px(top)} ${px(right)} ${px(bottom)} ${px(left)}`;

const tableAttributes =
  'role="presentation" cellpadding="0" cellspacing="0" border="0"';

/* ---------- Rich text ---------- */

const mergeStyle = (attributes: string, defaults: string): string => {
  const existing = /\sstyle="([^"]*)"/iu.exec(attributes);
  if (existing === null) {
    return `${attributes} style="${defaults}"`;
  }
  const merged = `${defaults}${existing[1] ?? ""}`;
  return attributes.replace(existing[0], ` style="${merged}"`);
};

const voidTags = new Set(["br", "img", "hr", "wbr"]);

/**
 * Gives the HTML from the rich-text editor the inline styles mail apps need, such as paragraph spacing and link
 * colours, keeping any style the author set. The last top-level element loses its bottom margin.
 */
export const styleRichText = (
  html: string,
  settings: DesignSettings,
): string => {
  const gap = Math.round(settings.fontSize * 0.75);
  const heading = (scale: number) =>
    `margin:0 0 ${px(gap)};font-size:${px(settings.fontSize * scale)};line-height:1.25;font-weight:700;color:${safeColor(settings.headingColor, "#111827")};`;
  const styles = (
    tag: string,
    parent: string | undefined,
  ): string | undefined => {
    switch (tag) {
      case "p":
        return parent === "li" ? "margin:0;" : `margin:0 0 ${px(gap)};`;
      case "h1":
        return heading(1.75);
      case "h2":
        return heading(1.4);
      case "h3":
        return heading(1.15);
      case "ul":
      case "ol":
        return `margin:0 0 ${px(gap)};padding:0 0 0 24px;`;
      case "li":
        return "margin:0 0 4px;";
      case "a":
        return `color:${safeColor(settings.linkColor, "#2563eb")};text-decoration:underline;`;
      case "blockquote":
        return `margin:0 0 ${px(gap)};padding:0 0 0 12px;border-left:3px solid #d1d5db;`;
      default:
        return undefined;
    }
  };

  const stack: string[] = [];
  let lastTopLevel: { start: number; tag: string } | undefined;
  const pieces: { start: number; end: number; text: string }[] = [];
  for (const match of html.matchAll(/<(\/?)([a-z][a-z0-9]*)([^>]*)>/giu)) {
    const [whole, closing = "", rawTag = "", attributes = ""] = match;
    const tag = rawTag.toLowerCase();
    if (closing === "/") {
      const at = stack.lastIndexOf(tag);
      if (at !== -1) {
        stack.length = at;
      }
      continue;
    }
    const parent = stack.at(-1);
    const defaults = styles(tag, parent);
    const start = match.index;
    if (stack.length === 0) {
      lastTopLevel = defaults === undefined ? undefined : { start, tag };
    }
    if (defaults !== undefined) {
      const selfClosing = attributes.endsWith("/");
      pieces.push({
        start,
        end: start + whole.length,
        text: `<${rawTag}${mergeStyle(selfClosing ? attributes.slice(0, -1) : attributes, defaults)}${selfClosing ? "/" : ""}>`,
      });
    }
    if (!voidTags.has(tag) && !attributes.endsWith("/")) {
      stack.push(tag);
    }
  }
  let result = "";
  let cursor = 0;
  for (const piece of pieces) {
    let text = piece.text;
    if (lastTopLevel?.start === piece.start) {
      text = text.replace(/margin:0 0 \d+px;/u, "margin:0;");
    }
    result += html.slice(cursor, piece.start) + text;
    cursor = piece.end;
  }
  return result + html.slice(cursor);
};

/* ---------- Blocks ---------- */

const wrapLink = (href: string, inner: string) =>
  safeUrl(href) === ""
    ? inner
    : `<a href="${escapeAttribute(safeUrl(href))}" target="_blank" style="text-decoration:none;">${inner}</a>`;

/** A rough width for Outlook's button shape, which can't grow to fit its label. */
const estimateButtonWidth = (block: ButtonBlock) =>
  Math.round(
    block.label.replaceAll(/\{\{[^}]*\}\}/gu, "xxxxxxxx").length *
      block.fontSize *
      (block.isBold ? 0.62 : 0.56) +
      block.innerPaddingX * 2,
  );

const renderButton = (
  block: ButtonBlock,
  settings: DesignSettings,
  width: number,
): string => {
  const font = safeFont(block.fontFamily, safeFont(settings.fontFamily));
  const fill = safeColor(block.buttonColor, "#2563eb");
  const ink = safeColor(block.textColor, "#ffffff");
  const border =
    block.borderWidth > 0
      ? `border:${px(block.borderWidth)} solid ${safeColor(block.borderColor, fill)};`
      : "";
  const href = escapeAttribute(safeUrl(block.url) || "#");
  const label = escapeText(block.label);
  const lineHeight = Math.round(block.fontSize * 1.25);
  const height = lineHeight + block.innerPaddingY * 2 + block.borderWidth * 2;
  const vmlWidth = block.isFullWidth
    ? width
    : Math.min(width, estimateButtonWidth(block));
  const arc = Math.min(
    50,
    Math.round((block.borderRadius / Math.max(height, 1)) * 100),
  );
  const textStyle = `font-family:${font};font-size:${px(block.fontSize)};font-weight:${block.isBold ? "700" : "400"};font-style:${block.isItalic ? "italic" : "normal"};letter-spacing:${px(block.letterSpacing)};line-height:${px(lineHeight)};color:${ink};`;
  return [
    `<table ${tableAttributes} width="100%"><tr><td align="${block.align}">`,
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:${px(height)};v-text-anchor:middle;width:${px(vmlWidth)};" arcsize="${String(arc)}%" ${block.borderWidth > 0 ? `strokecolor="${safeColor(block.borderColor, fill)}" strokeweight="${px(block.borderWidth)}"` : 'stroke="f"'} fillcolor="${fill}"><w:anchorlock/><center style="${textStyle}">${label}</center></v:roundrect><![endif]-->`,
    `<!--[if !mso]><!-->`,
    `<table ${tableAttributes}${block.isFullWidth ? ' width="100%"' : ""} style="border-collapse:separate;"><tr>`,
    `<td align="center" bgcolor="${fill}" style="border-radius:${px(block.borderRadius)};background-color:${fill};">`,
    `<a href="${href}" target="_blank" style="display:${block.isFullWidth ? "block" : "inline-block"};padding:${px(block.innerPaddingY)} ${px(block.innerPaddingX)};${border}border-radius:${px(block.borderRadius)};${textStyle}text-decoration:none;text-align:center;">${label}</a>`,
    `</td></tr></table>`,
    `<!--<![endif]-->`,
    `</td></tr></table>`,
  ].join("");
};

const renderImage = (block: ImageBlock, width: number): string => {
  const src = safeUrl(block.src);
  if (src === "") {
    return "";
  }
  const pixels = Math.round((width * block.widthPercent) / 100);
  const image = `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(block.alt)}" width="${String(pixels)}" style="display:block;width:100%;max-width:${px(pixels)};height:auto;border:0;outline:none;text-decoration:none;border-radius:${px(block.borderRadius)};">`;
  return `<table ${tableAttributes} width="100%"><tr><td align="${block.align}"><table ${tableAttributes} width="${String(pixels)}" style="width:100%;max-width:${px(pixels)};"><tr><td>${wrapLink(block.href, image)}</td></tr></table></td></tr></table>`;
};

const renderDivider = (block: DividerBlock): string =>
  `<table ${tableAttributes} width="100%"><tr><td align="${block.align}"><table ${tableAttributes} width="${String(block.widthPercent)}%"><tr><td style="border-top:${px(block.thickness)} ${block.style} ${safeColor(block.color, "#e5e7eb")};font-size:0;line-height:0;height:0;">&nbsp;</td></tr></table></td></tr></table>`;

/**
 * A row of linked icons. Each icon is SVG written into the email, so nothing is fetched to show it; a link with no
 * address is left out.
 */
const renderSocial = (block: SocialBlock, settings: DesignSettings): string => {
  const links = block.links.filter((link) => safeUrl(link.url) !== "");
  if (links.length === 0) {
    return "";
  }
  const half = block.gap / 2;
  const labelColor = safeColor(settings.textColor, "#1f2937");
  const cells = links.map((link, index) => {
    const label = socialIcons[link.network].label;
    const icon = socialIconSvg(link.network, block, block.iconSize);
    const text = block.showLabels
      ? `<td valign="middle" style="padding:0 0 0 8px;font-family:${safeFont(settings.fontFamily)};font-size:${px(Math.max(12, Math.min(18, block.iconSize * 0.45)))};line-height:1.2;color:${labelColor};white-space:nowrap;">${escapeText(label)}</td>`
      : "";
    const left = index === 0 ? 0 : half;
    const right = index === links.length - 1 ? 0 : half;
    return `<td valign="middle" style="padding:0 ${px(right)} 0 ${px(left)};"><a href="${escapeAttribute(safeUrl(link.url))}" target="_blank" title="${escapeAttribute(label)}" style="text-decoration:none;color:${labelColor};"><table ${tableAttributes}><tr><td valign="middle" width="${String(Math.round(block.iconSize))}" style="line-height:0;font-size:0;">${icon}</td>${text}</tr></table></a></td>`;
  });
  return `<table ${tableAttributes} width="100%"><tr><td align="${block.align}"><table ${tableAttributes}><tr>${cells.join("")}</tr></table></td></tr></table>`;
};

const renderText = (html: string, settings: DesignSettings): string =>
  `<div style="font-family:${safeFont(settings.fontFamily)};font-size:${px(settings.fontSize)};line-height:${String(settings.lineHeight)};color:${safeColor(settings.textColor, "#1f2937")};">${styleRichText(html, settings)}</div>`;

const renderLeafContent = (
  block: LeafBlock,
  settings: DesignSettings,
  width: number,
): string => {
  switch (block.type) {
    case "text":
      return renderText(block.html, settings);
    case "button":
      return renderButton(block, settings, width);
    case "image":
      return renderImage(block, width);
    case "divider":
      return renderDivider(block);
    case "spacer":
      return `<div style="height:${px(block.height)};line-height:${px(block.height)};font-size:1px;">&#8202;</div>`;
    case "html":
      return block.html;
    case "social":
      return renderSocial(block, settings);
  }
};

const hasBox = (block: Block) =>
  block.backgroundColor !== "" ||
  block.boxBorderWidth > 0 ||
  block.boxPadding > 0 ||
  block.boxBorderRadius > 0;

const boxStyle = (block: Block): string => {
  const background = safeColor(block.backgroundColor);
  const color = safeColor(block.boxBorderColor, "#e5e7eb");
  const border =
    block.boxBorderWidth === 0
      ? ""
      : block.boxBorderSide === "left"
        ? `border-left:${px(block.boxBorderWidth)} solid ${color};`
        : `border:${px(block.boxBorderWidth)} solid ${color};`;
  return `${background === "" ? "" : `background-color:${background};`}${border}border-radius:${px(block.boxBorderRadius)};padding:${px(block.boxPadding)};`;
};

const renderColumns = (
  block: ColumnsBlock,
  settings: DesignSettings,
  width: number,
): string => {
  const count = block.columns.length;
  const cells = block.columns.map((column, index) => {
    const columnWidth = Math.round((width * column.widthPercent) / 100);
    const left = index === 0 ? 0 : block.gap / 2;
    const right = index === count - 1 ? 0 : block.gap / 2;
    const isLast = index === count - 1;
    return `<td class="${block.stackOnMobile ? `stack-column${isLast ? "" : " stack-column-gap"}` : ""}" width="${String(columnWidth)}" valign="${block.verticalAlign}" style="width:${String(column.widthPercent)}%;padding:0 ${px(right)} 0 ${px(left)};vertical-align:${block.verticalAlign};">${renderRows(column.blocks, settings, columnWidth - left - right)}</td>`;
  });
  return `<table ${tableAttributes} width="100%"><tr>${cells.join("")}</tr></table>`;
};

const renderBlock = (
  block: Block,
  settings: DesignSettings,
  width: number,
): string => {
  const inner = width - block.padding.left - block.padding.right;
  const contentWidth = hasBox(block)
    ? inner - block.boxPadding * 2 - block.boxBorderWidth * 2
    : inner;
  const content =
    block.type === "columns"
      ? renderColumns(block, settings, contentWidth)
      : renderLeafContent(block, settings, contentWidth);
  const boxed = hasBox(block)
    ? `<table ${tableAttributes} width="100%" style="border-collapse:separate;"><tr><td${safeColor(block.backgroundColor) === "" ? "" : ` bgcolor="${safeColor(block.backgroundColor)}"`} style="${boxStyle(block)}">${content}</td></tr></table>`
    : content;
  const row = `<tr${block.hideOnMobile ? ' class="hide-mobile"' : ""}><td style="padding:${paddingCss(block.padding)};">${boxed}</td></tr>`;
  const condition = safeCondition(block.showIf);
  return condition === "" ? row : `{{#if ${condition}}}${row}{{/if}}`;
};

const renderRows = (
  blocks: readonly Block[],
  settings: DesignSettings,
  width: number,
): string =>
  `<table ${tableAttributes} width="100%">${blocks.map((block) => renderBlock(block, settings, width)).join("")}</table>`;

/* ---------- The document ---------- */

const collectGoogleFonts = (design: Design): string[] => {
  const stacks = [design.settings.fontFamily];
  const visit = (block: Block) => {
    if (block.type === "button" && block.fontFamily !== "") {
      stacks.push(block.fontFamily);
    }
    if (block.type === "text") {
      for (const match of block.html.matchAll(/font-family:\s*([^;"]+)/giu)) {
        stacks.push((match[1] ?? "").replaceAll("&quot;", '"'));
      }
    }
    if (block.type === "columns") {
      block.columns.forEach((column) => {
        column.blocks.forEach(visit);
      });
    }
  };
  design.blocks.forEach(visit);
  return [
    ...new Set(
      stacks
        .map((stack) => findFont(stack)?.googleFamily)
        .filter((family) => family !== undefined),
    ),
  ];
};

/** Enough invisible space after the preheader that an inbox shows nothing of the body after it. */
const preheaderPadding = "&#847;&zwnj;&nbsp;".repeat(60);

/**
 * Just the blocks, on the content background with no outer page or card, for showing a Header or Footer inside the
 * designer in line with the Template being edited.
 */
export const renderDesignFragment = (design: Design): string => {
  const { settings } = design;
  const fonts = collectGoogleFonts(design);
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    ...(fonts.length === 0
      ? []
      : [
          `<link href="${escapeAttribute(googleFontsUrl(fonts))}" rel="stylesheet">`,
        ]),
    `<style>html,body{margin:0;padding:0;background:${safeColor(settings.contentBackgroundColor, "#ffffff")};}table{border-collapse:collapse;}a{color:${safeColor(settings.linkColor, "#2563eb")};}</style>`,
    "</head><body>",
    renderRows(design.blocks, settings, settings.contentWidth),
    "</body></html>",
  ].join("");
};

export const renderDesignHtml = (
  design: Design,
  { title = "" }: { title?: string } = {},
): string => {
  const { settings } = design;
  const width = settings.contentWidth;
  const background = safeColor(settings.backgroundColor, "#f3f4f6");
  const card = safeColor(settings.contentBackgroundColor, "#ffffff");
  const fonts = collectGoogleFonts(design);
  const preheader = settings.preheader.trim();
  return [
    "<!doctype html>",
    '<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta http-equiv="X-UA-Compatible" content="IE=edge">',
    '<meta name="x-apple-disable-message-reformatting">',
    '<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    `<title>${escapeText(title)}</title>`,
    "<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->",
    ...(fonts.length === 0
      ? []
      : [
          `<!--[if !mso]><!--><link href="${escapeAttribute(googleFontsUrl(fonts))}" rel="stylesheet"><!--<![endif]-->`,
        ]),
    "<style>",
    "html,body{margin:0!important;padding:0!important;width:100%!important;}",
    "body{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}",
    "table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}",
    "table{border-collapse:collapse;}",
    "img{-ms-interpolation-mode:bicubic;}",
    `a{color:${safeColor(settings.linkColor, "#2563eb")};}`,
    "a[x-apple-data-detectors],u+#body a{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important;}",
    `@media screen and (max-width:${px(width + 32)}){`,
    ".email-container{width:100%!important;max-width:100%!important;}",
    ".email-outer{padding:12px 8px!important;}",
    ".stack-column{display:block!important;width:100%!important;max-width:100%!important;padding-left:0!important;padding-right:0!important;}",
    ".stack-column-gap{padding-bottom:16px!important;}",
    ".hide-mobile{display:none!important;mso-hide:all;}",
    "}",
    "</style>",
    "</head>",
    `<body id="body" style="margin:0;padding:0;word-spacing:normal;background-color:${background};">`,
    preheader === ""
      ? ""
      : `<div class="preheader" style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${background};">${escapeText(preheader)}${preheaderPadding}</div>`,
    `<table ${tableAttributes} width="100%" bgcolor="${background}" style="background-color:${background};">`,
    `<tr><td align="center" class="email-outer" style="padding:32px 16px;">`,
    `<!--[if mso]><table ${tableAttributes} width="${String(width)}"><tr><td><![endif]-->`,
    `<table ${tableAttributes} width="100%" class="email-container" bgcolor="${card}" style="max-width:${px(width)};background-color:${card};border-collapse:separate;border-radius:${px(settings.contentBorderRadius)};${safeColor(settings.contentBorderColor) === "" ? "" : `border:1px solid ${safeColor(settings.contentBorderColor)};`}">`,
    `<tr><td style="padding:${px(settings.contentPadding)} 0;">`,
    renderRows(design.blocks, settings, width),
    "</td></tr>",
    "</table>",
    "<!--[if mso]></td></tr></table><![endif]-->",
    "</td></tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("\n");
};
