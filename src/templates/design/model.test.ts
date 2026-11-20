import { describe, expect, it } from "vitest";
import {
  createButtonBlock,
  createColumnsBlock,
  createDesign,
  createDividerBlock,
  createSocialBlock,
  createTextBlock,
  duplicateBlock,
  findBlock,
  insertBlock,
  locateBlock,
  moveBlock,
  nudgeBlock,
  parseDesign,
  removeBlock,
  rootContainer,
  setColumnCount,
  updateBlock,
  type Design,
} from "./model.js";

const ids = (design: Design) => design.blocks.map((block) => block.id);

const threeBlocks = () => {
  const a = createTextBlock("<p>a</p>");
  const b = createButtonBlock();
  const c = createDividerBlock();
  return { a, b, c, design: createDesign([a, b, c]) };
};

describe("the design model", () => {
  it("inserts, finds, updates and removes blocks", () => {
    const { a, b, c, design } = threeBlocks();
    const extra = createTextBlock("<p>x</p>");
    const inserted = insertBlock(design, rootContainer, 1, extra);
    expect(ids(inserted)).toEqual([a.id, extra.id, b.id, c.id]);
    expect(insertBlock(design, rootContainer, 99, extra).blocks.at(-1)).toBe(
      extra,
    );
    const updated = updateBlock(inserted, b.id, { label: "Pay now" });
    expect(findBlock(updated, b.id)).toMatchObject({ label: "Pay now" });
    expect(ids(removeBlock(updated, extra.id))).toEqual([a.id, b.id, c.id]);
  });

  it("never changes a block's id or type through an update", () => {
    const { b, design } = threeBlocks();
    const updated = updateBlock(design, b.id, { id: "other", type: "text" });
    expect(findBlock(updated, b.id)?.type).toBe("button");
  });

  it("moves a block up, down and to an exact place", () => {
    const { a, b, c, design } = threeBlocks();
    expect(ids(nudgeBlock(design, c.id, -1))).toEqual([a.id, c.id, b.id]);
    expect(ids(nudgeBlock(design, a.id, 1))).toEqual([b.id, a.id, c.id]);
    expect(nudgeBlock(design, a.id, -1)).toBe(design);
    expect(nudgeBlock(design, c.id, 1)).toBe(design);
    expect(ids(moveBlock(design, a.id, rootContainer, 3))).toEqual([
      b.id,
      c.id,
      a.id,
    ]);
    expect(ids(moveBlock(design, c.id, rootContainer, 0))).toEqual([
      c.id,
      a.id,
      b.id,
    ]);
    expect(moveBlock(design, a.id, rootContainer, 1)).toBe(design);
  });

  it("moves blocks into and out of columns, but never nests columns", () => {
    const { a, design } = threeBlocks();
    const columns = createColumnsBlock(2);
    const [left, right] = columns.columns;
    if (left === undefined || right === undefined) {
      throw new Error("expected two columns");
    }
    const withColumns = insertBlock(design, rootContainer, 3, columns);
    const moved = moveBlock(withColumns, a.id, right.id, 0);
    expect(locateBlock(moved, a.id)).toEqual({
      container: right.id,
      index: 0,
      parentId: columns.id,
    });
    expect(findBlock(moved, a.id)).toBeDefined();
    const back = moveBlock(moved, a.id, rootContainer, 0);
    expect(back.blocks[0]?.id).toBe(a.id);
    // A columns block dropped into a column goes below the columns block instead.
    const nested = createColumnsBlock(3);
    const placed = insertBlock(withColumns, left.id, 0, nested);
    expect(placed.blocks.at(-1)?.id).toBe(nested.id);
    expect(moveBlock(placed, nested.id, left.id, 0)).toBe(placed);
  });

  it("duplicates a block with new ids, including the blocks in its columns", () => {
    const columns = createColumnsBlock(2);
    const design = createDesign([columns]);
    const { design: copied, newId } = duplicateBlock(design, columns.id);
    expect(copied.blocks).toHaveLength(2);
    const copy = copied.blocks[1];
    expect(copy?.id).toBe(newId);
    expect(copy?.id).not.toBe(columns.id);
    if (copy?.type !== "columns") {
      throw new Error("expected a columns block");
    }
    expect(copy.columns[0]?.id).not.toBe(columns.columns[0]?.id);
    expect(copy.columns[0]?.blocks[0]?.id).not.toBe(
      columns.columns[0]?.blocks[0]?.id,
    );
  });

  it("keeps the content of columns that are taken away", () => {
    const columns = createColumnsBlock(3);
    const fewer = setColumnCount(columns, 2);
    expect(fewer.columns).toHaveLength(2);
    expect(fewer.columns[1]?.blocks).toHaveLength(2);
    expect(setColumnCount(columns, 4).columns).toHaveLength(4);
  });

  it("reads a saved design and repairs what it can", () => {
    const { design } = threeBlocks();
    expect(parseDesign(JSON.parse(JSON.stringify(design)))).toEqual(design);
    expect(parseDesign({ version: 2, blocks: [] })).toBeUndefined();
    expect(parseDesign("nope")).toBeUndefined();
    const repaired = parseDesign({
      version: 1,
      settings: { contentWidth: 5000, fontFamily: "" },
      blocks: [
        { type: "unknown" },
        { type: "button", fontSize: 500, align: "sideways" },
        { type: "columns", columns: [] },
      ],
    });
    expect(repaired?.settings.contentWidth).toBe(900);
    expect(repaired?.settings.fontFamily).toContain("Arial");
    expect(repaired?.blocks).toHaveLength(1);
    expect(repaired?.blocks[0]).toMatchObject({
      type: "button",
      fontSize: 72,
      align: "center",
    });
  });

  it("reads a saved Socials block and drops networks it doesn't know", () => {
    const block = createSocialBlock(["github", "website"]);
    const saved = createDesign([block]);
    expect(parseDesign(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    const repaired = parseDesign({
      version: 1,
      blocks: [
        {
          type: "social",
          links: [
            { network: "myspace", url: "https://myspace.com" },
            { network: "linkedin", url: "https://www.linkedin.com/in/ada" },
            "nonsense",
          ],
          shape: "hexagon",
          colorMode: "rainbow",
          iconSize: 500,
          gap: -4,
        },
      ],
    });
    expect(repaired?.blocks[0]).toMatchObject({
      type: "social",
      links: [{ network: "linkedin", url: "https://www.linkedin.com/in/ada" }],
      shape: "circle",
      colorMode: "brand",
      iconSize: 64,
      gap: 0,
    });
  });

  it("gives a duplicated Socials block new link ids", () => {
    const block = createSocialBlock(["x"]);
    const { design, newId } = duplicateBlock(createDesign([block]), block.id);
    const copy = design.blocks.find((item) => item.id === newId);
    expect(copy?.type).toBe("social");
    if (copy?.type === "social") {
      expect(copy.links[0]?.id).not.toBe(block.links[0]?.id);
      expect(copy.links[0]?.network).toBe("x");
    }
  });
});
