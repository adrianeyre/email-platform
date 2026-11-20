import Handlebars from "handlebars";
import { convert } from "html-to-text";
import type { FieldError } from "../lib/http.js";

export interface TemplateContent {
  subject: string;
  html: string;
  text?: string | null;
}

export interface RenderedContent {
  subject: string;
  html: string;
  text: string;
}

export class TemplateRenderFailedError extends Error {
  override name = "TemplateRenderFailedError";
}

const textWrapColumn = 100;

const render = (
  source: string,
  variables: Readonly<Record<string, unknown>>,
  isEscaped: boolean,
): string => {
  try {
    return Handlebars.compile(source, { noEscape: !isEscaped, strict: false })(
      variables,
    );
  } catch (error) {
    throw new TemplateRenderFailedError(
      error instanceof Error ? error.message : String(error),
    );
  }
};

export const htmlToText = (html: string): string =>
  convert(html, {
    wordwrap: textWrapColumn,
    // The preheader is hidden inbox preview text, not part of the message.
    selectors: [{ selector: ".preheader", format: "skip" }],
  });

export const renderTemplate = (
  content: TemplateContent,
  variables: Readonly<Record<string, unknown>>,
): RenderedContent => {
  const html = render(content.html, variables, true);
  const text =
    content.text === null ||
    content.text === undefined ||
    content.text.trim() === ""
      ? htmlToText(html)
      : render(content.text, variables, false);
  return { subject: render(content.subject, variables, false), html, text };
};

export const checkRequiredVariables = (
  required: readonly string[],
  given: Readonly<Record<string, unknown>>,
): FieldError[] =>
  required
    .filter((name) => given[name] === undefined || given[name] === null)
    .map((name) => ({
      field: `variables.${name}`,
      message: `The required variable "${name}" is missing`,
    }));

export const normaliseVariableNames = (names: readonly string[]): string[] =>
  [
    ...new Set(names.map((name) => name.trim()).filter((name) => name !== "")),
  ].toSorted();
