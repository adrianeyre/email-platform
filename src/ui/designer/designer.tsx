import {
  ArrowDownIcon,
  ArrowUpIcon,
  ButtonIcon,
  CodeIcon,
  CogIcon,
  ColumnsIcon,
  CopyIcon,
  DividerIcon,
  GripIcon,
  HeadingIcon,
  ImageIcon,
  MonitorIcon,
  PhoneIcon,
  RedoIcon,
  SocialsIcon,
  SpacerIcon,
  TextIcon,
  TrashIcon,
  UndoIcon,
} from "../icons.js";
import {
  createContext,
  useContext,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  createBlock,
  duplicateBlock,
  findBlock,
  insertBlock,
  locateBlock,
  moveBlock,
  nudgeBlock,
  removeBlock,
  rootContainer,
  updateBlock,
  type Block,
  type BlockType,
  type ButtonBlock,
  type ColumnsBlock,
  type ContainerId,
  type Design,
  type DividerBlock,
  type ImageBlock,
  type LeafBlock,
  type SocialBlock,
} from "../../templates/design/model.js";
import { safeColor } from "../../templates/design/render-html.js";
import {
  socialIcons,
  socialIconSvg,
} from "../../templates/design/social-icons.js";
import { navigateTo } from "../router.js";
import { Inspector } from "./inspector.js";
import { RichText } from "./rich-text.js";

/* ---------- Shared state ---------- */

export type ChangeDesign = (design: Design, key?: string) => void;

interface DesignerState {
  design: Design;
  change: ChangeDesign;
  selectedId: string | undefined;
  select: (id: string | undefined) => void;
  variables: readonly string[];
  isMobile: boolean;
  isDragging: boolean;
  setDragging: (isDragging: boolean) => void;
}

const DesignerContext = createContext<DesignerState | undefined>(undefined);

const useDesigner = (): DesignerState => {
  const state = useContext(DesignerContext);
  if (state === undefined) {
    throw new Error("useDesigner is used outside the designer");
  }
  return state;
};

export const blockTypes: readonly {
  type: BlockType;
  label: string;
  icon: ReactNode;
  description: string;
}[] = [
  {
    type: "text",
    label: "Text",
    icon: <TextIcon size={20} />,
    description: "Paragraphs, headings, lists and links",
  },
  {
    type: "button",
    label: "Button",
    icon: <ButtonIcon size={20} />,
    description: "A link that looks like a button",
  },
  {
    type: "image",
    label: "Image",
    icon: <ImageIcon size={20} />,
    description: "A picture from a URL, optionally linked",
  },
  {
    type: "columns",
    label: "Columns",
    icon: <ColumnsIcon size={20} />,
    description: "2–4 columns side by side",
  },
  {
    type: "divider",
    label: "Divider",
    icon: <DividerIcon size={20} />,
    description: "A horizontal line",
  },
  {
    type: "spacer",
    label: "Spacer",
    icon: <SpacerIcon size={20} />,
    description: "Empty vertical space",
  },
  {
    type: "social",
    label: "Socials",
    icon: <SocialsIcon size={20} />,
    description: "Linked icons for your social networks",
  },
  {
    type: "html",
    label: "HTML",
    icon: <CodeIcon size={20} />,
    description: "Your own HTML and Handlebars",
  },
];

const headingPreset = "heading";

export const blockLabel = (block: Block): string => {
  if (block.type === "text") {
    const plain = block.html
      .replaceAll(/<[^>]+>/gu, " ")
      .replaceAll(/\s+/gu, " ")
      .trim();
    const name = /^<h[1-3]/u.test(block.html) ? "Heading" : "Text";
    return plain === "" ? name : `${name}: ${plain.slice(0, 40)}`;
  }
  if (block.type === "button") {
    return `Button: ${block.label}`;
  }
  if (block.type === "social") {
    const names = block.links.map((link) => socialIcons[link.network].label);
    return names.length === 0 ? "Socials" : `Socials: ${names.join(", ")}`;
  }
  return (
    blockTypes.find((item) => item.type === block.type)?.label ?? block.type
  );
};

const dragType = "application/x-email-block";

const readDrag = (
  event: DragEvent,
): { kind: "new" | "move"; value: string } | undefined => {
  const data = event.dataTransfer.getData(dragType);
  const [kind, value] = data.split(":");
  return (kind === "new" || kind === "move") && value !== undefined
    ? { kind, value }
    : undefined;
};

