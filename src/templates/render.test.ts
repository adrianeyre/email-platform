import { describe, expect, it } from "vitest";
import {
  checkRequiredVariables,
  normaliseVariableNames,
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

  it("explains a template that does not parse", () => {
    expect(() => renderTemplate({ subject: "s", html: "{{#if}}" }, {})).toThrow(
      TemplateRenderFailedError,
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
