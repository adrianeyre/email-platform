import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { builtInEmails } from "../../templates/built-in-emails.js";
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
  type Design,
} from "../../templates/design/model.js";
import { renderDesignHtml } from "../../templates/design/render-html.js";
import { Designer } from "./designer.js";
import {
  recordChange,
  redo,
  startHistory,
  undo,
  type History,
} from "./history.js";

let root: Root;
let host: HTMLDivElement;
let latest: Design;
const report = (design: Design) => {
  latest = design;
};

const Harness = ({ initial }: { initial: Design }) => {
  const [history, setHistory] = useState<History<Design>>(() =>
    startHistory(initial),
  );
  useEffect(() => {
    report(history.present);
  }, [history.present]);
  return (
    <Designer
      design={history.present}
      onChange={(next, key) => {
        setHistory((current) => recordChange(current, next, key, Date.now()));
      }}
      onUndo={() => {
        setHistory(undo);
      }}
      onRedo={() => {
        setHistory(redo);
      }}
      canUndo={history.past.length > 0}
      canRedo={history.future.length > 0}
      variables={["name", "url"]}
    />
  );
};

const render = async (design: Design) => {
  await act(async () => {
    root.render(<Harness initial={design} />);
    await Promise.resolve();
  });
};

const find = (selector: string, text?: string): Element => {
  const all = [...host.querySelectorAll(selector)];
  const match =
    text === undefined
      ? all[0]
      : all.find(
          (element) =>
            element.textContent.includes(text) ||
            element.getAttribute("aria-label") === text,
        );
  if (match === undefined) {
    throw new Error(`Nothing matches ${selector} ${text ?? ""}`);
  }
  return match;
};

const click = async (element: Element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
};

const press = async (key: string, options: KeyboardEventInit = {}) => {
  const target = host.querySelector(".designer-canvas") ?? host;
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...options }),
    );
    await Promise.resolve();
  });
};

/** Sets a React-controlled input's value the way typing would. */
const type = async (
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) => {
  // React tracks the value itself, so set it through the element's own prototype.
  const prototype =
    input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Reflect.set(prototype, "value", value, input);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
    await Promise.resolve();
  });
};

const inputLabelled = (label: string): HTMLInputElement => {
  const element = [...host.querySelectorAll("label")].find(
    (item) => item.textContent === label,
  );
  const id = element?.getAttribute("for");
  const input =
    id === null || id === undefined
      ? null
      : host.querySelector<HTMLInputElement>(`[id="${id}"]`);
  if (input === null) {
    throw new Error(`No input labelled ${label}`);
  }
  return input;
};