const createFromPalette = (value: string): Block => {
  if (value === headingPreset) {
    const block = createBlock("text");
    return {
      ...block,
      type: "text",
      html: "<h1>A clear, friendly heading</h1>",
    } satisfies LeafBlock;
  }
  const type = blockTypes.find((item) => item.type === value)?.type ?? "text";
  return createBlock(type);
};

/* ---------- Drop zones ---------- */

/** Puts a dragged palette item or block at a place in a container, and selects it. */
const useDrop = () => {
  const { design, change, select, setDragging } = useDesigner();
  return (event: DragEvent, container: ContainerId, index: number) => {
    event.preventDefault();
    setDragging(false);
    const drag = readDrag(event);
    if (drag === undefined) {
      return;
    }
    if (drag.kind === "new") {
      const block = createFromPalette(drag.value);
      change(insertBlock(design, container, index, block));
      select(block.id);
    } else if (drag.value !== "") {
      change(moveBlock(design, drag.value, container, index));
      select(drag.value);
    }
  };
};

const DropZone = ({
  container,
  index,
  isOnly = false,
}: {
  container: ContainerId;
  index: number;
  isOnly?: boolean;
}) => {
  const { isDragging } = useDesigner();
  const drop = useDrop();
  const [isOver, setOver] = useState(false);
  return (
    <div
      className={`drop-zone${isDragging ? " is-dragging" : ""}${isOver ? " is-over" : ""}${isOnly ? " is-only" : ""}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(dragType)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setOver(true);
        }
      }}
      onDragLeave={() => {
        setOver(false);
      }}
      onDrop={(event) => {
        event.stopPropagation();
        setOver(false);
        drop(event, container, index);
      }}
    >
      {isOnly ? <span>Drop blocks here</span> : null}
    </div>
  );
};

/* ---------- Block previews ---------- */

const ButtonPreview = ({ block }: { block: ButtonBlock }) => {
  const { design } = useDesigner();
  const style: CSSProperties = {
    display: block.isFullWidth ? "block" : "inline-block",
    background: safeColor(block.buttonColor, "#2563eb"),
    color: safeColor(block.textColor, "#ffffff"),
    fontFamily: block.fontFamily || design.settings.fontFamily,
    fontSize: block.fontSize,
    fontWeight: block.isBold ? 700 : 400,
    fontStyle: block.isItalic ? "italic" : "normal",
    letterSpacing: block.letterSpacing,
    lineHeight: 1.25,
    borderRadius: block.borderRadius,
    border:
      block.borderWidth > 0
        ? `${String(block.borderWidth)}px solid ${safeColor(block.borderColor)}`
        : undefined,
    padding: `${String(block.innerPaddingY)}px ${String(block.innerPaddingX)}px`,
    textAlign: "center",
    textDecoration: "none",
  };
  return (
    <div style={{ textAlign: block.align }}>
      <span style={style} className="hb-aware">
        {block.label || "Button"}
      </span>
    </div>
  );
};

const ImagePreview = ({ block }: { block: ImageBlock }) => {
  const justify = { left: "flex-start", center: "center", right: "flex-end" }[
    block.align
  ];
  return (
    <div style={{ display: "flex", justifyContent: justify }}>
      {block.src.trim() === "" ? (
        <div
          className="image-placeholder"
          style={{ width: `${String(block.widthPercent)}%` }}
        >
          <ImageIcon size={32} />
          <span>Add an image address in the panel</span>
        </div>
      ) : (
        <img
          src={block.src}
          alt={block.alt}
          style={{
            width: `${String(block.widthPercent)}%`,
            height: "auto",
            display: "block",
            borderRadius: block.borderRadius,
          }}
        />
      )}
    </div>
  );
};

const DividerPreview = ({ block }: { block: DividerBlock }) => (
  <div
    style={{
      display: "flex",
      justifyContent: {
        left: "flex-start",
        center: "center",
        right: "flex-end",
      }[block.align],
    }}
  >
    <div
      style={{
        width: `${String(block.widthPercent)}%`,
        borderTop: `${String(block.thickness)}px ${block.style} ${safeColor(block.color, "#e5e7eb")}`,
      }}
    />
  </div>
);

/**
 * The icons as the email draws them: the same SVG the server writes, so what you see is what is sent. A link with
 * no address is shown faded, as the email leaves it out.
 */
const SocialPreview = ({ block }: { block: SocialBlock }) => {
  const { design } = useDesigner();
  if (block.links.length === 0) {
    return (
      <p className="social-empty">Add a network in the panel to show icons.</p>
    );
  }
  return (
    <div
      className="social-preview"
      style={{
        justifyContent: {
          left: "flex-start",
          center: "center",
          right: "flex-end",
        }[block.align],
        gap: block.gap,
      }}
    >
      {block.links.map((link) => (
        <span
          key={link.id}
          className="social-preview-item"
          data-empty={link.url.trim() === "" ? "" : undefined}
          title={link.url.trim() || "No address: left out of the email"}
          style={{
            color: safeColor(design.settings.textColor, "#1f2937"),
            fontFamily: design.settings.fontFamily,
            fontSize: Math.max(12, Math.min(18, block.iconSize * 0.45)),
          }}
        >
          <span
            className="social-preview-icon"
            // Built from the icon table and checked colours only, never from what the author typed.
            dangerouslySetInnerHTML={{
              __html: socialIconSvg(link.network, block, block.iconSize),
            }}
          />
          {block.showLabels ? (
            <span>{socialIcons[link.network].label}</span>
          ) : null}
        </span>
      ))}
    </div>
  );
};

/** Custom HTML is shown in a frame that runs no scripts, sized to its content. */
const HtmlPreview = ({ html }: { html: string }) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(40);
  const { design } = useDesigner();
  const measure = () => {
    const body = frameRef.current?.contentDocument?.body;
    if (body !== undefined) {
      setHeight(Math.max(24, body.scrollHeight));
    }
  };
  return (
    <iframe
      ref={frameRef}
      title="Custom HTML"
      className="html-block-frame"
      sandbox="allow-same-origin"
      style={{ height }}
      onLoad={measure}
      srcDoc={`<!doctype html><html><head><style>body{margin:0;font-family:${design.settings.fontFamily};font-size:${String(design.settings.fontSize)}px;color:${safeColor(design.settings.textColor)};}</style></head><body>${html}</body></html>`}
    />
  );
};

const ColumnsPreview = ({ block }: { block: ColumnsBlock }) => {
  const { isMobile } = useDesigner();
  const isStacked = isMobile && block.stackOnMobile;
  return (
    <div
      className="columns-preview"
      style={{
        flexDirection: isStacked ? "column" : "row",
        gap: block.gap,
        alignItems: { top: "flex-start", middle: "center", bottom: "flex-end" }[
          block.verticalAlign
        ],
      }}
    >
      {block.columns.map((column, index) => (
        <div
          key={column.id}
          className="column-preview"
          style={{
            flex: isStacked
              ? "1 1 auto"
              : `0 0 calc(${String(column.widthPercent)}% - ${String((block.gap * (block.columns.length - 1)) / block.columns.length)}px)`,
          }}
          aria-label={`Column ${String(index + 1)}`}
        >
          <BlockList blocks={column.blocks} container={column.id} />
        </div>
      ))}
    </div>
  );
};

const BlockContent = ({ block }: { block: Block }) => {
  const { design, change, select, selectedId, variables } = useDesigner();
  switch (block.type) {
    case "text":
      return (
        <RichText
          html={block.html}
          label={blockLabel(block)}
          isSelected={selectedId === block.id}
          variables={variables}
          onFocus={() => {
            select(block.id);
          }}
          onChange={(html) => {
            change(updateBlock(design, block.id, { html }), `text:${block.id}`);
          }}
        />
      );
    case "button":
      return <ButtonPreview block={block} />;
    case "image":
      return <ImagePreview block={block} />;
    case "divider":
      return <DividerPreview block={block} />;
    case "spacer":
      return (
        <div className="spacer-preview" style={{ height: block.height }} />
      );
    case "html":
      return <HtmlPreview html={block.html} />;
    case "social":
      return <SocialPreview block={block} />;
    case "columns":
      return <ColumnsPreview block={block} />;
  }
};

const boxStyle = (block: Block): CSSProperties => {
  const color = safeColor(block.boxBorderColor, "#e5e7eb");
  const border =
    block.boxBorderWidth === 0
      ? undefined
      : `${String(block.boxBorderWidth)}px solid ${color}`;
  return {
    background: safeColor(block.backgroundColor) || undefined,
    border: block.boxBorderSide === "all" ? border : undefined,
    borderLeft: block.boxBorderSide === "left" ? border : undefined,
    borderRadius: block.boxBorderRadius,
    padding: block.boxPadding,
  };
};

const BlockFrame = ({ block }: { block: Block }) => {
  const { design, change, selectedId, select, isMobile, setDragging } =
    useDesigner();
  const isSelected = selectedId === block.id;
  const location = locateBlock(design, block.id);
  const run = (next: Design, nextSelection?: string) => {
    change(next);
    if (nextSelection !== undefined) {
      select(nextSelection);
    }
  };
  const isHiddenHere = isMobile && block.hideOnMobile;
  const { padding } = block;
  const drop = useDrop();
  const [dropEdge, setDropEdge] = useState<"before" | "after" | undefined>(
    undefined,
  );
  return (
    <div
      className={`block-frame${isSelected ? " is-selected" : ""}${isHiddenHere ? " is-hidden-here" : ""}${dropEdge === undefined ? "" : ` drop-${dropEdge}`}`}
      data-block-id={block.id}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(dragType)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        setDropEdge(
          event.clientY < rect.top + rect.height / 2 ? "before" : "after",
        );
      }}
      onDragLeave={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setDropEdge(undefined);
        }
      }}
      onDrop={(event) => {
        event.stopPropagation();
        const edge = dropEdge;
        setDropEdge(undefined);
        if (location !== undefined) {
          drop(
            event,
            location.container,
            location.index + (edge === "after" ? 1 : 0),
          );
        }
      }}
      onClick={(event) => {
        event.stopPropagation();
        select(block.id);
      }}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          select(block.id);
        }
      }}
      tabIndex={0}
      role="group"
      aria-label={blockLabel(block)}
      aria-current={isSelected ? "true" : undefined}
    >
      <div
        className="block-toolbar"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <span
          className="drag-handle"
          draggable
          title="Drag to move"
          aria-hidden="true"
          onDragStart={(event) => {
            event.dataTransfer.setData(dragType, `move:${block.id}`);
            event.dataTransfer.effectAllowed = "move";
            const frame = event.currentTarget.closest(".block-frame");
            if (frame !== null) {
              event.dataTransfer.setDragImage(frame, 20, 20);
            }
            setDragging(true);
          }}
          onDragEnd={() => {
            setDragging(false);
          }}
        >
          <GripIcon size={16} />
        </span>
        <span className="block-type">{blockLabel(block).split(":")[0]}</span>
        <button
          type="button"
          aria-label="Move up"
          title="Move up (Alt+↑)"
          disabled={location?.index === 0}
          onClick={() => {
            run(nudgeBlock(design, block.id, -1));
          }}
        >
          <ArrowUpIcon size={16} />
        </button>
        <button
          type="button"
          aria-label="Move down"
          title="Move down (Alt+↓)"
          onClick={() => {
            run(nudgeBlock(design, block.id, 1));
          }}
        >
          <ArrowDownIcon size={16} />
        </button>
        <button
          type="button"
          aria-label="Duplicate"
          title="Duplicate (⌘D)"
          onClick={() => {
            const result = duplicateBlock(design, block.id);
            run(result.design, result.newId);
          }}
        >
          <CopyIcon size={16} />
        </button>
        <button
          type="button"
          aria-label="Delete"
          title="Delete (Del)"
          className="danger"
          onClick={() => {
            run(removeBlock(design, block.id));
            select(undefined);
          }}
        >
          <TrashIcon size={16} />
        </button>
      </div>
      {block.showIf.trim() === "" && !block.hideOnMobile ? null : (
        <div className="block-badges">
          {block.showIf.trim() === "" ? null : (
            <span className="block-badge">if {block.showIf}</span>
          )}
          {block.hideOnMobile ? (
            <span className="block-badge">Hidden on phones</span>
          ) : null}
        </div>
      )}
      <div
        style={{
          padding: `${String(padding.top)}px ${String(padding.right)}px ${String(padding.bottom)}px ${String(padding.left)}px`,
        }}
      >
        <div style={boxStyle(block)}>
          <BlockContent block={block} />
        </div>
      </div>
    </div>
  );
};

const BlockList = ({
  blocks,
  container,
}: {
  blocks: readonly Block[];
  container: ContainerId;
}) => (
  <div className="block-list">
    <DropZone container={container} index={0} isOnly={blocks.length === 0} />
    {blocks.map((block, index) => (
      <div key={block.id}>
        <BlockFrame block={block} />
        <DropZone container={container} index={index + 1} />
      </div>
    ))}
  </div>
);

/* ---------- Side panels ---------- */

const Palette = () => {
  const { design, change, selectedId, select, setDragging } = useDesigner();
  const add = (value: string) => {
    const block = createFromPalette(value);
    const location =
      selectedId === undefined ? undefined : locateBlock(design, selectedId);
    const next =
      location === undefined
        ? insertBlock(design, rootContainer, design.blocks.length, block)
        : insertBlock(design, location.container, location.index + 1, block);
    change(next);
    select(block.id);
  };
  const items = [
    {
      value: headingPreset,
      label: "Heading",
      icon: <HeadingIcon size={20} />,
      description: "A large title",
    },
    ...blockTypes.map((item) => ({ ...item, value: item.type })),
  ];
  return (
    <div className="palette" role="list" aria-label="Blocks to add">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="listitem"
          className="palette-item"
          draggable
          title={`${item.description}. Drag onto the email, or click to add${selectedId === undefined ? " at the end" : " below the selected block"}.`}
          onDragStart={(event) => {
            event.dataTransfer.setData(dragType, `new:${item.value}`);
            event.dataTransfer.effectAllowed = "copyMove";
            setDragging(true);
          }}
          onDragEnd={() => {
            setDragging(false);
          }}
          onClick={() => {
            add(item.value);
          }}
        >
          <span className="palette-icon" aria-hidden="true">
            {item.icon}
          </span>
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
};

const Outline = () => {
  const { design, selectedId, select } = useDesigner();
  const item = (block: Block, depth: number): ReactNode => (
    <li key={block.id}>
      <button
        type="button"
        className="outline-item"
        aria-current={selectedId === block.id ? "true" : undefined}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => {
          select(block.id);
          document
            .querySelector(`[data-block-id="${block.id}"]`)
            ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }}
      >
        {blockLabel(block)}
      </button>
      {block.type === "columns" ? (
        <ul>
          {block.columns.map((column, index) => (
            <li key={column.id}>
              <span
                className="outline-column"
                style={{ paddingLeft: 8 + (depth + 1) * 14 }}
              >
                Column {index + 1}
              </span>
              <ul>{column.blocks.map((child) => item(child, depth + 2))}</ul>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
  return design.blocks.length === 0 ? (
    <p className="muted small">No blocks yet.</p>
  ) : (
    <ul className="outline">{design.blocks.map((block) => item(block, 0))}</ul>
  );
};

/* ---------- The designer ---------- */

const isTyping = (target: EventTarget) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.closest(".cm-editor") !== null);

export interface LockedPart {
  label: string;
  href: string;
  html: string;
}

/** A Header or Footer shown in line with the email, but edited on its own page. */
const LockedPartView = ({ part }: { part: LockedPart }) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(48);
  return (
    <div className="locked-part">
      <iframe
        ref={frameRef}
        title={part.label}
        className="locked-part-frame"
        sandbox="allow-same-origin"
        tabIndex={-1}
        style={{ height }}
        onLoad={() => {
          const body = frameRef.current?.contentDocument?.body;
          if (body !== undefined) {
            setHeight(Math.max(24, body.scrollHeight));
          }
        }}
        srcDoc={part.html}
      />
      <a
        className="locked-part-label"
        href={part.href}
        onClick={(event) => {
          event.preventDefault();
          navigateTo(part.href);
        }}
      >
        {part.label}
        <span className="visually-hidden">, edit it on its own page</span>
      </a>
    </div>
  );
};

export const Designer = ({
  design,
  onChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  variables,
  lockedTop,
  lockedBottom,
}: {
  lockedTop?: LockedPart;
  lockedBottom?: LockedPart;
  design: Design;
  onChange: ChangeDesign;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  variables: readonly string[];
}) => {
  const [chosenId, setSelectedId] = useState<string | undefined>(undefined);
  const [isMobile, setMobile] = useState(false);
  const [isDragging, setDragging] = useState(false);
  const selected =
    chosenId === undefined ? undefined : findBlock(design, chosenId);

  // A block removed by undo or delete is no longer selected.
  const selectedId = selected?.id;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isTyping(event.target)) {
      return;
    }
    const isMod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (isMod && key === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        onRedo();
      } else {
        onUndo();
      }
    } else if (isMod && key === "y") {
      event.preventDefault();
      onRedo();
    } else if (
      selectedId !== undefined &&
      (key === "delete" || key === "backspace")
    ) {
      event.preventDefault();
      onChange(removeBlock(design, selectedId));
      setSelectedId(undefined);
    } else if (selectedId !== undefined && isMod && key === "d") {
      event.preventDefault();
      const result = duplicateBlock(design, selectedId);
      onChange(result.design);
      setSelectedId(result.newId);
    } else if (
      selectedId !== undefined &&
      event.altKey &&
      (key === "arrowup" || key === "arrowdown")
    ) {
      event.preventDefault();
      onChange(nudgeBlock(design, selectedId, key === "arrowup" ? -1 : 1));
    } else if (key === "escape") {
      setSelectedId(undefined);
    }
  };

  const { settings } = design;
  const canvasStyle = {
    "--email-font": settings.fontFamily,
    "--email-size": `${String(settings.fontSize)}px`,
    "--email-line": String(settings.lineHeight),
    "--email-text": safeColor(settings.textColor, "#1f2937"),
    "--email-heading": safeColor(settings.headingColor, "#111827"),
    "--email-link": safeColor(settings.linkColor, "#2563eb"),
    background: safeColor(settings.backgroundColor, "#f3f4f6"),
  } satisfies CSSProperties & Record<`--${string}`, string>;

  return (
    <DesignerContext.Provider
      value={{
        design,
        change: onChange,
        selectedId,
        select: setSelectedId,
        variables,
        isMobile,
        isDragging,
        setDragging,
      }}
    >
      <div className="designer" onKeyDown={onKeyDown}>
        <aside className="designer-left" aria-label="Blocks">
          <div className="designer-panel">
            <h3 className="panel-title">Add blocks</h3>
            <Palette />
            <h3 className="panel-title">Outline</h3>
            <Outline />
          </div>
        </aside>
        <div className="designer-center">
          <div className="designer-topbar">
            <div
              className="segmented"
              role="radiogroup"
              aria-label="Preview size"
            >
              <button
                type="button"
                role="radio"
                aria-checked={!isMobile}
                onClick={() => {
                  setMobile(false);
                }}
              >
                <MonitorIcon size={16} />
                Desktop
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={isMobile}
                onClick={() => {
                  setMobile(true);
                }}
              >
                <PhoneIcon size={16} />
                Phone
              </button>
            </div>
            <div className="actions">
              <button
                type="button"
                className="button-small"
                onClick={onUndo}
                disabled={!canUndo}
                title="Undo (⌘Z)"
              >
                <UndoIcon size={16} />
                Undo
              </button>
              <button
                type="button"
                className="button-small"
                onClick={onRedo}
                disabled={!canRedo}
                title="Redo (⌘⇧Z)"
              >
                <RedoIcon size={16} />
                Redo
              </button>
              <button
                type="button"
                className="button-small"
                aria-pressed={selectedId === undefined}
                onClick={() => {
                  setSelectedId(undefined);
                }}
              >
                <CogIcon size={16} />
                Email settings
              </button>
            </div>
          </div>
          <div
            className="designer-canvas"
            style={canvasStyle}
            onClick={() => {
              setSelectedId(undefined);
            }}
          >
            {settings.preheader.trim() === "" ? null : (
              <p className="preheader-preview" title="Inbox preview text">
                <span>Inbox preview:</span> {settings.preheader}
              </p>
            )}
            <div
              className="email-card"
              style={{
                width: isMobile ? 375 : settings.contentWidth,
                background: safeColor(
                  settings.contentBackgroundColor,
                  "#ffffff",
                ),
                borderRadius: settings.contentBorderRadius,
                border:
                  safeColor(settings.contentBorderColor) === ""
                    ? undefined
                    : `1px solid ${safeColor(settings.contentBorderColor)}`,
                paddingTop: settings.contentPadding,
                paddingBottom: settings.contentPadding,
              }}
            >
              {lockedTop === undefined ? null : (
                <LockedPartView part={lockedTop} />
              )}
              <BlockList blocks={design.blocks} container={rootContainer} />
              {lockedBottom === undefined ? null : (
                <LockedPartView part={lockedBottom} />
              )}
            </div>
          </div>
        </div>
        <aside className="designer-right" aria-label="Properties">
          <div className="designer-panel">
            <Inspector
              design={design}
              block={selected}
              onChange={onChange}
              variables={variables}
              onClose={() => {
                setSelectedId(undefined);
              }}
            />
          </div>
        </aside>
      </div>
    </DesignerContext.Provider>
  );
};
