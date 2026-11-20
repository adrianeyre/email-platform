import {
  isSocialNetwork,
  socialColorModes,
  socialShapes,
  type SocialColorMode,
  type SocialNetwork,
  type SocialShape,
} from "./social-icons.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const designVersion = 1;

export type Align = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";
export type BorderStyle = "solid" | "dashed" | "dotted";
export type BorderSide = "all" | "left";

export interface Spacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface BlockBase {
  id: string;
  padding: Spacing;
  backgroundColor: string;
  /** A variable name; the block is shown only when it is truthy. */
  showIf: string;
  hideOnMobile: boolean;
  /** A border and rounding around the whole block, for panels and callouts. */
  boxBorderWidth: number;
  boxBorderColor: string;
  boxBorderSide: BorderSide;
  boxBorderRadius: number;
  /** Space between the box's edge and its content. */
  boxPadding: number;
}

export interface TextBlock extends BlockBase {
  type: "text";
  html: string;
}

export interface ButtonBlock extends BlockBase {
  type: "button";
  label: string;
  url: string;
  align: Align;
  isFullWidth: boolean;
  buttonColor: string;
  textColor: string;
  fontFamily: string;
  fontSize: number;
  isBold: boolean;
  isItalic: boolean;
  letterSpacing: number;
  borderRadius: number;
  borderWidth: number;
  borderColor: string;
  innerPaddingX: number;
  innerPaddingY: number;
}

export interface ImageBlock extends BlockBase {
  type: "image";
  src: string;
  alt: string;
  href: string;
  widthPercent: number;
  align: Align;
  borderRadius: number;
}

export interface DividerBlock extends BlockBase {
  type: "divider";
  color: string;
  thickness: number;
  style: BorderStyle;
  widthPercent: number;
  align: Align;
}

export interface SpacerBlock extends BlockBase {
  type: "spacer";
  height: number;
}

export interface HtmlBlock extends BlockBase {
  type: "html";
  html: string;
}

export interface SocialLink {
  id: string;
  network: SocialNetwork;
  /** Where the icon goes: a profile, a page, or mailto: for Email. Handlebars works here. */
  url: string;
}

/** A row of social network icons, each a link, drawn from the built-in icons in social-icons.ts. */
export interface SocialBlock extends BlockBase {
  type: "social";
  links: SocialLink[];
  shape: SocialShape;
  colorMode: SocialColorMode;
  /** The colour for the Custom style. */
  customColor: string;
  iconSize: number;
  /** Space between icons. */
  gap: number;
  align: Align;
  /** The network's name beside each icon. */
  showLabels: boolean;
}

export type LeafBlock =
  | TextBlock
  | ButtonBlock
  | ImageBlock
  | DividerBlock
  | SpacerBlock
  | HtmlBlock
  | SocialBlock;

export interface Column {
  id: string;
  widthPercent: number;
  blocks: LeafBlock[];
}

export interface ColumnsBlock extends BlockBase {
  type: "columns";
  columns: Column[];
  gap: number;
  verticalAlign: VerticalAlign;
  stackOnMobile: boolean;
}

export type Block = LeafBlock | ColumnsBlock;
export type BlockType = Block["type"];

export interface DesignSettings {
  preheader: string;
  backgroundColor: string;
  contentBackgroundColor: string;
  contentWidth: number;
  contentBorderRadius: number;
  /** A 1px border around the content card; empty for none. */
  contentBorderColor: string;
  contentPadding: number;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  textColor: string;
  linkColor: string;
  headingColor: string;
}

export interface Design {
  version: typeof designVersion;
  settings: DesignSettings;
  blocks: Block[];
}

export const defaultFontFamily = "Arial, Helvetica, sans-serif";

export const defaultSettings: DesignSettings = {
  preheader: "",
  backgroundColor: "#f3f4f6",
  contentBackgroundColor: "#ffffff",
  contentWidth: 600,
  contentBorderRadius: 8,
  contentBorderColor: "",
  contentPadding: 24,
  fontFamily: defaultFontFamily,
  fontSize: 16,
  lineHeight: 1.5,
  textColor: "#1f2937",
  linkColor: "#2563eb",
  headingColor: "#111827",
};

