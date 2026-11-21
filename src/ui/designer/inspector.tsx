import type { ReactNode } from "react";
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon } from "../icons.js";
import { CodeEditor } from "../code-editor.js";
import {
  setColumnCount,
  updateBlock,
  type Align,
  type Block,
  type Design,
  type DesignSettings,
} from "../../templates/design/model.js";
import {
  ColorField,
  FontSelect,
  NumberField,
  Row,
  Section,
  Segmented,
  SpacingField,
  TextInput,
  Toggle,
} from "./controls.js";
import type { ChangeDesign } from "./designer.js";
import { SocialSettings } from "./social-settings.js";

const alignOptions: readonly {
  value: Align;
  label: ReactNode;
  title: string;
}[] = [
  { value: "left", label: <AlignLeftIcon size={16} />, title: "Left" },
  { value: "center", label: <AlignCenterIcon size={16} />, title: "Centre" },
  { value: "right", label: <AlignRightIcon size={16} />, title: "Right" },
];

const VariableChips = ({
  variables,
  onPick,
}: {
  variables: readonly string[];
  onPick: (token: string) => void;
}) =>
  variables.length === 0 ? null : (
    <div className="chip-row" aria-label="Insert a variable">
      {variables.map((name) => (
        <button
          key={name}
          type="button"
          className="chip"
          onClick={() => {
            onPick(`{{${name}}}`);
          }}
        >
          {`{{${name}}}`}
        </button>
      ))}
    </div>
  );

const EmailSettings = ({
  settings,
  onChange,
}: {
  settings: DesignSettings;
  onChange: (change: Partial<DesignSettings>, key: string) => void;
}) => (
  <>
    <h3 className="panel-title">Email settings</h3>
    <p className="muted small">
      Select a block on the email to style it. These settings apply to the whole
      email.
    </p>
    <Section title="Inbox">
      <TextInput
        label="Preview text"
        value={settings.preheader}
        hint="Shown after the subject in most inboxes, hidden in the email. Variables work."
        onChange={(preheader) => {
          onChange({ preheader }, "preheader");
        }}
      />
    </Section>
    <Section title="Typography">
      <FontSelect
        label="Font"
        value={settings.fontFamily}
        onChange={(fontFamily) => {
          onChange({ fontFamily }, "fontFamily");
        }}
      />
      <Row>
        <NumberField
          label="Text size"
          value={settings.fontSize}
          min={10}
          max={28}
          onChange={(fontSize) => {
            onChange({ fontSize }, "fontSize");
          }}
        />
        <NumberField
          label="Line height"
          value={settings.lineHeight}
          min={1}
          max={2.4}
          step={0.05}
          unit=""
          onChange={(lineHeight) => {
            onChange({ lineHeight }, "lineHeight");
          }}
        />
      </Row>
      <ColorField
        label="Text colour"
        value={settings.textColor}
        onChange={(textColor) => {
          onChange({ textColor }, "textColor");
        }}
      />
      <ColorField
        label="Heading colour"
        value={settings.headingColor}
        onChange={(headingColor) => {
          onChange({ headingColor }, "headingColor");
        }}
      />
      <ColorField
        label="Link colour"
        value={settings.linkColor}
        onChange={(linkColor) => {
          onChange({ linkColor }, "linkColor");
        }}
      />
    </Section>
    <Section title="Layout">
      <NumberField
        label="Content width"
        value={settings.contentWidth}
        min={320}
        max={900}
        step={10}
        onChange={(contentWidth) => {
          onChange({ contentWidth }, "contentWidth");
        }}
      />
      <NumberField
        label="Space above and below the content"
        value={settings.contentPadding}
        min={0}
        max={80}
        onChange={(contentPadding) => {
          onChange({ contentPadding }, "contentPadding");
        }}
      />
      <NumberField
        label="Corner rounding"
        value={settings.contentBorderRadius}
        min={0}
        max={40}
        onChange={(contentBorderRadius) => {
          onChange({ contentBorderRadius }, "contentBorderRadius");
        }}
      />
    </Section>
    <Section title="Colours">
      <ColorField
        label="Page background"
        value={settings.backgroundColor}
        onChange={(backgroundColor) => {
          onChange({ backgroundColor }, "backgroundColor");
        }}
      />
      <ColorField
        label="Content background"
        value={settings.contentBackgroundColor}
        onChange={(contentBackgroundColor) => {
          onChange({ contentBackgroundColor }, "contentBackgroundColor");
        }}
      />
      <ColorField
        label="Content border"
        value={settings.contentBorderColor}
        canBeEmpty
        onChange={(contentBorderColor) => {
          onChange({ contentBorderColor }, "contentBorderColor");
        }}
      />
    </Section>
  </>
);

