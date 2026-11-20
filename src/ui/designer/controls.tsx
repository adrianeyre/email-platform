import { CloseIcon } from "../icons.js";
import { useId, useState, type ReactNode } from "react";
import { fontChoices } from "../../templates/design/fonts.js";
import type { Spacing } from "../../templates/design/model.js";

export const swatches = [
  "#111827",
  "#374151",
  "#6b7280",
  "#d1d5db",
  "#ffffff",
  "#dc2626",
  "#ea580c",
  "#f59e0b",
  "#16a34a",
  "#0d9488",
  "#2563eb",
  "#7c3aed",
  "#db2777",
] as const;

const isHex = (value: string) => /^#[0-9a-f]{6}$/iu.test(value);

/** Expands #abc to #aabbcc, since a colour input only takes the long form. */
const toLongHex = (value: string): string => {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/iu.exec(value);
  return short === null
    ? value
    : `#${short
        .slice(1)
        .map((digit) => digit.repeat(2))
        .join("")}`;
};

export const Section = ({
  title,
  children,
  isOpenAtStart = true,
}: {
  title: string;
  children: ReactNode;
  isOpenAtStart?: boolean;
}) => (
  <details className="inspector-section" open={isOpenAtStart}>
    <summary>{title}</summary>
    <div className="inspector-section-body">{children}</div>
  </details>
);

export const Row = ({ children }: { children: ReactNode }) => (
  <div className="inspector-row">{children}</div>
);

export const ColorField = ({
  label,
  value,
  onChange,
  canBeEmpty = false,
  emptyLabel = "None",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  canBeEmpty?: boolean;
  emptyLabel?: string;
}) => {
  const id = useId();
  const long = toLongHex(value);
  return (
    <div className="control">
      <label className="control-label" htmlFor={id}>
        {label}
      </label>
      <div className="color-field">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={isHex(long) ? long : "#ffffff"}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <input
          id={id}
          className="color-text"
          value={value}
          placeholder={canBeEmpty ? emptyLabel : "#000000"}
          spellCheck={false}
          onChange={(event) => {
            onChange(event.target.value.trim());
          }}
        />
        {canBeEmpty && value !== "" ? (
          <button
            type="button"
            className="icon-button"
            aria-label={`Clear ${label}`}
            title="Clear"
            onClick={() => {
              onChange("");
            }}
          >
            <CloseIcon size={16} />
          </button>
        ) : null}
      </div>
      <div className="swatches" role="group" aria-label={`${label} swatches`}>
        {swatches.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className="swatch"
            style={{ background: swatch }}
            aria-label={swatch}
            aria-pressed={value.toLowerCase() === swatch}
            onClick={() => {
              onChange(swatch);
            }}
          />
        ))}
      </div>
    </div>
  );
};

export const NumberField = ({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = "px",
  hasSlider = true,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hasSlider?: boolean;
}) => {
  const id = useId();
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  return (
    <div className="control">
      <label className="control-label" htmlFor={id}>
        {label}
      </label>
      <div className="number-field">
        {hasSlider ? (
          <input
            type="range"
            aria-label={`${label} slider`}
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => {
              onChange(Number(event.target.value));
            }}
          />
        ) : null}
        <span className="number-input">
          <input
            id={id}
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) {
                onChange(clamp(next));
              }
            }}
          />
          {unit === "" ? null : <span className="unit">{unit}</span>}
        </span>
      </div>
    </div>
  );
};

export const TextInput = ({
  label,
  value,
  onChange,
  placeholder,
  hint,
  isMono = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  isMono?: boolean;
}) => {
  const id = useId();
  return (
    <div className="control">
      <label className="control-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={isMono ? "mono" : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hint === undefined ? null : <span className="field-hint">{hint}</span>}
    </div>
  );
};

export const Segmented = <T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
}) => (
  <div className="control">
    <span className="control-label">{label}</span>
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          aria-label={option.title}
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  </div>
);

export const Toggle = ({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) => (
  <label className="toggle">
    <input
      type="checkbox"
      role="switch"
      checked={value}
      onChange={(event) => {
        onChange(event.target.checked);
      }}
    />
    <span className="toggle-track" aria-hidden="true" />
    <span>
      {label}
      {hint === undefined ? null : (
        <span className="field-hint toggle-hint">{hint}</span>
      )}
    </span>
  </label>
);

export const FontSelect = ({
  label,
  value,
  onChange,
  defaultLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Offers an empty "inherit" choice with this label. */
  defaultLabel?: string;
}) => {
  const id = useId();
  const isKnown = fontChoices.some((font) => font.stack === value);
  return (
    <div className="control">
      <label className="control-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        style={{ fontFamily: value || undefined }}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {defaultLabel === undefined ? null : (
          <option value="">{defaultLabel}</option>
        )}
        {isKnown || value === "" ? null : (
          <option value={value}>{value}</option>
        )}
        <optgroup label="Safe in every mail app">
          {fontChoices
            .filter((font) => font.googleFamily === undefined)
            .map((font) => (
              <option
                key={font.stack}
                value={font.stack}
                style={{ fontFamily: font.stack }}
              >
                {font.label}
              </option>
            ))}
        </optgroup>
        <optgroup label="Web fonts (fall back where unsupported)">
          {fontChoices
            .filter((font) => font.googleFamily !== undefined)
            .map((font) => (
              <option
                key={font.stack}
                value={font.stack}
                style={{ fontFamily: font.stack }}
              >
                {font.label}
              </option>
            ))}
        </optgroup>
      </select>
    </div>
  );
};

const sides = ["top", "right", "bottom", "left"] as const;

export const SpacingField = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Spacing;
  onChange: (value: Spacing) => void;
}) => {
  const isUniform = sides.every((side) => value[side] === value.top);
  const [isLinked, setLinked] = useState(isUniform);
  return (
    <div className="control">
      <span className="control-label spacing-label">
        {label}
        <button
          type="button"
          className="link-button"
          aria-pressed={isLinked}
          onClick={() => {
            setLinked(!isLinked);
          }}
        >
          {isLinked ? "Set each side" : "Same on all sides"}
        </button>
      </span>
      {isLinked ? (
        <NumberField
          label="All sides"
          value={value.top}
          min={0}
          max={120}
          onChange={(next) => {
            onChange({ top: next, right: next, bottom: next, left: next });
          }}
        />
      ) : (
        <div className="spacing-grid">
          {sides.map((side) => (
            <NumberField
              key={side}
              label={`${side.charAt(0).toUpperCase()}${side.slice(1)}`}
              value={value[side]}
              min={0}
              max={200}
              hasSlider={false}
              onChange={(next) => {
                onChange({ ...value, [side]: next });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};