let idCounter = 0;

/** Short, unique within a design; works without a secure context. */
export const createId = (prefix = "b"): string => {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
};

export const spacing = (vertical: number, horizontal = vertical): Spacing => ({
  top: vertical,
  right: horizontal,
  bottom: vertical,
  left: horizontal,
});

const base = (padding: Spacing = spacing(8, 24)): BlockBase => ({
  id: createId(),
  padding,
  backgroundColor: "",
  showIf: "",
  hideOnMobile: false,
  boxBorderWidth: 0,
  boxBorderColor: "#e5e7eb",
  boxBorderSide: "all",
  boxBorderRadius: 0,
  boxPadding: 0,
});

export const createTextBlock = (
  html = "<p>Write something here. Use {{name}} to add a variable.</p>",
): TextBlock => ({ ...base(), type: "text", html });

export const createHeadingBlock = (text = "A clear, friendly heading") =>
  createTextBlock(`<h1>${text}</h1>`);

export const createButtonBlock = (
  label = "Get started",
  url = "https://example.com",
): ButtonBlock => ({
  ...base(spacing(16, 24)),
  type: "button",
  label,
  url,
  align: "center",
  isFullWidth: false,
  buttonColor: "#2563eb",
  textColor: "#ffffff",
  fontFamily: "",
  fontSize: 16,
  isBold: true,
  isItalic: false,
  letterSpacing: 0,
  borderRadius: 6,
  borderWidth: 0,
  borderColor: "#1d4ed8",
  innerPaddingX: 28,
  innerPaddingY: 14,
});

export const createImageBlock = (): ImageBlock => ({
  ...base(spacing(8, 24)),
  type: "image",
  src: "",
  alt: "",
  href: "",
  widthPercent: 100,
  align: "center",
  borderRadius: 0,
});

export const createDividerBlock = (): DividerBlock => ({
  ...base(spacing(16, 24)),
  type: "divider",
  color: "#e5e7eb",
  thickness: 1,
  style: "solid",
  widthPercent: 100,
  align: "center",
});

export const createSpacerBlock = (height = 24): SpacerBlock => ({
  ...base(spacing(0)),
  type: "spacer",
  height,
});

export const createHtmlBlock = (
  html = '<p style="margin:0">Custom HTML with {{variables}}</p>',
): HtmlBlock => ({ ...base(), type: "html", html });

/** A starting address for each network, for the author to replace with their own. */
export const socialStartUrl = (network: SocialNetwork): string =>
  ({
    facebook: "https://www.facebook.com/",
    instagram: "https://www.instagram.com/",
    x: "https://x.com/",
    linkedin: "https://www.linkedin.com/",
    youtube: "https://www.youtube.com/",
    tiktok: "https://www.tiktok.com/",
    threads: "https://www.threads.net/",
    bluesky: "https://bsky.app/",
    mastodon: "https://mastodon.social/",
    pinterest: "https://www.pinterest.com/",
    github: "https://github.com/",
    discord: "https://discord.com/",
    whatsapp: "https://wa.me/",
    telegram: "https://t.me/",
    reddit: "https://www.reddit.com/",
    snapchat: "https://www.snapchat.com/",
    twitch: "https://www.twitch.tv/",
    dribbble: "https://dribbble.com/",
    behance: "https://www.behance.net/",
    medium: "https://medium.com/",
    spotify: "https://open.spotify.com/",
    vimeo: "https://vimeo.com/",
    tumblr: "https://www.tumblr.com/",
    substack: "https://substack.com/",
    rss: "https://example.com/feed.xml",
    website: "https://example.com",
    email: "mailto:hello@example.com",
  })[network];

/** Enough for every network once, with room for a second account on a few. */
export const maxSocialLinks = 30;

export const createSocialLink = (network: SocialNetwork): SocialLink => ({
  id: createId("s"),
  network,
  url: socialStartUrl(network),
});