const columnLayouts: Record<number, readonly (readonly number[])[]> = {
  2: [
    [50, 50],
    [33.33, 66.67],
    [66.67, 33.33],
    [25, 75],
    [75, 25],
  ],
  3: [
    [33.33, 33.33, 33.34],
    [25, 50, 25],
    [50, 25, 25],
  ],
  4: [[25, 25, 25, 25]],
};

const BlockSettings = ({
  block,
  update,
  variables,
}: {
  block: Block;
  update: (change: Partial<Block>, key?: string) => void;
  variables: readonly string[];
}) => {
  switch (block.type) {
    case "text":
      return (
        <p className="muted small">
          Type straight onto the email. The toolbar above the text sets the
          style, font, size, colour, alignment, lists and links. Select text
          first to format part of it.
        </p>
      );
    case "button":
      return (
        <>
          <Section title="Button">
            <TextInput
              label="Label"
              value={block.label}
              onChange={(label) => {
                update({ label }, "label");
              }}
            />
            <TextInput
              label="Link"
              value={block.url}
              isMono
              placeholder="https://… or {{url}}"
              onChange={(url) => {
                update({ url }, "url");
              }}
            />
            <VariableChips
              variables={variables}
              onPick={(url) => {
                update({ url });
              }}
            />
            <Segmented
              label="Alignment"
              value={block.align}
              options={alignOptions}
              onChange={(align) => {
                update({ align });
              }}
            />
            <Toggle
              label="Full width"
              value={block.isFullWidth}
              onChange={(isFullWidth) => {
                update({ isFullWidth });
              }}
            />
          </Section>
          <Section title="Text">
            <FontSelect
              label="Font"
              value={block.fontFamily}
              defaultLabel="Email font"
              onChange={(fontFamily) => {
                update({ fontFamily });
              }}
            />
            <NumberField
              label="Size"
              value={block.fontSize}
              min={10}
              max={40}
              onChange={(fontSize) => {
                update({ fontSize }, "fontSize");
              }}
            />
            <div className="control">
              <span className="control-label">Style</span>
              <div className="segmented">
                <button
                  type="button"
                  aria-pressed={block.isBold}
                  aria-label="Bold"
                  onClick={() => {
                    update({ isBold: !block.isBold });
                  }}
                >
                  <strong>B</strong>
                </button>
                <button
                  type="button"
                  aria-pressed={block.isItalic}
                  aria-label="Italic"
                  onClick={() => {
                    update({ isItalic: !block.isItalic });
                  }}
                >
                  <em>I</em>
                </button>
              </div>
            </div>
            <NumberField
              label="Letter spacing"
              value={block.letterSpacing}
              min={-2}
              max={10}
              step={0.5}
              onChange={(letterSpacing) => {
                update({ letterSpacing }, "letterSpacing");
              }}
            />
            <ColorField
              label="Text colour"
              value={block.textColor}
              onChange={(textColor) => {
                update({ textColor }, "textColor");
              }}
            />
          </Section>
          <Section title="Shape">
            <ColorField
              label="Button colour"
              value={block.buttonColor}
              onChange={(buttonColor) => {
                update({ buttonColor }, "buttonColor");
              }}
            />
            <NumberField
              label="Corner rounding"
              value={block.borderRadius}
              min={0}
              max={50}
              onChange={(borderRadius) => {
                update({ borderRadius }, "borderRadius");
              }}
            />
            <Row>
              <NumberField
                label="Padding across"
                value={block.innerPaddingX}
                min={0}
                max={80}
                hasSlider={false}
                onChange={(innerPaddingX) => {
                  update({ innerPaddingX }, "innerPaddingX");
                }}
              />
              <NumberField
                label="Padding down"
                value={block.innerPaddingY}
                min={0}
                max={40}
                hasSlider={false}
                onChange={(innerPaddingY) => {
                  update({ innerPaddingY }, "innerPaddingY");
                }}
              />
            </Row>
            <NumberField
              label="Border"
              value={block.borderWidth}
              min={0}
              max={8}
              onChange={(borderWidth) => {
                update({ borderWidth }, "borderWidth");
              }}
            />
            {block.borderWidth === 0 ? null : (
              <ColorField
                label="Border colour"
                value={block.borderColor}
                onChange={(borderColor) => {
                  update({ borderColor }, "borderColor");
                }}
              />
            )}
          </Section>
        </>
      );
    case "image":
      return (
        <Section title="Image">
          <TextInput
            label="Image address"
            value={block.src}
            isMono
            placeholder="https://example.com/logo.png"
            hint="A public https:// address. Mail apps load images from the web."
            onChange={(src) => {
              update({ src }, "src");
            }}
          />
          <TextInput
            label="Description (alt text)"
            value={block.alt}
            hint="Read aloud by screen readers and shown when images are blocked."
            onChange={(alt) => {
              update({ alt }, "alt");
            }}
          />
          <TextInput
            label="Link (optional)"
            value={block.href}
            isMono
            placeholder="https://…"
            onChange={(href) => {
              update({ href }, "href");
            }}
          />
          <NumberField
            label="Width"
            value={block.widthPercent}
            min={10}
            max={100}
            unit="%"
            onChange={(widthPercent) => {
              update({ widthPercent }, "widthPercent");
            }}
          />
          <Segmented
            label="Alignment"
            value={block.align}
            options={alignOptions}
            onChange={(align) => {
              update({ align });
            }}
          />
          <NumberField
            label="Corner rounding"
            value={block.borderRadius}
            min={0}
            max={200}
            onChange={(borderRadius) => {
              update({ borderRadius }, "borderRadius");
            }}
          />
        </Section>
      );
    case "divider":
      return (
        <Section title="Divider">
          <ColorField
            label="Colour"
            value={block.color}
            onChange={(color) => {
              update({ color }, "color");
            }}
          />
          <NumberField
            label="Thickness"
            value={block.thickness}
            min={1}
            max={12}
            onChange={(thickness) => {
              update({ thickness }, "thickness");
            }}
          />
          <Segmented
            label="Line"
            value={block.style}
            options={[
              { value: "solid", label: "Solid" },
              { value: "dashed", label: "Dashed" },
              { value: "dotted", label: "Dotted" },
            ]}
            onChange={(style) => {
              update({ style });
            }}
          />
          <NumberField
            label="Width"
            value={block.widthPercent}
            min={10}
            max={100}
            unit="%"
            onChange={(widthPercent) => {
              update({ widthPercent }, "widthPercent");
            }}
          />
          <Segmented
            label="Alignment"
            value={block.align}
            options={alignOptions}
            onChange={(align) => {
              update({ align });
            }}
          />
        </Section>
      );
    case "spacer":
      return (
        <Section title="Spacer">
          <NumberField
            label="Height"
            value={block.height}
            min={4}
            max={200}
            onChange={(height) => {
              update({ height }, "height");
            }}
          />
        </Section>
      );
    case "social":
      return <SocialSettings block={block} update={update} />;
    case "html":
      return (
        <Section title="HTML">
          <p className="muted small">
            Written into the email as it is. Use tables and inline styles for
            the widest mail app support.
          </p>
          <CodeEditor
            label="Custom HTML"
            value={block.html}
            onChange={(html) => {
              update({ html }, "html");
            }}
          />
        </Section>
      );
    case "columns": {
      const count = block.columns.length;
      return (
        <Section title="Columns">
          <Segmented
            label="Number of columns"
            value={String(count)}
            options={[
              { value: "2", label: "2" },
              { value: "3", label: "3" },
              { value: "4", label: "4" },
            ]}
            onChange={(value) => {
              const next = setColumnCount(block, Number(value));
              update({ columns: next.columns });
            }}
          />
          <div className="control">
            <span className="control-label">Widths</span>
            <div className="layout-options">
              {(columnLayouts[count] ?? []).map((widths) => (
                <button
                  key={widths.join("-")}
                  type="button"
                  className="layout-option"
                  aria-label={widths
                    .map((width) => `${String(Math.round(width))}%`)
                    .join(" / ")}
                  aria-pressed={block.columns.every(
                    (column, index) =>
                      Math.round(column.widthPercent) ===
                      Math.round(widths[index] ?? 0),
                  )}
                  onClick={() => {
                    update({
                      columns: block.columns.map((column, index) => ({
                        ...column,
                        widthPercent: widths[index] ?? column.widthPercent,
                      })),
                    });
                  }}
                >
                  {widths.map((width, index) => (
                    <span key={index} style={{ flexGrow: width }} />
                  ))}
                </button>
              ))}
            </div>
          </div>
          <NumberField
            label="Gap"
            value={block.gap}
            min={0}
            max={60}
            onChange={(gap) => {
              update({ gap }, "gap");
            }}
          />
          <Segmented
            label="Vertical alignment"
            value={block.verticalAlign}
            options={[
              { value: "top", label: "Top" },
              { value: "middle", label: "Middle" },
              { value: "bottom", label: "Bottom" },
            ]}
            onChange={(verticalAlign) => {
              update({ verticalAlign });
            }}
          />
          <Toggle
            label="Stack on phones"
            value={block.stackOnMobile}
            onChange={(stackOnMobile) => {
              update({ stackOnMobile });
            }}
          />
        </Section>
      );
    }
  }
};

