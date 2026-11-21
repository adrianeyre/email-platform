import { describe, expect, it, vi } from "vitest";
import {
  checkRequiredVariables,
  maxHandlebarsLength,
  maxRenderedLength,
  maxSubjectLength,
  normaliseVariableNames,
  RenderedContentTooLongError,
  renderTemplate,
  TemplateRenderFailedError,
} from "./render.js";

describe("renderTemplate", () => {
  it("escapes variables in HTML but not in the subject or text", () => {
    const rendered = renderTemplate(
      {
        subject: "Hi {{name}}",
        html: "<p>Hi {{name}}</p>",
        text: "Hi {{name}}",
      },
      { name: "<Ada & Co>" },
    );
    expect(rendered).toEqual({
      subject: "Hi <Ada & Co>",
      html: "<p>Hi &lt;Ada &amp; Co&gt;</p>",
      text: "Hi <Ada & Co>",
    });
  });

  it("generates the text part from the HTML when there is none", () => {
    const rendered = renderTemplate(
      { subject: "s", html: "<h1>Order</h1><p>Shipped {{id}}</p>", text: " " },
      { id: 7 },
    );
    expect(rendered.text).toBe("ORDER\n\nShipped 7");
  });

  it("supports blocks and loops", () => {
    const rendered = renderTemplate(
      {
        subject: "s",
        html: "{{#if vip}}VIP {{/if}}{{#each items}}[{{this}}]{{/each}}",
      },
      { vip: true, items: ["a", "b"] },
    );
    expect(rendered.html).toBe("VIP [a][b]");
  });

  it("renders {{log}} as nothing and writes nothing to the console, nor a prototype denial's warning (pen test S3, #136)", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (method) => vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      const rendered = renderTemplate(
        {
          subject: "[{{log link}}]",
          html: '[{{log link level="error"}}][{{#log link}}x{{/log}}][{{link.constructor.name}}]',
          text: "[{{log link}}]",
        },
        { link: "https://example.com/reset?token=secret" },
      );
      expect(rendered).toEqual({ subject: "[]", html: "[][][]", text: "[]" });
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("explains a template that does not parse", () => {
    expect(() => renderTemplate({ subject: "s", html: "{{#if}}" }, {})).toThrow(
      TemplateRenderFailedError,
    );
  });

  it("still renders paths, helpers, inline partials, raw values and lists of values as Handlebars does", () => {
    const rendered = renderTemplate(
      {
        subject: "{{order.id}} {{lookup order 'id'}}",
        html: '{{#*inline "line"}}<li>{{name}}</li>{{/inline}}<ul>{{#each items}}{{> line}}{{/each}}</ul>{{{raw}}}{{#with order}}{{id}}{{/with}}{{#unless missing}}!{{/unless}}{{list}}',
        text: "{{#items}}{{name}};{{/items}}",
      },
      {
        order: { id: 7 },
        items: [{ name: "a" }, { name: "<b>" }],
        raw: "<i>r</i>",
        list: [1, 2],
      },
    );
    expect(rendered).toEqual({
      subject: "7 7",
      html: "<ul><li>a</li><li>&lt;b&gt;</li></ul><i>r</i>7!1,2",
      text: "a;<b>;",
    });
  });
});

describe("renderTemplate's bounds (pen test S3, #137; S1, #152)", () => {
  const list = (length: number) => Array.from({ length }, (_, index) => index);
  const refusal = (run: () => unknown): unknown => {
    try {
      run();
    } catch (error) {
      return error;
    }
    return undefined;
  };

  it("refuses rendered HTML or text over 1,000,000 characters, and a subject over 998, naming the part", () => {
    const html = refusal(() =>
      renderTemplate(
        { subject: "s", html: "{{#each l}}{{../v}}{{/each}}", text: "t" },
        { l: list(1001), v: "x".repeat(1000) },
      ),
    );
    expect(html).toBeInstanceOf(RenderedContentTooLongError);
    expect(html).toMatchObject({
      field: "html",
      message:
        "The rendered HTML is 1,001,000 characters, longer than the 1,000,000 it may have",
    });
    expect(
      refusal(() =>
        renderTemplate(
          { subject: "s", html: "h", text: "{{v}}{{v}}" },
          { v: "x".repeat(maxRenderedLength / 2 + 1) },
        ),
      ),
    ).toMatchObject({ field: "text" });
    const subject = { subject: "Order {{id}}", html: "h", text: "t" };
    expect(
      renderTemplate(subject, { id: "o".repeat(maxSubjectLength - 6) }).subject,
    ).toHaveLength(maxSubjectLength);
    expect(
      refusal(() =>
        renderTemplate(subject, { id: "o".repeat(maxSubjectLength - 5) }),
      ),
    ).toMatchObject({
      field: "subject",
      message:
        "The rendered subject is 999 characters, longer than the 998 it may have",
    });
  });

  it("stops a render that does more work than one may, however it is shaped, before its output is built", () => {
    const shapes: [string, Record<string, unknown>][] = [
      [
        "{{#each l}}{{#each ../l}}{{#each ../../l}}x{{/each}}{{/each}}{{/each}}",
        { l: list(100) },
      ],
      ["{{#each l}}{{/each}}", { l: list(2_000_000) }],
      ["{{v}}".repeat(1000), { v: "<".repeat(1_000_000) }],
      [
        `${Array.from(
          { length: 40 },
          (_, index) =>
            `{{#*inline "p${String(index + 1)}"}}{{> p${String(index)}}}{{> p${String(index)}}}{{/inline}}`,
        ).join("")}{{#*inline "p0"}}{{/inline}}{{> p40}}`,
        {},
      ],
    ];
    for (const [html, variables] of shapes) {
      const started = performance.now();
      const error = refusal(() =>
        renderTemplate({ subject: "s", html, text: "t" }, variables),
      );
      expect(error).toBeInstanceOf(TemplateRenderFailedError);
      expect(error).toHaveProperty(
        "message",
        "it does more work than one render may, such as a loop or nesting that grows too far",
      );
      expect(performance.now() - started).toBeLessThan(5000);
    }
  });

  it("refuses a subject, HTML or text holding more than 50,000 characters of {{…}} before compiling it", () => {
    const within = "{{v}}".repeat(maxHandlebarsLength / 5);
    expect(renderTemplate({ subject: "s", html: within }, { v: "" }).html).toBe(
      "",
    );
    expect(
      refusal(() =>
        renderTemplate({ subject: "s", html: `${within}{{v}}` }, { v: "" }),
      ),
    ).toHaveProperty(
      "message",
      "it has more than the 50,000 characters of {{…}} expressions a subject, HTML or text may have",
    );
  });
});

describe("checkRequiredVariables", () => {
  it("reports each missing or null required variable", () => {
    expect(
      checkRequiredVariables(["name", "orderId", "total"], {
        name: "Ada",
        orderId: null,
        total: 0,
      }),
    ).toEqual([
      {
        field: "variables.orderId",
        message: 'The required variable "orderId" is missing',
      },
    ]);
  });
});

describe("normaliseVariableNames", () => {
  it("trims, removes blanks and duplicates, and sorts", () => {
    expect(normaliseVariableNames([" b", "a", "", "b"])).toEqual(["a", "b"]);
  });
});
