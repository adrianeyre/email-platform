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

/** The most characters a rendered HTML or text part may have: about 1 MB (pen test S3, #137). */
export const maxRenderedLength = 1_000_000;

/** The most characters a rendered subject may have, the same as a raw subject's (RFC 5322's line limit; #152). */
export const maxSubjectLength = 998;

/**
 * The most Handlebars a subject, HTML or text may hold, its Header and Footer included: the characters of its `{{…}}`
 * expressions, braces and all. Compiling costs time in proportion to them before a render can be stopped (about a
 * quarter of a second for 10,000 `{{v}}`; 200,000 ran out of memory), so they are counted first (pen test S3, #137).
 * A designed Template has a few hundred.
 */
export const maxHandlebarsLength = 50_000;

/**
 * The most work one render of a Template's subject, HTML and text together may do, in steps (pen test S3, #137). A
 * render about this size takes well under a second; see the budget below.
 */
export const renderWorkBudget = 10_000_000;

const formatCount = (count: number) => count.toLocaleString("en-GB");

/** A rendered subject, HTML or text part longer than it may be. */
export class RenderedContentTooLongError extends TemplateRenderFailedError {
  override name = "RenderedContentTooLongError";

  constructor(
    readonly field: "subject" | "html" | "text",
    length: number,
    limit: number,
  ) {
    super(
      `The rendered ${field === "html" ? "HTML" : field} is ${formatCount(length)} characters, longer than the ${formatCount(limit)} it may have`,
    );
  }
}

class RenderWorkBudgetSpentError extends Error {
  override name = "RenderWorkBudgetSpentError";

  constructor() {
    super(
      "it does more work than one render may, such as a loop or nesting that grows too far",
    );
  }
}

const textWrapColumn = 100;

/**
 * Templates are written by any User or API Key, so rendering one must not reach the server log, which is outside
 * Retention (pen test S3, #136). The built-in `{{log}}` helper would write its arguments there, such as a reset link,
 * so in this environment it renders nothing and writes nothing. Handlebars' logger is one object shared by every
 * environment, and its prototype-access denial writes an unstructured warning through it, so it is silenced too: the
 * denial itself still holds and renders nothing.
 */
const handlebars = Handlebars.create();
handlebars.registerHelper("log", () => "");
handlebars.logger.log = () => undefined;

/*
 * The work budget (pen test S3, #137). Handlebars can't be stopped from outside once it runs, so the budget is
 * charged from inside and a render that spends it throws. Rendering is synchronous, so the budget of the render in
 * progress is one module-level value. A compiled block is straight-line code: all repetition goes through a helper
 * (`each`, or a block over a list, which uses it) or a partial. So a render is paid for in full by charging:
 *
 * - each run of a compiled block, by the length of its code, so a long path such as {{a.b.c…}} is paid for;
 * - each piece of output, by its length, so escaping or repeating a long variable is paid for;
 * - each helper call, each round of {{#each}} (even of an empty block) and each partial or decorator.
 *
 * One step is about a character's worth of work: 10,000,000 steps measured at a few hundred milliseconds whatever the
 * shape of the Template.
 */
let budget: { remaining: number } | undefined;

const charge = (steps: number) => {
  if (budget === undefined) {
    return;
  }
  budget.remaining -= steps;
  if (budget.remaining < 0) {
    throw new RenderWorkBudgetSpentError();
  }
};

/** What a helper call, {{#each}} round, partial or decorator costs beside the code and output it runs. */
const callSteps = 10;

/** The helpers compiled code charges through. A Template could call one too; it would only pay. */
const outputHelper = "email-platform:output";
const runHelper = "email-platform:run";

const isHelperOptions = (value: unknown): value is Handlebars.HelperOptions =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "fn") === "function";

for (const [name, helper] of Object.entries(handlebars.helpers)) {
  handlebars.registerHelper(name, function (this: unknown, ...args: unknown[]) {
    charge(callSteps);
    const options = args.at(-1);
    if (name === "each" && isHelperOptions(options)) {
      const { fn } = options;
      args[args.length - 1] = {
        ...options,
        fn: (context: unknown, runtimeOptions?: Handlebars.RuntimeOptions) => {
          charge(callSteps);
          return fn(context, runtimeOptions);
        },
      };
    }
    const result: unknown = Reflect.apply(helper, this, args);
    return result;
  });
}

/** A value as the text Handlebars' own `buffer += value` would make of it. */
const toText = (value: unknown): string =>
  typeof value === "string" ? value : [value].join("");

handlebars.registerHelper(outputHelper, (value: unknown) => {
  const text = toText(value);
  charge(text.length);
  return text;
});

handlebars.registerHelper(runHelper, (steps: unknown) => {
  charge(typeof steps === "number" ? steps : callSteps);
  return undefined;
});

for (const [name, decorator] of Object.entries(handlebars.decorators)) {
  handlebars.registerDecorator(
    name,
    function (this: unknown, ...args: unknown[]) {
      charge(callSteps);
      const result: unknown = decorator.apply(this, args);
      return result;
    },
  );
}

