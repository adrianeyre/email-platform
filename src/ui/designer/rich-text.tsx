import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  EraserIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  RedoIcon,
  UndoIcon,
} from "../icons.js";
import { Highlight } from "@tiptap/extension-highlight";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { Mark } from "@tiptap/pm/model";
import { Plugin, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  EditorContent,
  Extension,
  useEditor,
  useEditorState,
  type Editor,
} from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { findFont, fontChoices } from "../../templates/design/fonts.js";
import { swatches } from "./controls.js";

const tokenPattern = /\{\{[^{}]*\}\}/gu;

/**
 * Formatting part of a {{variable}} would split it across tags, such as {{<strong>name}}</strong>, which Handlebars
 * can't read. After every change, a token whose characters are formatted differently takes the formatting that
 * covers most of it.
 */
export const keepTokensWhole = (state: EditorState): Transaction | null => {
  let transaction: Transaction | null = null;
  state.doc.descendants((block, blockPosition) => {
    if (!block.isTextblock) {
      return true;
    }
    const text = block.textBetween(0, block.content.size, undefined, "\ufffc");
    for (const match of text.matchAll(tokenPattern)) {
      const from = blockPosition + 1 + match.index;
      const to = from + match[0].length;
      const runs: { marks: readonly Mark[]; size: number }[] = [];
      state.doc.nodesBetween(from, to, (node, position) => {
        if (node.isText) {
          const size =
            Math.min(to, position + node.nodeSize) - Math.max(from, position);
          runs.push({ marks: node.marks, size });
        }
      });
      const [first] = runs;
      if (
        first === undefined ||
        runs.every((run) => Mark.sameSet(run.marks, first.marks))
      ) {
        continue;
      }
      const widest = runs.reduce((best, run) =>
        run.size > best.size ? run : best,
      );
      transaction ??= state.tr;
      transaction.removeMark(from, to);
      for (const mark of widest.marks) {
        transaction.addMark(from, to, mark);
      }
    }
    return false;
  });
  return transaction;
};