export const createSocialBlock = (
  networks: readonly SocialNetwork[] = [
    "facebook",
    "instagram",
    "x",
    "linkedin",
  ],
): SocialBlock => ({
  ...base(spacing(16, 24)),
  type: "social",
  links: networks.map(createSocialLink),
  shape: "circle",
  colorMode: "brand",
  customColor: "#111827",
  iconSize: 32,
  gap: 12,
  align: "center",
  showLabels: false,
});

export const createColumnsBlock = (count = 2): ColumnsBlock => {
  const width = Math.round((100 / count) * 100) / 100;
  return {
    ...base(spacing(8, 24)),
    type: "columns",
    gap: 16,
    verticalAlign: "top",
    stackOnMobile: true,
    columns: Array.from({ length: count }, (_, index) => ({
      id: createId("c"),
      widthPercent: width,
      blocks: [
        {
          ...createTextBlock(`<p>Column ${String(index + 1)}</p>`),
          padding: spacing(0),
        },
      ],
    })),
  };
};

export const createBlock = (type: BlockType): Block => {
  switch (type) {
    case "text":
      return createTextBlock();
    case "button":
      return createButtonBlock();
    case "image":
      return createImageBlock();
    case "divider":
      return createDividerBlock();
    case "spacer":
      return createSpacerBlock();
    case "html":
      return createHtmlBlock();
    case "social":
      return createSocialBlock();
    case "columns":
      return createColumnsBlock();
  }
};

export const createDesign = (blocks: Block[] = []): Design => ({
  version: designVersion,
  settings: { ...defaultSettings },
  blocks,
});

/* ---------- Where a block lives ---------- */

/** "root", or the ID of a column inside a columns block. */
export type ContainerId = string;
export const rootContainer: ContainerId = "root";

export interface BlockLocation {
  container: ContainerId;
  index: number;
  /** The columns block that owns the container, when it is a column. */
  parentId: string | undefined;
}

export const findBlock = (design: Design, id: string): Block | undefined => {
  for (const block of design.blocks) {
    if (block.id === id) {
      return block;
    }
    if (block.type === "columns") {
      for (const column of block.columns) {
        const found = column.blocks.find((child) => child.id === id);
        if (found !== undefined) {
          return found;
        }
      }
    }
  }
  return undefined;
};

export const locateBlock = (
  design: Design,
  id: string,
): BlockLocation | undefined => {
  const rootIndex = design.blocks.findIndex((block) => block.id === id);
  if (rootIndex !== -1) {
    return { container: rootContainer, index: rootIndex, parentId: undefined };
  }
  for (const block of design.blocks) {
    if (block.type === "columns") {
      for (const column of block.columns) {
        const index = column.blocks.findIndex((child) => child.id === id);
        if (index !== -1) {
          return { container: column.id, index, parentId: block.id };
        }
      }
    }
  }
  return undefined;
};

const containerSize = (design: Design, container: ContainerId): number => {
  if (container === rootContainer) {
    return design.blocks.length;
  }
  for (const block of design.blocks) {
    if (block.type === "columns") {
      const column = block.columns.find((item) => item.id === container);
      if (column !== undefined) {
        return column.blocks.length;
      }
    }
  }
  return 0;
};

const clampIndex = (index: number, size: number) =>
  Math.max(0, Math.min(index, size));

const mapLeaves = (
  design: Design,
  change: (blocks: LeafBlock[], column: Column) => LeafBlock[],
): Design => ({
  ...design,
  blocks: design.blocks.map((block) =>
    block.type === "columns"
      ? {
          ...block,
          columns: block.columns.map((column) => ({
            ...column,
            blocks: change(column.blocks, column),
          })),
        }
      : block,
  ),
});

export const updateBlock = (
  design: Design,
  id: string,
  change: Partial<Block>,
): Design => {
  const apply = <T extends Block>(block: T): T =>
    block.id === id
      ? { ...block, ...change, id: block.id, type: block.type }
      : block;
  const updated = { ...design, blocks: design.blocks.map(apply) };
  return mapLeaves(updated, (blocks) => blocks.map(apply));
};

