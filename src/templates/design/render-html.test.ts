import { describe, expect, it } from "vitest";
import { renderTemplate } from "../render.js";
import {
  createButtonBlock,
  createColumnsBlock,
  createDesign,
  createDividerBlock,
  createHtmlBlock,
  createImageBlock,
  createSocialBlock,
  createSpacerBlock,
  createTextBlock,
  defaultSettings,
} from "./model.js";
import {
  escapeAttribute,
  escapeText,
  renderDesignHtml,
  safeColor,
  styleRichText,
} from "./render-html.js";

describe("rich text styling", () => {
  it("adds email-safe inline styles and keeps the author's own", () => {
    const html = styleRichText(
      '<h1>Hi</h1><p style="text-align: center">One <a href="https://x.test">link</a></p><p>Last</p>',
      defaultSettings,
    );
    expect(html).toContain(
      '<h1 style="margin:0 0 12px;font-size:28px;line-height:1.25;font-weight:700;color:#111827;">Hi</h1>',
    );
    expect(html).toContain(
      '<p style="margin:0 0 12px;text-align: center">One <a href="https://x.test" style="color:#2563eb;text-decoration:underline;">link</a></p>',
    );
    // The last paragraph has no space under it.
    expect(html).toContain('<p style="margin:0;">Last</p>');
  });

  it("gives paragraphs in list items no margin", () => {
    const html = styleRichText(
      "<ul><li><p>One</p></li><li><p>Two</p></li></ul>",
      defaultSettings,
    );
    expect(html).toContain(
      '<li style="margin:0 0 4px;"><p style="margin:0;">One</p>',
    );
    expect(html).toContain('<ul style="margin:0;padding:0 0 0 24px;">');
  });
});

describe("escaping", () => {
  it("escapes text and attributes but leaves Handlebars alone", () => {
    expect(escapeText('<b>{{name}} & "co"</b>')).toBe(
      '&lt;b&gt;{{name}} &amp; "co"&lt;/b&gt;',
    );
    expect(escapeAttribute('a"b')).toBe("a&quot;b");
    expect(safeColor("#fff")).toBe("#fff");
    expect(safeColor("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
    expect(safeColor('red;" onclick="x', "#000")).toBe("#000");
  });
});

describe("rendering a design", () => {
  it("renders every block type into a complete email", () => {
    const design = createDesign([
      createTextBlock("<p>Hello {{name}}</p>"),
      createButtonBlock("Open <now>", "{{url}}"),
      {
        ...createImageBlock(),
        src: "https://x.test/a.png",
        alt: "Logo",
        href: "https://x.test",
      },
      createImageBlock(),
      createDividerBlock(),
      createSpacerBlock(30),
      createHtmlBlock("<table><tr><td>raw</td></tr></table>"),
      createColumnsBlock(2),
    ]);
    design.settings.preheader = "Preview for {{name}}";
    const html = renderDesignHtml(design, { title: "Hi {{name}}" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Hi {{name}}</title>");
    expect(html).toContain('class="preheader"');
    expect(html).toContain("Preview for {{name}}");
    expect(html).toContain('href="{{url}}"');
    expect(html).toContain("Open &lt;now&gt;");
    expect(html).toContain("<v:roundrect");
    expect(html).toContain('alt="Logo"');
    expect(html).toContain('<a href="https://x.test"');
    expect(html.match(/<img /gu)).toHaveLength(1);
    expect(html).toContain("border-top:1px solid #e5e7eb");
    expect(html).toContain("height:30px");
    expect(html).toContain("<td>raw</td>");
    expect(html).toContain('class="stack-column stack-column-gap"');
    expect(html).toContain("@media screen and (max-width:632px)");
  });

  it("draws a Socials block as linked icons written into the email", () => {
    const block = createSocialBlock(["linkedin", "x", "email"]);
    const [linkedin, x, email] = block.links;
    if (linkedin === undefined || x === undefined || email === undefined) {
      throw new Error("Expected three links");
    }
    linkedin.url = "https://www.linkedin.com/in/{{handle}}";
    x.url = "  ";
    email.url = 'mailto:a@b.test"><b>';
    const html = renderDesignHtml(
      createDesign([{ ...block, align: "right", showLabels: true }]),
    );
    expect(html).toContain('<td align="right">');
    expect(html).toContain('href="https://www.linkedin.com/in/{{handle}}"');
    expect(html).toContain('aria-label="LinkedIn"');
    // No address, no icon; and the address can't break out of its attribute.
    expect(html).not.toContain('aria-label="X"');
    expect(html).toContain('href="mailto:a@b.test&quot;&gt;&lt;b&gt;"');
    expect(html.match(/<svg /gu)).toHaveLength(2);
    expect(html).not.toContain("<img");
    expect(html).toContain(">LinkedIn</td>");
  });

  it("leaves out a Socials block with no addresses at all", () => {
    const block = createSocialBlock([]);
    expect(renderDesignHtml(createDesign([block]))).not.toContain("<svg");
  });

  it("wraps a conditional block in {{#if}} and marks blocks hidden on phones", () => {
    const design = createDesign([
      {
        ...createTextBlock("<p>Only sometimes</p>"),
        showIf: "isVip",
        hideOnMobile: true,
      },
    ]);
    const html = renderDesignHtml(design);
    expect(html).toMatch(
      /\{\{#if isVip\}\}<tr class="hide-mobile">.*\{\{\/if\}\}/su,
    );
    const shown = renderTemplate({ subject: "s", html }, { isVip: true });
    const hidden = renderTemplate({ subject: "s", html }, { isVip: false });
    expect(shown.html).toContain("Only sometimes");
    expect(hidden.html).not.toContain("Only sometimes");
    expect(hidden.text).not.toContain("Only sometimes");
  });

  it("draws a box with a left border and inner padding", () => {
    const design = createDesign([
      {
        ...createTextBlock("<p>Careful</p>"),
        backgroundColor: "#fffbeb",
        boxBorderWidth: 4,
        boxBorderSide: "left",
        boxBorderColor: "#f59e0b",
        boxPadding: 16,
      },
    ]);
    const html = renderDesignHtml(design);
    expect(html).toContain(
      'bgcolor="#fffbeb" style="background-color:#fffbeb;border-left:4px solid #f59e0b;border-radius:0px;padding:16px;"',
    );
  });

  it("loads only the Google fonts the email uses", () => {
    const design = createDesign([
      createTextBlock(
        '<p><span style="font-family: Lora, Georgia, serif">Serif</span></p>',
      ),
      {
        ...createButtonBlock(),
        fontFamily: "Inter, Arial, Helvetica, sans-serif",
      },
    ]);
    const html = renderDesignHtml(design);
    expect(html).toContain("family=Lora:");
    expect(html).toContain("family=Inter:");
    expect(renderDesignHtml(createDesign([]))).not.toContain(
      "fonts.googleapis.com",
    );
  });

  it("keeps the preheader out of the plain-text part", () => {
    const design = createDesign([createTextBlock("<p>Body text</p>")]);
    design.settings.preheader = "Secret preview line";
    const rendered = renderTemplate(
      { subject: "s", html: renderDesignHtml(design) },
      {},
    );
    expect(rendered.text).toContain("Body text");
    expect(rendered.text).not.toContain("Secret preview line");
  });
});