/** Shows {{variables}} and {{#if}} blocks as tokens while editing, and keeps them whole. */
const HandlebarsTokens = Extension.create({
  name: "handlebarsTokens",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _previous, state) =>
          transactions.some((transaction) => transaction.docChanged)
            ? keepTokensWhole(state)
            : null,
        props: {
          decorations: (state) => {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, position) => {
              if (node.isText && node.text !== undefined) {
                for (const match of node.text.matchAll(tokenPattern)) {
                  decorations.push(
                    Decoration.inline(
                      position + match.index,
                      position + match.index + match[0].length,
                      { class: "hb-token" },
                    ),
                  );
                }
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

const isTemplateUrl = (url: string) => /^\{\{[^}]+\}\}/u.test(url.trim());

export const richTextExtensions = [
  StarterKit.configure({
    code: false,
    codeBlock: false,
    horizontalRule: false,
    // A block of text can end in a heading; an empty paragraph after it would be sent too.
    trailingNode: false,
    heading: { levels: [1, 2, 3] },
    link: {
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
      isAllowedUri: (url, { defaultValidate }) =>
        isTemplateUrl(url) || defaultValidate(url),
    },
  }),
  TextStyleKit,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Highlight.configure({ multicolor: true }),
  Subscript,
  Superscript,
  HandlebarsTokens,
];

const readString = (value: unknown): string =>
  typeof value === "string" ? value : "";

const fontSizes = [
  10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48,
];
const lineHeights = ["1", "1.15", "1.3", "1.5", "1.6", "1.8", "2"];

const ToolButton = ({
  label,
  shortcut,
  isActive = false,
  isDisabled = false,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  isActive?: boolean;
  isDisabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    className="tool-button"
    aria-label={label}
    title={shortcut === undefined ? label : `${label} (${shortcut})`}
    aria-pressed={isActive}
    disabled={isDisabled}
    onMouseDown={(event) => {
      event.preventDefault();
    }}
    onClick={onClick}
  >
    {children}
  </button>
);

const ColorMenu = ({
  label,
  icon,
  color,
  onPick,
  onClear,
}: {
  label: string;
  icon: ReactNode;
  color: string;
  onPick: (color: string) => void;
  onClear: () => void;
}) => {
  const [isOpen, setOpen] = useState(false);
  return (
    <span className="tool-menu">
      <button
        type="button"
        className="tool-button color-tool"
        aria-label={label}
        title={label}
        aria-expanded={isOpen}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          setOpen(!isOpen);
        }}
      >
        {icon}
        <span
          className="color-bar"
          style={{ background: color || "transparent" }}
        />
      </button>
      {isOpen ? (
        <div className="tool-popover" role="dialog" aria-label={label}>
          <div className="swatches">
            {swatches.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className="swatch"
                style={{ background: swatch }}
                aria-label={swatch}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  onPick(swatch);
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <div className="tool-popover-row">
            <input
              type="color"
              aria-label={`Custom ${label.toLowerCase()}`}
              value={/^#[0-9a-f]{6}$/iu.test(color) ? color : "#000000"}
              onChange={(event) => {
                onPick(event.target.value);
              }}
            />
            <button
              type="button"
              className="button-small"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
            >
              Remove
            </button>
          </div>
        </div>
      ) : null}
    </span>
  );
};

const LinkMenu = ({
  editor,
  variables,
}: {
  editor: Editor;
  variables: readonly string[];
}) => {
  const [isOpen, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const isActive = editor.isActive("link");
  const apply = () => {
    const trimmed = url.trim();
    if (trimmed === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: trimmed, target: "_blank" })
        .run();
    }
    setOpen(false);
  };
  return (
    <span className="tool-menu">
      <ToolButton
        label={isActive ? "Edit link" : "Add link"}
        shortcut="⌘K"
        isActive={isActive}
        onClick={() => {
          setUrl(readString(editor.getAttributes("link").href));
          setOpen(!isOpen);
        }}
      >
        <LinkIcon size={16} />
      </ToolButton>
      {isOpen ? (
        <div
          className="tool-popover link-popover"
          role="dialog"
          aria-label="Link"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              apply();
            }}
          >
            <label className="control-label" htmlFor="link-url">
              Link address
            </label>
            <input
              id="link-url"
              autoFocus
              className="mono"
              value={url}
              placeholder="https://… or {{url}}"
              onChange={(event) => {
                setUrl(event.target.value);
              }}
            />
            {variables.length === 0 ? null : (
              <div className="chip-row">
                {variables.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="chip"
                    onClick={() => {
                      setUrl(`{{${name}}}`);
                    }}
                  >
                    {`{{${name}}}`}
                  </button>
                ))}
              </div>
            )}
            <div className="tool-popover-row">
              <button type="submit" className="button-small button-primary">
                Apply
              </button>
              {isActive ? (
                <button
                  type="button"
                  className="button-small"
                  onClick={() => {
                    editor
                      .chain()
                      .focus()
                      .extendMarkRange("link")
                      .unsetLink()
                      .run();
                    setOpen(false);
                  }}
                >
                  Remove link
                </button>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}
    </span>
  );
};

const Toolbar = ({
  editor,
  variables,
}: {
  editor: Editor;
  variables: readonly string[];
}) => {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const style = current.getAttributes("textStyle");
      return {
        block: current.isActive("heading", { level: 1 })
          ? "h1"
          : current.isActive("heading", { level: 2 })
            ? "h2"
            : current.isActive("heading", { level: 3 })
              ? "h3"
              : "p",
        isBold: current.isActive("bold"),
        isItalic: current.isActive("italic"),
        isUnderline: current.isActive("underline"),
        isStrike: current.isActive("strike"),
        isSuperscript: current.isActive("superscript"),
        isSubscript: current.isActive("subscript"),
        isBulletList: current.isActive("bulletList"),
        isOrderedList: current.isActive("orderedList"),
        isQuote: current.isActive("blockquote"),
        align:
          (["center", "right", "justify"] as const).find((align) =>
            current.isActive({ textAlign: align }),
          ) ?? "left",
        // The browser writes quotes its own way, so match the stack by its fonts.
        fontFamily: ((raw) => findFont(raw)?.stack ?? raw)(
          readString(style.fontFamily),
        ),
        fontSize: readString(style.fontSize),
        lineHeight: readString(style.lineHeight),
        color: readString(style.color),
        highlight: readString(current.getAttributes("highlight").color),
        canUndo: current.can().undo(),
        canRedo: current.can().redo(),
      };
    },
  });
  const chain = () => editor.chain().focus();
  return (
    <div className="rich-toolbar" role="toolbar" aria-label="Text formatting">
      <select
        aria-label="Text style"
        title="Text style"
        value={state.block}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "p") {
            chain().setParagraph().run();
          } else {
            chain()
              .setHeading({
                level: value === "h1" ? 1 : value === "h2" ? 2 : 3,
              })
              .run();
          }
        }}
      >
        <option value="p">Paragraph</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>
      <select
        aria-label="Font"
        title="Font"
        value={state.fontFamily}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "") {
            chain().unsetFontFamily().run();
          } else {
            chain().setFontFamily(value).run();
          }
        }}
      >
        <option value="">Default font</option>
        {state.fontFamily !== "" &&
        !fontChoices.some((font) => font.stack === state.fontFamily) ? (
          <option value={state.fontFamily}>
            {state.fontFamily.split(",")[0]}
          </option>
        ) : null}
        {fontChoices.map((font) => (
          <option
            key={font.stack}
            value={font.stack}
            style={{ fontFamily: font.stack }}
          >
            {font.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Font size"
        title="Font size"
        className="narrow-select"
        value={state.fontSize}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "") {
            chain().unsetFontSize().run();
          } else {
            chain().setFontSize(value).run();
          }
        }}
      >
        <option value="">Size</option>
        {state.fontSize !== "" &&
        !fontSizes.some((size) => `${String(size)}px` === state.fontSize) ? (
          <option value={state.fontSize}>{state.fontSize}</option>
        ) : null}
        {fontSizes.map((size) => (
          <option key={size} value={`${String(size)}px`}>
            {size}
          </option>
        ))}
      </select>
      <span className="tool-divider" />
      <ToolButton
        label="Bold"
        shortcut="⌘B"
        isActive={state.isBold}
        onClick={() => chain().toggleBold().run()}
      >
        <strong>B</strong>
      </ToolButton>
      <ToolButton
        label="Italic"
        shortcut="⌘I"
        isActive={state.isItalic}
        onClick={() => chain().toggleItalic().run()}
      >
        <em>I</em>
      </ToolButton>
      <ToolButton
        label="Underline"
        shortcut="⌘U"
        isActive={state.isUnderline}
        onClick={() => chain().toggleUnderline().run()}
      >
        <u>U</u>
      </ToolButton>
      <ToolButton
        label="Strikethrough"
        shortcut="⌘⇧S"
        isActive={state.isStrike}
        onClick={() => chain().toggleStrike().run()}
      >
        <s>S</s>
      </ToolButton>
      <ToolButton
        label="Superscript"
        isActive={state.isSuperscript}
        onClick={() => chain().toggleSuperscript().run()}
      >
        x<sup>2</sup>
      </ToolButton>
      <ToolButton
        label="Subscript"
        isActive={state.isSubscript}
        onClick={() => chain().toggleSubscript().run()}
      >
        x<sub>2</sub>
      </ToolButton>
      <ColorMenu
        label="Text colour"
        icon={<span className="color-letter">A</span>}
        color={state.color}
        onPick={(color) => chain().setColor(color).run()}
        onClear={() => chain().unsetColor().run()}
      />
      <ColorMenu
        label="Highlight"
        icon={<span className="color-letter highlight-letter">H</span>}
        color={state.highlight}
        onPick={(color) => chain().setHighlight({ color }).run()}
        onClear={() => chain().unsetHighlight().run()}
      />
      <span className="tool-divider" />
      {(
        [
          ["left", "Align left", <AlignLeftIcon key="l" size={16} />],
          ["center", "Align centre", <AlignCenterIcon key="c" size={16} />],
          ["right", "Align right", <AlignRightIcon key="r" size={16} />],
          ["justify", "Justify", <AlignJustifyIcon key="j" size={16} />],
        ] as const
      ).map(([align, label, icon]) => (
        <ToolButton
          key={align}
          label={label}
          isActive={state.align === align}
          onClick={() => chain().setTextAlign(align).run()}
        >
          <span aria-hidden="true">{icon}</span>
        </ToolButton>
      ))}
      <span className="tool-divider" />
      <ToolButton
        label="Bulleted list"
        isActive={state.isBulletList}
        onClick={() => chain().toggleBulletList().run()}
      >
        <ListIcon size={16} />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        isActive={state.isOrderedList}
        onClick={() => chain().toggleOrderedList().run()}
      >
        <ListOrderedIcon size={16} />
      </ToolButton>
      <ToolButton
        label="Quote"
        isActive={state.isQuote}
        onClick={() => chain().toggleBlockquote().run()}
      >
        <QuoteIcon size={16} />
      </ToolButton>
      <select
        aria-label="Line height"
        title="Line height"
        className="narrow-select"
        value={state.lineHeight}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "") {
            chain().unsetLineHeight().run();
          } else {
            chain().setLineHeight(value).run();
          }
        }}
      >
        <option value="">Line height</option>
        {lineHeights.map((height) => (
          <option key={height} value={height}>
            {height}
          </option>
        ))}
      </select>
      <LinkMenu editor={editor} variables={variables} />
      <span className="tool-divider" />
      <select
        aria-label="Insert a variable"
        title="Insert a variable"
        value=""
        onChange={(event) => {
          const name = event.target.value;
          if (name !== "") {
            chain().insertContent(`{{${name}}}`).run();
          }
        }}
      >
        <option value="">{"{{ }} Variable"}</option>
        {variables.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <ToolButton
        label="Clear formatting"
        onClick={() => chain().unsetAllMarks().clearNodes().run()}
      >
        <EraserIcon size={16} />
      </ToolButton>
      <ToolButton
        label="Undo typing"
        shortcut="⌘Z"
        isDisabled={!state.canUndo}
        onClick={() => chain().undo().run()}
      >
        <UndoIcon size={16} />
      </ToolButton>
      <ToolButton
        label="Redo typing"
        shortcut="⌘⇧Z"
        isDisabled={!state.canRedo}
        onClick={() => chain().redo().run()}
      >
        <RedoIcon size={16} />
      </ToolButton>
    </div>
  );
};