export const removeBlock = (design: Design, id: string): Design =>
  mapLeaves(
    { ...design, blocks: design.blocks.filter((block) => block.id !== id) },
    (blocks) => blocks.filter((block) => block.id !== id),
  );

const isLeaf = (block: Block): block is LeafBlock => block.type !== "columns";

export const insertBlock = (
  design: Design,
  container: ContainerId,
  index: number,
  block: Block,
): Design => {
  if (container === rootContainer) {
    const blocks = [...design.blocks];
    blocks.splice(clampIndex(index, blocks.length), 0, block);
    return { ...design, blocks };
  }
  if (!isLeaf(block)) {
    // Columns do not nest: put them below the columns block instead.
    const parent = design.blocks.findIndex(
      (item) =>
        item.type === "columns" &&
        item.columns.some((column) => column.id === container),
    );
    return parent === -1
      ? design
      : insertBlock(design, rootContainer, parent + 1, block);
  }
  return mapLeaves(design, (blocks, column) => {
    if (column.id !== container) {
      return blocks;
    }
    const next = [...blocks];
    next.splice(clampIndex(index, next.length), 0, block);
    return next;
  });
};

export const moveBlock = (
  design: Design,
  id: string,
  container: ContainerId,
  index: number,
): Design => {
  const block = findBlock(design, id);
  const from = locateBlock(design, id);
  if (block === undefined || from === undefined) {
    return design;
  }
  const isSameContainer = from.container === container;
  const target = isSameContainer && from.index < index ? index - 1 : index;
  if (isSameContainer && target === from.index) {
    return design;
  }
  if (block.type === "columns" && container !== rootContainer) {
    return design;
  }
  return insertBlock(removeBlock(design, id), container, target, block);
};

/** Moves a block one place up (-1) or down (+1) within its container. */
export const nudgeBlock = (
  design: Design,
  id: string,
  delta: -1 | 1,
): Design => {
  const from = locateBlock(design, id);
  if (from === undefined) {
    return design;
  }
  const target = from.index + delta;
  if (target < 0 || target >= containerSize(design, from.container)) {
    return design;
  }
  return moveBlock(
    design,
    id,
    from.container,
    delta === 1 ? target + 1 : target,
  );
};

export const cloneWithNewIds = <T extends Block>(block: T): T =>
  block.type === "columns"
    ? {
        ...block,
        id: createId(),
        columns: block.columns.map((column) => ({
          ...column,
          id: createId("c"),
          blocks: column.blocks.map((child) => cloneWithNewIds(child)),
        })),
      }
    : block.type === "social"
      ? {
          ...block,
          id: createId(),
          links: block.links.map((link) => ({ ...link, id: createId("s") })),
        }
      : { ...block, id: createId() };

export const duplicateBlock = (
  design: Design,
  id: string,
): { design: Design; newId: string | undefined } => {
  const block = findBlock(design, id);
  const location = locateBlock(design, id);
  if (block === undefined || location === undefined) {
    return { design, newId: undefined };
  }
  const copy = cloneWithNewIds(block);
  return {
    design: insertBlock(design, location.container, location.index + 1, copy),
    newId: copy.id,
  };
};

export const setColumnCount = (
  block: ColumnsBlock,
  count: number,
): ColumnsBlock => {
  const width = Math.round((100 / count) * 100) / 100;
  const columns = Array.from({ length: count }, (_, index) => {
    const existing = block.columns[index];
    return {
      id: existing?.id ?? createId("c"),
      widthPercent: width,
      blocks: existing?.blocks ?? [],
    };
  });
  // Keep the content of columns that are removed by appending it to the last one.
  const removed = block.columns.slice(count).flatMap((column) => column.blocks);
  const last = columns.at(-1);
  if (last !== undefined) {
    last.blocks = [...last.blocks, ...removed];
  }
  return { ...block, columns };
};

/* ---------- Reading a saved design ---------- */

const readString = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const readNumberIn = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

const readBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const readOneOf = <T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T => options.find((option) => option === value) ?? fallback;

const aligns: readonly Align[] = ["left", "center", "right"];

const readSpacing = (value: unknown, fallback: Spacing): Spacing =>
  isRecord(value)
    ? {
        top: readNumberIn(value.top, fallback.top, 0, 200),
        right: readNumberIn(value.right, fallback.right, 0, 200),
        bottom: readNumberIn(value.bottom, fallback.bottom, 0, 200),
        left: readNumberIn(value.left, fallback.left, 0, 200),
      }
    : fallback;

const readBase = (value: Record<string, unknown>, fallback: BlockBase) => ({
  id: readString(value.id, fallback.id) || fallback.id,
  padding: readSpacing(value.padding, fallback.padding),
  backgroundColor: readString(value.backgroundColor, ""),
  showIf: readString(value.showIf, ""),
  hideOnMobile: readBoolean(value.hideOnMobile, false),
  boxBorderWidth: readNumberIn(value.boxBorderWidth, 0, 0, 20),
  boxBorderColor: readString(value.boxBorderColor, fallback.boxBorderColor),
  boxBorderSide: readOneOf(value.boxBorderSide, ["all", "left"], "all"),
  boxBorderRadius: readNumberIn(value.boxBorderRadius, 0, 0, 60),
  boxPadding: readNumberIn(value.boxPadding, 0, 0, 80),
});

const readLeaf = (value: unknown): LeafBlock | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  switch (value.type) {
    case "text": {
      const fallback = createTextBlock("");
      return {
        ...readBase(value, fallback),
        type: "text",
        html: readString(value.html, ""),
      };
    }
    case "button": {
      const d = createButtonBlock();
      return {
        ...readBase(value, d),
        type: "button",
        label: readString(value.label, d.label),
        url: readString(value.url, d.url),
        align: readOneOf(value.align, aligns, d.align),
        isFullWidth: readBoolean(value.isFullWidth, d.isFullWidth),
        buttonColor: readString(value.buttonColor, d.buttonColor),
        textColor: readString(value.textColor, d.textColor),
        fontFamily: readString(value.fontFamily, d.fontFamily),
        fontSize: readNumberIn(value.fontSize, d.fontSize, 8, 72),
        isBold: readBoolean(value.isBold, d.isBold),
        isItalic: readBoolean(value.isItalic, d.isItalic),
        letterSpacing: readNumberIn(value.letterSpacing, 0, -5, 20),
        borderRadius: readNumberIn(value.borderRadius, d.borderRadius, 0, 100),
        borderWidth: readNumberIn(value.borderWidth, d.borderWidth, 0, 20),
        borderColor: readString(value.borderColor, d.borderColor),
        innerPaddingX: readNumberIn(
          value.innerPaddingX,
          d.innerPaddingX,
          0,
          120,
        ),
        innerPaddingY: readNumberIn(
          value.innerPaddingY,
          d.innerPaddingY,
          0,
          80,
        ),
      };
    }
    case "image": {
      const d = createImageBlock();
      return {
        ...readBase(value, d),
        type: "image",
        src: readString(value.src, ""),
        alt: readString(value.alt, ""),
        href: readString(value.href, ""),
        widthPercent: readNumberIn(value.widthPercent, 100, 5, 100),
        align: readOneOf(value.align, aligns, d.align),
        borderRadius: readNumberIn(value.borderRadius, 0, 0, 500),
      };
    }
    case "divider": {
      const d = createDividerBlock();
      return {
        ...readBase(value, d),
        type: "divider",
        color: readString(value.color, d.color),
        thickness: readNumberIn(value.thickness, d.thickness, 1, 20),
        style: readOneOf(value.style, ["solid", "dashed", "dotted"], "solid"),
        widthPercent: readNumberIn(value.widthPercent, 100, 5, 100),
        align: readOneOf(value.align, aligns, d.align),
      };
    }
    case "spacer": {
      const d = createSpacerBlock();
      return {
        ...readBase(value, d),
        type: "spacer",
        height: readNumberIn(value.height, d.height, 1, 400),
      };
    }
    case "html": {
      const d = createHtmlBlock("");
      return {
        ...readBase(value, d),
        type: "html",
        html: readString(value.html, ""),
      };
    }
    case "social": {
      const d = createSocialBlock([]);
      const links = Array.isArray(value.links)
        ? value.links.filter(isRecord).flatMap((link) =>
            isSocialNetwork(link.network)
              ? [
                  {
                    id: readString(link.id, "") || createId("s"),
                    network: link.network,
                    url: readString(link.url, ""),
                  },
                ]
              : [],
          )
        : [];
      return {
        ...readBase(value, d),
        type: "social",
        links: links.slice(0, maxSocialLinks),
        shape: readOneOf(value.shape, socialShapes, d.shape),
        colorMode: readOneOf(value.colorMode, socialColorModes, d.colorMode),
        customColor: readString(value.customColor, d.customColor),
        iconSize: readNumberIn(value.iconSize, d.iconSize, 16, 64),
        gap: readNumberIn(value.gap, d.gap, 0, 48),
        align: readOneOf(value.align, aligns, d.align),
        showLabels: readBoolean(value.showLabels, d.showLabels),
      };
    }
    default:
      return undefined;
  }
};

