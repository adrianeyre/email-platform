import { useId, useState, type ReactNode } from "react";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  PlusIcon,
  TrashIcon,
} from "../icons.js";
import {
  createSocialLink,
  maxSocialLinks,
  type Align,
  type Block,
  type SocialBlock,
  type SocialLink,
} from "../../templates/design/model.js";
import {
  socialIcons,
  socialIconSvg,
  socialNetworks,
  type SocialColorMode,
  type SocialNetwork,
  type SocialShape,
} from "../../templates/design/social-icons.js";
import {
  ColorField,
  NumberField,
  Section,
  Segmented,
  Toggle,
} from "./controls.js";

const alignOptions: readonly {
  value: Align;
  label: ReactNode;
  title: string;
}[] = [
  { value: "left", label: <AlignLeftIcon size={16} />, title: "Left" },
  { value: "center", label: <AlignCenterIcon size={16} />, title: "Centre" },
  { value: "right", label: <AlignRightIcon size={16} />, title: "Right" },
];

const shapeOptions: readonly { value: SocialShape; label: string }[] = [
  { value: "circle", label: "Circle" },
  { value: "rounded", label: "Rounded" },
  { value: "square", label: "Square" },
  { value: "plain", label: "Plain" },
];

const colorOptions: readonly { value: SocialColorMode; label: string }[] = [
  { value: "brand", label: "Brand" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "custom", label: "Custom" },
];

const placeholderFor = (network: SocialNetwork) =>
  network === "email"
    ? "mailto:hello@example.com"
    : network === "website"
      ? "https://example.com"
      : `Your ${socialIcons[network].label} address`;

/** One network: its icon, its address, and buttons to move or remove it. */
const LinkRow = ({
  block,
  link,
  index,
  onChange,
  onMove,
  onRemove,
}: {
  block: SocialBlock;
  link: SocialLink;
  index: number;
  onChange: (url: string) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) => {
  const id = useId();
  const label = socialIcons[link.network].label;
  return (
    <li className="social-link">
      <span
        className="social-link-icon"
        aria-hidden="true"
        dangerouslySetInnerHTML={{
          __html: socialIconSvg(link.network, block, 24),
        }}
      />
      <label className="control-label social-link-name" htmlFor={id}>
        {label}
      </label>
      <span className="social-link-actions">
        <button
          type="button"
          className="icon-button"
          aria-label={`Move ${label} up`}
          disabled={index === 0}
          onClick={() => {
            onMove(-1);
          }}
        >
          <ArrowUpIcon size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Move ${label} down`}
          disabled={index === block.links.length - 1}
          onClick={() => {
            onMove(1);
          }}
        >
          <ArrowDownIcon size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
        >
          <TrashIcon size={16} />
        </button>
      </span>
      <input
        id={id}
        className="mono social-link-url"
        value={link.url}
        placeholder={placeholderFor(link.network)}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </li>
  );
};

/** The Socials block's panel: which networks, their addresses and how the icons look. */
export const SocialSettings = ({
  block,
  update,
}: {
  block: SocialBlock;
  update: (change: Partial<Block>, key?: string) => void;
}) => {
  const pickerId = useId();
  const unused = socialNetworks.filter(
    (network) => !block.links.some((link) => link.network === network),
  );
  const [choice, setChoice] = useState<SocialNetwork | "">("");
  const toAdd: SocialNetwork | undefined =
    choice !== "" && unused.includes(choice) ? choice : unused[0];
  const setLinks = (links: SocialLink[], key?: string) => {
    update({ links }, key);
  };
  const isFull = block.links.length >= maxSocialLinks;
  return (
    <>
      <Section title="Networks">
        {block.links.length === 0 ? (
          <p className="muted small">No networks yet. Add one below.</p>
        ) : (
          <ul className="social-links">
            {block.links.map((link, index) => (
              <LinkRow
                key={link.id}
                block={block}
                link={link}
                index={index}
                onChange={(url) => {
                  setLinks(
                    block.links.map((item) =>
                      item.id === link.id ? { ...item, url } : item,
                    ),
                    `social-url:${link.id}`,
                  );
                }}
                onMove={(delta) => {
                  const next = [...block.links];
                  const [moved] = next.splice(index, 1);
                  if (moved !== undefined) {
                    next.splice(index + delta, 0, moved);
                    setLinks(next);
                  }
                }}
                onRemove={() => {
                  setLinks(block.links.filter((item) => item.id !== link.id));
                }}
              />
            ))}
          </ul>
        )}
        <p className="field-hint">
          Handlebars works in an address, such as {"{{profileUrl}}"}. An icon
          with no address is left out of the email.
        </p>
        {toAdd === undefined || isFull ? null : (
          <div className="control">
            <label className="control-label" htmlFor={pickerId}>
              Add a network
            </label>
            <div className="social-add">
              <select
                id={pickerId}
                value={toAdd}
                onChange={(event) => {
                  const value = event.target.value;
                  setChoice(
                    socialNetworks.find((network) => network === value) ?? "",
                  );
                }}
              >
                {unused.map((network) => (
                  <option key={network} value={network}>
                    {socialIcons[network].label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button-small"
                onClick={() => {
                  setLinks([...block.links, createSocialLink(toAdd)]);
                  setChoice("");
                }}
              >
                <PlusIcon size={16} />
                Add
              </button>
            </div>
          </div>
        )}
      </Section>
      <Section title="Icons">
        <Segmented
          label="Shape"
          value={block.shape}
          options={shapeOptions}
          onChange={(shape) => {
            update({ shape });
          }}
        />
        <Segmented
          label="Colour"
          value={block.colorMode}
          options={colorOptions}
          onChange={(colorMode) => {
            update({ colorMode });
          }}
        />
        {block.colorMode === "custom" ? (
          <ColorField
            label="Icon colour"
            value={block.customColor}
            onChange={(customColor) => {
              update({ customColor }, "customColor");
            }}
          />
        ) : null}
        <NumberField
          label="Size"
          value={block.iconSize}
          min={16}
          max={64}
          onChange={(iconSize) => {
            update({ iconSize }, "iconSize");
          }}
        />
        <NumberField
          label="Space between"
          value={block.gap}
          min={0}
          max={48}
          onChange={(gap) => {
            update({ gap }, "gap");
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
          label="Show names"
          hint="The network's name beside each icon"
          value={block.showLabels}
          onChange={(showLabels) => {
            update({ showLabels });
          }}
        />
      </Section>
    </>
  );
};
