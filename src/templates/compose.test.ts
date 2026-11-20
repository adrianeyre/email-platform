import { describe, expect, it } from "vitest";
import { bodyOf, composeDesign, composeHtml, partBlocks } from "./compose.js";
import { createDesign, createTextBlock } from "./design/model.js";

describe("composing a template with its header and footer", () => {
  it("leaves a template with neither as it is", () => {
    const template = { subject: "s", html: "<p>x</p>", design: null };
    expect(composeHtml(template, undefined, undefined)).toBe("<p>x</p>");
  });

  it("puts hand-written parts just inside the body", () => {
    const html = composeHtml(
      {
        subject: "s",
        html: "<html><body><p>BODY</p></body></html>",
        design: null,
      },
      { html: "<html><body><p>TOP</p></body></html>", design: null },
      { html: "<p>BOTTOM</p>", design: null },
    );
    expect(html).toBe(
      "<html><body>\n<p>TOP</p><p>BODY</p><p>BOTTOM</p>\n</body></html>",
    );
    expect(
      composeHtml(
        { subject: "s", html: "<p>BODY</p>", design: null },
        { html: "<p>TOP</p>", design: null },
        undefined,
      ),
    ).toBe("<p>TOP</p>\n<p>BODY</p>");
  });

  it("merges designed parts' blocks around a designed template's, as one email", () => {
    const top = createDesign([createTextBlock("<p>TOP</p>")]);
    const body = createDesign([createTextBlock("<p>BODY</p>")]);
    const composed = composeDesign(
      body,
      { html: "", design: top },
      { html: "<p>END</p>", design: null },
    );
    expect(composed.blocks.map((block) => block.type)).toEqual([
      "text",
      "text",
      "html",
    ]);
    const html = composeHtml(
      { subject: "Hi", html: "", design: body },
      { html: "", design: top },
      undefined,
    );
    expect(html.indexOf("TOP")).toBeLessThan(html.indexOf("BODY"));
    expect(html.match(/<!doctype html>/gu)).toHaveLength(1);
  });

  it("reads a part's body, and has no blocks for an empty one", () => {
    expect(bodyOf("<body class='x'> hi </body>")).toBe("hi");
    expect(partBlocks({ html: "  ", design: null })).toEqual([]);
    expect(partBlocks(undefined)).toEqual([]);
  });
});
