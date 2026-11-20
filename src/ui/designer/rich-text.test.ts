import { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";
import { richTextExtensions } from "./rich-text.js";

let editor: Editor | undefined;

const open = (html: string) => {
  editor = new Editor({ extensions: richTextExtensions, content: html });
  return editor;
};

afterEach(() => {
  editor?.destroy();
});

describe("the rich text editor", () => {
  it("never splits a {{variable}} across formatting", () => {
    const current = open("<p>Hi {{name}}, welcome</p>");
    // Bold "name}}, " but not the opening braces.
    current.chain().setTextSelection({ from: 6, to: 14 }).toggleBold().run();
    expect(current.getHTML()).toBe(
      "<p>Hi <strong>{{name}}, </strong>welcome</p>",
    );
    current.chain().setTextSelection({ from: 4, to: 6 }).toggleItalic().run();
    expect(current.getHTML()).toContain("<strong>{{name}}, </strong>");
  });

  it("keeps fonts, sizes, colours and alignment as inline styles", () => {
    const current = open("<p>Styled</p>");
    current
      .chain()
      .selectAll()
      .setFontFamily("Georgia, serif")
      .setFontSize("20px")
      .setColor("#dc2626")
      .setTextAlign("center")
      .toggleUnderline()
      .run();
    const html = current.getHTML();
    expect(html).toContain('style="text-align: center;"');
    expect(html).toMatch(/font-family: Georgia, serif/u);
    expect(html).toMatch(/font-size: 20px/u);
    expect(html).toMatch(/color: (#dc2626|rgb\(220, 38, 38\))/u);
    expect(html).toContain("<u>");
  });

  it("accepts a {{variable}} as a link address", () => {
    const current = open("<p>Reset</p>");
    current.chain().selectAll().setLink({ href: "{{resetUrl}}" }).run();
    expect(current.getHTML()).toContain('href="{{resetUrl}}"');
  });
});