const selectBlock = async (label: string) => {
  await click(find(".block-frame", label));
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

describe("the visual designer", () => {
  it("shows the email settings until a block is selected, then that block's settings", async () => {
    await render(createDesign([createButtonBlock("Pay now")]));
    expect(host.textContent).toContain("Email settings");
    await selectBlock("Button: Pay now");
    expect(find(".inspector-heading").textContent).toContain("Button");
    await type(inputLabelled("Label"), "Pay {{name}}");
    await type(inputLabelled("Link"), "{{url}}");
    await click(find(".chip", "{{name}}"));
    await click(find('[role="radio"]', "Left"));
    await click(find('[role="switch"]'));
    await click(find("button", "Italic"));
    await type(inputLabelled("Button colour"), "#16a34a");
    expect(latest.blocks[0]).toMatchObject({
      label: "Pay {{name}}",
      url: "{{name}}",
      align: "left",
      isFullWidth: true,
      isItalic: true,
      buttonColor: "#16a34a",
    });
    expect(renderDesignHtml(latest)).toContain("Pay {{name}}");
    await click(find("button", "Done"));
    expect(host.textContent).toContain("Email settings");
  });

  it("adds blocks from the palette below the selection", async () => {
    await render(createDesign([createDividerBlock()]));
    for (const label of [
      "Heading",
      "Text",
      "Button",
      "Image",
      "Columns",
      "Spacer",
      "HTML",
      "Socials",
      "Divider",
    ]) {
      await click(find(".palette-item", label));
    }
    expect(latest.blocks.map((block) => block.type)).toEqual([
      "divider",
      "text",
      "text",
      "button",
      "image",
      "columns",
      "spacer",
      "html",
      "social",
      "divider",
    ]);
    expect(host.querySelectorAll(".outline > li")).toHaveLength(10);
  });

  it("edits the networks and look of a Socials block", async () => {
    await render(createDesign([createSocialBlock(["facebook", "instagram"])]));
    const icons = () => host.querySelectorAll(".social-preview svg");
    expect(icons()).toHaveLength(2);
    await selectBlock("Socials: Facebook, Instagram");
    expect(host.querySelector(".inspector-heading")?.textContent).toContain(
      "Socials",
    );

    await type(inputLabelled("Facebook"), "https://facebook.com/ada");
    await type(
      host.querySelector<HTMLSelectElement>(".social-add select") ??
        document.createElement("select"),
      "linkedin",
    );
    await click(find(".social-add button", "Add"));
    await click(find("button", "Move LinkedIn up"));
    await click(find("button", "Remove Instagram"));
    const block = latest.blocks[0];
    expect(block?.type).toBe("social");
    if (block?.type === "social") {
      expect(block.links.map((link) => link.network)).toEqual([
        "facebook",
        "linkedin",
      ]);
      expect(block.links[0]?.url).toBe("https://facebook.com/ada");
    }
    expect(icons()).toHaveLength(2);

    await click(find("button[role=radio]", "Plain"));
    await click(find("button[role=radio]", "Custom"));
    await type(inputLabelled("Size"), "40");
    await click(find("label.toggle", "Show names"));
    const styled = latest.blocks[0];
    expect(styled).toMatchObject({
      shape: "plain",
      colorMode: "custom",
      iconSize: 40,
      showLabels: true,
    });
    expect(host.querySelector(".social-preview")?.textContent).toContain(
      "LinkedIn",
    );

    // An address cleared is left out of the email, so it fades in the designer.
    await type(inputLabelled("LinkedIn"), "");
    expect(
      host.querySelectorAll(".social-preview-item[data-empty]"),
    ).toHaveLength(1);
    expect(renderDesignHtml(latest).match(/<svg /gu)).toHaveLength(1);
  });

  it("moves, duplicates and deletes with the block toolbar and the keyboard, and undoes it all", async () => {
    const first = createSpacerBlock(10);
    const second = createSpacerBlock(20);
    await render(createDesign([first, second]));
    const heights = () =>
      latest.blocks.map((block) =>
        block.type === "spacer" ? block.height : 0,
      );

    await click(find(".block-frame"));
    await click(find('[aria-label="Move down"]'));
    expect(heights()).toEqual([20, 10]);
    await press("ArrowUp", { altKey: true });
    expect(heights()).toEqual([10, 20]);
    await press("d", { metaKey: true });
    expect(heights()).toEqual([10, 10, 20]);
    await press("Delete");
    expect(heights()).toEqual([10, 20]);
    await press("z", { metaKey: true });
    expect(heights()).toEqual([10, 10, 20]);
    await press("z", { metaKey: true, shiftKey: true });
    expect(heights()).toEqual([10, 20]);
    await click(find("button", "Undo"));
    await click(find("button", "Redo"));
    expect(heights()).toEqual([10, 20]);
    await press("Escape");
    expect(host.textContent).toContain("Email settings");
  });

  it("edits every kind of block in the inspector", async () => {
    const image = createImageBlock();
    const divider = createDividerBlock();
    const spacer = createSpacerBlock();
    const html = createHtmlBlock("<b>raw</b>");
    const columns = createColumnsBlock(2);
    await render(createDesign([image, divider, spacer, html, columns]));

    await selectBlock("Image");
    await type(inputLabelled("Image address"), "https://x.test/logo.png");
    await type(inputLabelled("Description (alt text)"), "Logo");
    await type(inputLabelled("Width"), "50");
    await selectBlock("Divider");
    await click(find('[role="radio"]', "Dashed"));
    await type(inputLabelled("Thickness"), "3");
    await selectBlock("Spacer");
    await type(inputLabelled("Height"), "48");
    await selectBlock("HTML");
    expect(host.querySelector(".cm-editor")).not.toBeNull();
    await selectBlock("Columns");
    await click(find('[role="radio"]', "3"));
    await click(find(".layout-option", "50% / 25% / 25%"));
    await click(find('[role="radio"]', "Middle"));

    expect(latest.blocks[0]).toMatchObject({
      src: "https://x.test/logo.png",
      alt: "Logo",
      widthPercent: 50,
    });
    expect(latest.blocks[1]).toMatchObject({ style: "dashed", thickness: 3 });
    expect(latest.blocks[2]).toMatchObject({ height: 48 });
    const updatedColumns = latest.blocks[4];
    expect(
      updatedColumns?.type === "columns" &&
        updatedColumns.columns.map((column) => column.widthPercent),
    ).toEqual([50, 25, 25]);
    expect(updatedColumns).toMatchObject({ verticalAlign: "middle" });
  });

  it("sets spacing, a box and visibility on any block", async () => {
    await render(createDesign([createSpacerBlock()]));
    await selectBlock("Spacer");
    await type(inputLabelled("All sides"), "12");
    await click(find(".link-button", "Set each side"));
    await type(inputLabelled("Top"), "30");
    await type(inputLabelled("Background"), "#fffbeb");
    await type(inputLabelled("Border"), "4");
    await click(find('[role="radio"]', "Left only"));
    await type(
      inputLabelled("Show only if this variable is set"),
      "{{#isVip}}",
    );
    await click(
      find(".toggle", "Hide on phones").querySelector("input") ?? host,
    );
    expect(latest.blocks[0]).toMatchObject({
      padding: { top: 30, right: 12, bottom: 12, left: 12 },
      backgroundColor: "#fffbeb",
      boxBorderWidth: 4,
      boxBorderSide: "left",
      showIf: "isVip",
      hideOnMobile: true,
    });
    expect(host.textContent).toContain("if isVip");
  });

  it("changes the email settings and previews phone width", async () => {
    await render(createDesign([createTextBlock("<p>Hi {{name}}</p>")]));
    await type(inputLabelled("Preview text"), "Your week in brief");
    await type(inputLabelled("Content width"), "640");
    await type(inputLabelled("Content border"), "#e5e7eb");
    await click(find('[aria-label="Clear Content border"]'));
    expect(latest.settings).toMatchObject({
      preheader: "Your week in brief",
      contentWidth: 640,
      contentBorderColor: "",
    });
    expect(host.textContent).toContain("Inbox preview:");
    await click(find('[role="radio"]', "Phone"));
    const card = find(".email-card");
    expect(card instanceof HTMLElement ? card.style.width : "").toBe("375px");
  });

  it("opens a built-in email with all of its blocks", async () => {
    const email = builtInEmails.find(
      (item) => item.name === "Wizzaroo - Family Device signed in",
    );
    if (email === undefined) {
      throw new Error("missing built-in");
    }
    await render(email.design);
    expect(
      host.querySelectorAll(".email-card > .block-list > div > .block-frame"),
    ).toHaveLength(email.design.blocks.length);
    expect(host.textContent).toContain("Review your Family Devices");
    await selectBlock("Text: SECURITY NOTICE");
    expect(
      host.querySelector('[role="toolbar"][aria-label="Text formatting"]'),
    ).not.toBeNull();
  });
});
