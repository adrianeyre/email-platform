import { renderDesignHtml } from "../templates/design/render-html.js";
import {
  createDesign,
  createHtmlBlock,
  parseDesign,
  spacing,
  type Design,
} from "../templates/design/model.js";
import { findSlugProblem, slugify } from "../templates/slug.js";
import { isRecord, readRecord, readText, readTexts } from "./api-client.js";

export interface TemplateForm {
  name: string;
  /** What applications send the Template by as templateSlug. */
  slug: string;
  /** True while a new Template's slug follows its name, until someone edits the slug. */
  isSlugFollowingName: boolean;
  subject: string;
  html: string;
  text: string;
  variables: string;
  sampleVariables: string;
  /** The visual design, when the HTML is made in the designer rather than written by hand. */
  design: Design | undefined;
  /** The Header and Footer IDs, or "" for none. */
  headerId: string;
  footerId: string;
  /** The Configuration ID, or "" for none. */
  configurationId: string;
}

export const blankTemplateForm: TemplateForm = {
  name: "",
  slug: "",
  isSlugFollowingName: true,
  subject: "",
  html: "<p>Hello {{name}},</p>\n",
  text: "",
  variables: "name",
  sampleVariables: '{\n  "name": "Ada"\n}',
  design: undefined,
  headerId: "",
  footerId: "",
  configurationId: "",
};

export const readTemplateForm = (template: unknown): TemplateForm => ({
  name: readText(template, "name"),
  slug: readText(template, "slug"),
  isSlugFollowingName: false,
  subject: readText(template, "subject"),
  html: readText(template, "html"),
  text: readText(template, "text"),
  variables: readTexts(template, "variables").join(", "),
  sampleVariables: JSON.stringify(
    readRecord(template, "sampleVariables"),
    null,
    2,
  ),
  design: parseDesign(isRecord(template) ? template.design : undefined),
  headerId: readText(template, "headerId"),
  footerId: readText(template, "footerId"),
  configurationId: readText(template, "configurationId"),
});

/** The form after the name changes: a slug that follows the name changes with it. */
export const changeName = (
  form: TemplateForm,
  name: string,
): Pick<TemplateForm, "name" | "slug"> => {
  if (!form.isSlugFollowingName) {
    return { name, slug: form.slug };
  }
  return { name, slug: name.trim() === "" ? "" : slugify(name) };
};

/** The form after someone edits the slug: it stops following the name, and capitals are lowered as typed. */
export const changeSlug = (
  slug: string,
): Pick<TemplateForm, "slug" | "isSlugFollowingName"> => ({
  slug: slug.toLowerCase(),
  isSlugFollowingName: false,
});

/** What is wrong with the slug, or undefined. A slug still following the name is made by the server, so it is fine. */
export const findFormSlugProblem = (form: TemplateForm): string | undefined =>
  form.isSlugFollowingName ? undefined : findSlugProblem(form.slug);

export const splitVariableNames = (variables: string): string[] =>
  variables
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");

export type SampleVariables =
  | { isValid: true; values: Record<string, unknown> }
  | { isValid: false; message: string };

export const parseSampleVariables = (source: string): SampleVariables => {
  if (source.trim() === "") {
    return { isValid: true, values: {} };
  }
  try {
    const parsed: unknown = JSON.parse(source);
    return isRecord(parsed)
      ? { isValid: true, values: parsed }
      : { isValid: false, message: "Sample variables must be a JSON object" };
  } catch (error) {
    return {
      isValid: false,
      message: `Sample variables are not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

export const findMissingSamples = (
  variables: string,
  samples: Record<string, unknown>,
): string[] =>
  splitVariableNames(variables).filter((name) => samples[name] === undefined);

/** The HTML that is saved and sent: rendered from the design when there is one. */
export const templateHtml = (form: TemplateForm): string =>
  form.design === undefined
    ? form.html
    : renderDesignHtml(form.design, { title: form.subject });

export const buildTemplateBody = (
  form: TemplateForm,
  samples: Record<string, unknown>,
) => ({
  name: form.name,
  // Left out while it follows the name, so the server picks a free one, such as order-shipped-2.
  ...(form.isSlugFollowingName ? {} : { slug: form.slug }),
  subject: form.subject,
  html: templateHtml(form),
  text: form.text === "" ? null : form.text,
  variables: splitVariableNames(form.variables),
  sampleVariables: samples,
  design: form.design ?? null,
  headerId: form.headerId === "" ? null : form.headerId,
  footerId: form.footerId === "" ? null : form.footerId,
  configurationId: form.configurationId === "" ? null : form.configurationId,
});

/** The body for saving a Header or Footer. */
export const buildPartBody = (
  form: TemplateForm,
  samples: Record<string, unknown>,
) => ({
  name: form.name,
  html: templateHtml(form),
  sampleVariables: samples,
  design: form.design ?? null,
});

/** Every name the designer offers as a {{variable}}: the required ones, then any other sample. */
export const listVariableNames = (
  variables: string,
  samples: Record<string, unknown>,
): string[] => [
  ...new Set([...splitVariableNames(variables), ...Object.keys(samples)]),
];

/**
 * Starts a design from hand-written HTML by putting its body in one HTML block, so nothing is lost. Styles in the
 * <head> are dropped, which the editor warns about.
 */
export const designFromHtml = (html: string): Design => {
  const body = /<body[^>]*>([\s\S]*)<\/body>/iu.exec(html)?.[1] ?? html;
  const design = createDesign([
    { ...createHtmlBlock(body.trim()), padding: spacing(0) },
  ]);
  return {
    ...design,
    settings: { ...design.settings, contentPadding: 0 },
  };
};

export const hasHeadStyles = (html: string): boolean =>
  /<head[\s\S]*<style/iu.test(html);