interface CompilerLike {
  appendToBuffer(
    source: unknown,
    location?: unknown,
    explicit?: boolean,
  ): unknown;
  mergeSource(varDeclarations: string): unknown;
}

const isCompilerClass = (value: unknown): value is new () => CompilerLike =>
  typeof value === "function";

const baseCompiler: unknown = Reflect.get(handlebars, "JavaScriptCompiler");
if (!isCompilerClass(baseCompiler)) {
  throw new Error("Handlebars has no JavaScriptCompiler to extend");
}

/** The length of the code a compiler has generated so far for the block it is compiling. */
const generatedLength = (compiler: object): number => {
  const source: unknown = Reflect.get(compiler, "source");
  const merge: unknown =
    typeof source === "object" && source !== null
      ? Reflect.get(source, "merge")
      : undefined;
  if (typeof merge !== "function") {
    throw new Error("Handlebars' compiler has no source to measure");
  }
  const merged: unknown = Reflect.apply(merge, source, []);
  return String(merged).length;
};

/** Handlebars' compiler, with code that charges the work budget for each block run and each piece of output. */
class BudgetedCompiler extends baseCompiler {
  override appendToBuffer(
    source: unknown,
    location?: unknown,
    explicit?: boolean,
  ): unknown {
    const parts: unknown[] = Array.isArray(source) ? source : [source];
    return super.appendToBuffer(
      [`helpers[${JSON.stringify(outputHelper)}](`, ...parts, ", {})"],
      location,
      explicit,
    );
  }

  // Declared first in the block's function, so a run is charged before any of its statements.
  override mergeSource(varDeclarations: string): unknown {
    const steps = generatedLength(this) + callSteps;
    return super.mergeSource(
      `, charged = helpers[${JSON.stringify(runHelper)}](${String(steps)}, {})${varDeclarations}`,
    );
  }
}
// A Template's blocks are compiled by `compiler` of the compiler compiling it, so they are budgeted too.
Reflect.set(BudgetedCompiler.prototype, "compiler", BudgetedCompiler);
Reflect.set(handlebars, "JavaScriptCompiler", BudgetedCompiler);

const runtime: unknown = Reflect.get(handlebars, "VM");
const invokePartial: unknown =
  typeof runtime === "object" && runtime !== null
    ? Reflect.get(runtime, "invokePartial")
    : undefined;
if (
  typeof runtime !== "object" ||
  runtime === null ||
  typeof invokePartial !== "function"
) {
  throw new Error("Handlebars has no runtime to budget partials in");
}
// This environment's own copy of the runtime, so other Handlebars environments are untouched.
Reflect.set(handlebars, "VM", {
  ...runtime,
  invokePartial(this: unknown, ...args: unknown[]): unknown {
    charge(callSteps);
    const result: unknown = Reflect.apply(invokePartial, this, args);
    return result;
  },
});

/** Whether a source holds more Handlebars than may be compiled, read once and no further than the limit. */
const hasTooMuchHandlebars = (source: string): boolean => {
  let total = 0;
  for (
    let open = source.indexOf("{{");
    open !== -1;
    open = source.indexOf("{{", open + 2)
  ) {
    const close = source.indexOf("}}", open + 2);
    const end = close === -1 ? source.length : close + 2;
    total += end - open;
    if (total > maxHandlebarsLength) {
      return true;
    }
    open = end - 2;
  }
  return false;
};

const render = (
  source: string,
  variables: Readonly<Record<string, unknown>>,
  isEscaped: boolean,
): string => {
  if (hasTooMuchHandlebars(source)) {
    throw new TemplateRenderFailedError(
      `it has more than the ${formatCount(maxHandlebarsLength)} characters of {{…}} expressions a subject, HTML or text may have`,
    );
  }
  try {
    const output: unknown = handlebars.compile(source, {
      noEscape: !isEscaped,
      strict: false,
    })(variables);
    return toText(output);
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

/**
 * Renders a Template's subject, HTML and text with one work budget, and refuses a rendered part longer than it may
 * be: the HTML and text 1,000,000 characters each, the subject 998. The HTML's length is checked before the text is
 * made from it, and a part's length is read before anything reads the whole string, so an over-long render costs no
 * more than the budget.
 */
export const renderTemplate = (
  content: TemplateContent,
  variables: Readonly<Record<string, unknown>>,
): RenderedContent => {
  const outer = budget;
  budget = { remaining: renderWorkBudget };
  try {
    const html = render(content.html, variables, true);
    if (html.length > maxRenderedLength) {
      throw new RenderedContentTooLongError(
        "html",
        html.length,
        maxRenderedLength,
      );
    }
    const text =
      content.text === null ||
      content.text === undefined ||
      content.text.trim() === ""
        ? htmlToText(html)
        : render(content.text, variables, false);
    if (text.length > maxRenderedLength) {
      throw new RenderedContentTooLongError(
        "text",
        text.length,
        maxRenderedLength,
      );
    }
    const subject = render(content.subject, variables, false);
    if (subject.length > maxSubjectLength) {
      throw new RenderedContentTooLongError(
        "subject",
        subject.length,
        maxSubjectLength,
      );
    }
    return { subject, html, text };
  } finally {
    budget = outer;
  }
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
