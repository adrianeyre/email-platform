/**
 * Puts a Template between its Header and Footer. Pure string and data work, so the server uses it to send and the
 * designer uses it to preview.
 */
import {
  createHtmlBlock,
  parseDesign,
  spacing,
  type Block,
  type Design,
} from "./design/model.js";
import { renderDesignHtml } from "./design/render-html.js";

export interface PartContent {
  html: string;
  design: unknown;
}

export interface ComposableTemplate {
  subject: string;
  html: string;
  design: unknown;
}

/*
 * The body scans look for a fixed string and then the next ">", so each is linear in the HTML's length. A pattern such
 * as /<body[^>]*>/ retries [^>]* from every "<body" and is quadratic when none is closed: 40 KB of unclosed "<body"
 * took a quarter of a second, and 1 MB about a minute (pen test S3, #137). Only the first "<body" can start a tag,
 * since a later one has no earlier ">" to close it.
 */
const bodyOpen = /<body/iu;
const bodyClose = /<\/body>/giu;

/** Where the first <body …> tag ends, or undefined when there is none closed with ">". */
const findBodyTagEnd = (html: string): number | undefined => {
  const open = bodyOpen.exec(html);
  if (open === null) {
    return undefined;
  }
  const close = html.indexOf(">", open.index + open[0].length);
  return close === -1 ? undefined : close + 1;
};

/** Where the last </body> at or after `from` starts, or -1. */
const findLastBodyClose = (html: string, from: number): number => {
  let last = -1;
  for (const match of html.slice(from).matchAll(bodyClose)) {
    last = from + match.index;
  }
  return last;
};

/** The part of a full HTML document inside <body>, or the whole text when it has none. */
export const bodyOf = (html: string): string => {
  const start = findBodyTagEnd(html);
  const end = start === undefined ? -1 : findLastBodyClose(html, start);
  return (
    start === undefined || end === -1 ? html : html.slice(start, end)
  ).trim();
};

/** A part's blocks: its design's, or one HTML block holding its hand-written HTML. */
export const partBlocks = (part: PartContent | undefined): Block[] => {
  if (part === undefined) {
    return [];
  }
  const design = parseDesign(part.design);
  if (design !== undefined) {
    return design.blocks;
  }
  const body = bodyOf(part.html);
  return body === "" ? [] : [{ ...createHtmlBlock(body), padding: spacing(0) }];
};

/** The design a Template is sent with: the Header's blocks, its own, then the Footer's. */
export const composeDesign = (
  design: Design,
  header: PartContent | undefined,
  footer: PartContent | undefined,
): Design => ({
  ...design,
  blocks: [...partBlocks(header), ...design.blocks, ...partBlocks(footer)],
});

/**
 * The HTML a Template is sent with. Without a Header or Footer it is the Template's own HTML. With one, a designed
 * Template is rendered again with the parts' blocks around its own, so the email stays one document; a hand-written
 * one has the parts' HTML put just inside its <body>.
 */
export const composeHtml = (
  template: ComposableTemplate,
  header: PartContent | undefined,
  footer: PartContent | undefined,
): string => {
  if (header === undefined && footer === undefined) {
    return template.html;
  }
  const design = parseDesign(template.design);
  if (design !== undefined) {
    return renderDesignHtml(composeDesign(design, header, footer), {
      title: template.subject,
    });
  }
  const top = header === undefined ? "" : bodyOf(header.html);
  const bottom = footer === undefined ? "" : bodyOf(footer.html);
  const start = findBodyTagEnd(template.html);
  if (start === undefined) {
    return [top, template.html, bottom]
      .filter((part) => part !== "")
      .join("\n");
  }
  const end = template.html.search(/<\/body>/iu);
  const close = end === -1 ? template.html.length : end;
  return `${template.html.slice(0, start)}\n${top}${template.html.slice(start, close)}${bottom}\n${template.html.slice(close)}`;
};