export const Inspector = ({
  design,
  block,
  onChange,
  variables,
  onClose,
}: {
  design: Design;
  block: Block | undefined;
  onChange: ChangeDesign;
  variables: readonly string[];
  onClose: () => void;
}) => {
  if (block === undefined) {
    return (
      <EmailSettings
        settings={design.settings}
        onChange={(change, key) => {
          onChange(
            { ...design, settings: { ...design.settings, ...change } },
            `settings:${key}`,
          );
        }}
      />
    );
  }
  const update = (change: Partial<Block>, key?: string) => {
    onChange(
      updateBlock(design, block.id, change),
      key === undefined ? undefined : `${block.id}:${key}`,
    );
  };
  return (
    <>
      <div className="inspector-heading">
        <h3 className="panel-title">
          {block.type === "html"
            ? "HTML"
            : block.type === "social"
              ? "Socials"
              : `${block.type.charAt(0).toUpperCase()}${block.type.slice(1)}`}
        </h3>
        <button type="button" className="button-small" onClick={onClose}>
          Done
        </button>
      </div>
      <BlockSettings block={block} update={update} variables={variables} />
      <Section title="Spacing and box" isOpenAtStart={block.type === "spacer"}>
        <SpacingField
          label="Space around"
          value={block.padding}
          onChange={(padding) => {
            update({ padding }, "padding");
          }}
        />
        <ColorField
          label="Background"
          value={block.backgroundColor}
          canBeEmpty
          onChange={(backgroundColor) => {
            update({ backgroundColor }, "backgroundColor");
          }}
        />
        <NumberField
          label="Padding inside the box"
          value={block.boxPadding}
          min={0}
          max={60}
          onChange={(boxPadding) => {
            update({ boxPadding }, "boxPadding");
          }}
        />
        <NumberField
          label="Border"
          value={block.boxBorderWidth}
          min={0}
          max={10}
          onChange={(boxBorderWidth) => {
            update({ boxBorderWidth }, "boxBorderWidth");
          }}
        />
        {block.boxBorderWidth === 0 ? null : (
          <>
            <Segmented
              label="Border on"
              value={block.boxBorderSide}
              options={[
                { value: "all", label: "All sides" },
                { value: "left", label: "Left only" },
              ]}
              onChange={(boxBorderSide) => {
                update({ boxBorderSide });
              }}
            />
            <ColorField
              label="Border colour"
              value={block.boxBorderColor}
              onChange={(boxBorderColor) => {
                update({ boxBorderColor }, "boxBorderColor");
              }}
            />
          </>
        )}
        <NumberField
          label="Corner rounding"
          value={block.boxBorderRadius}
          min={0}
          max={40}
          onChange={(boxBorderRadius) => {
            update({ boxBorderRadius }, "boxBorderRadius");
          }}
        />
      </Section>
      <Section
        title="Visibility"
        isOpenAtStart={block.showIf !== "" || block.hideOnMobile}
      >
        <TextInput
          label="Show only if this variable is set"
          value={block.showIf}
          isMono
          placeholder="variableName"
          hint="A variable name such as isVip or user.isVip; the block is wrapped in {{#if …}}. Anything else is left out. Leave empty to always show it."
          onChange={(showIf) => {
            update({ showIf: showIf.replaceAll(/[{}#]/gu, "") }, "showIf");
          }}
        />
        <VariableChips
          variables={variables}
          onPick={(token) => {
            update({ showIf: token.slice(2, -2) });
          }}
        />
        <Toggle
          label="Hide on phones"
          value={block.hideOnMobile}
          onChange={(hideOnMobile) => {
            update({ hideOnMobile });
          }}
        />
      </Section>
    </>
  );
};