const readBlock = (value: unknown): Block | undefined => {
  if (isRecord(value) && value.type === "columns") {
    const d = createColumnsBlock();
    const columns = Array.isArray(value.columns)
      ? value.columns.filter(isRecord).map((column) => ({
          id: readString(column.id, "") || createId("c"),
          widthPercent: readNumberIn(column.widthPercent, 50, 5, 100),
          blocks: Array.isArray(column.blocks)
            ? column.blocks.map(readLeaf).filter((block) => block !== undefined)
            : [],
        }))
      : [];
    return columns.length === 0
      ? undefined
      : {
          ...readBase(value, d),
          type: "columns",
          columns: columns.slice(0, 4),
          gap: readNumberIn(value.gap, d.gap, 0, 80),
          verticalAlign: readOneOf(
            value.verticalAlign,
            ["top", "middle", "bottom"],
            "top",
          ),
          stackOnMobile: readBoolean(value.stackOnMobile, true),
        };
  }
  return readLeaf(value);
};

const readSettings = (value: unknown): DesignSettings => {
  const d = defaultSettings;
  if (!isRecord(value)) {
    return { ...d };
  }
  return {
    preheader: readString(value.preheader, d.preheader),
    backgroundColor: readString(value.backgroundColor, d.backgroundColor),
    contentBackgroundColor: readString(
      value.contentBackgroundColor,
      d.contentBackgroundColor,
    ),
    contentWidth: readNumberIn(value.contentWidth, d.contentWidth, 320, 900),
    contentBorderRadius: readNumberIn(
      value.contentBorderRadius,
      d.contentBorderRadius,
      0,
      40,
    ),
    contentBorderColor: readString(
      value.contentBorderColor,
      d.contentBorderColor,
    ),
    contentPadding: readNumberIn(value.contentPadding, d.contentPadding, 0, 80),
    fontFamily: readString(value.fontFamily, d.fontFamily) || d.fontFamily,
    fontSize: readNumberIn(value.fontSize, d.fontSize, 8, 40),
    lineHeight: readNumberIn(value.lineHeight, d.lineHeight, 0.8, 3),
    textColor: readString(value.textColor, d.textColor),
    linkColor: readString(value.linkColor, d.linkColor),
    headingColor: readString(value.headingColor, d.headingColor),
  };
};

/** Reads a design saved by this or an older version; undefined if it is not one. */
export const parseDesign = (value: unknown): Design | undefined => {
  if (!isRecord(value) || value.version !== designVersion) {
    return undefined;
  }
  const blocks = Array.isArray(value.blocks)
    ? value.blocks.map(readBlock).filter((block) => block !== undefined)
    : [];
  return {
    version: designVersion,
    settings: readSettings(value.settings),
    blocks,
  };
};