export const RichText = ({
  html,
  onChange,
  onFocus,
  isSelected,
  variables,
  label,
}: {
  html: string;
  onChange: (html: string) => void;
  onFocus: () => void;
  isSelected: boolean;
  variables: readonly string[];
  label: string;
}) => {
  const onChangeRef = useRef(onChange);
  const onFocusRef = useRef(onFocus);
  useEffect(() => {
    onChangeRef.current = onChange;
    onFocusRef.current = onFocus;
  });
  const editor = useEditor({
    extensions: richTextExtensions,
    content: html,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { "aria-label": label, class: "rich-text-content" },
      handleKeyDown: (view, event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "k"
        ) {
          event.preventDefault();
          const button = view.dom
            .closest(".designer-text")
            ?.querySelector<HTMLButtonElement>(
              '[aria-label="Add link"], [aria-label="Edit link"]',
            );
          button?.click();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      onChangeRef.current(current.getHTML());
    },
    onFocus: () => {
      onFocusRef.current();
    },
  });

  useEffect(() => {
    if (!editor.isDestroyed && editor.getHTML() !== html) {
      editor.commands.setContent(html, { emitUpdate: false });
    }
  }, [editor, html]);

  return (
    <div className="designer-text">
      {isSelected ? <Toolbar editor={editor} variables={variables} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
};
