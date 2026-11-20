import { useState, type ReactNode } from "react";
import {
  applyAppearance,
  colourModes,
  loadAppearance,
  storeAppearance,
  themes,
  type Appearance,
  type ColourMode,
} from "./appearance.js";
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "./icons.js";
import { PageHeader, StatusLine } from "./ui-parts.js";

const modeDetails: Record<
  ColourMode,
  { label: string; hint: string; icon: ReactNode }
> = {
  system: {
    label: "System",
    hint: "Follows your device's light or dark setting",
    icon: <MonitorIcon size={22} />,
  },
  light: { label: "Light", hint: "Always light", icon: <SunIcon size={22} /> },
  dark: { label: "Dark", hint: "Always dark", icon: <MoonIcon size={22} /> },
};

export const AppearancePage = () => {
  const [appearance, setAppearance] = useState<Appearance>(loadAppearance);
  const [status, setStatus] = useState("");
  const choose = (change: Partial<Appearance>, message: string) => {
    const next = { ...appearance, ...change };
    setAppearance(next);
    applyAppearance(next);
    storeAppearance(next);
    setStatus(message);
  };
  return (
    <>
      <PageHeader
        title="Settings"
        description="How Email Platform looks in this browser. Every theme meets WCAG 2.2 AA contrast in light and dark."
      />
      <fieldset className="choice-group">
        <legend>Mode</legend>
        <div className="choice-grid choice-grid-modes">
          {colourModes.map((mode) => {
            const details = modeDetails[mode];
            return (
              <label key={mode} className="choice-card">
                <input
                  type="radio"
                  name="colour-mode"
                  value={mode}
                  checked={appearance.colourMode === mode}
                  onChange={() => {
                    choose(
                      { colourMode: mode },
                      `${details.label} mode chosen.`,
                    );
                  }}
                />
                <span className="choice-icon">{details.icon}</span>
                <span className="choice-text">
                  <span className="choice-label">{details.label}</span>
                  <span className="choice-hint">{details.hint}</span>
                </span>
                <span className="choice-check" aria-hidden="true">
                  <CheckIcon />
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="choice-group">
        <legend>Theme</legend>
        <div className="choice-grid choice-grid-themes">
          {themes.map((theme) => (
            <label
              key={theme.name}
              className="choice-card theme-card"
              data-theme-preview={theme.name}
            >
              <input
                type="radio"
                name="theme"
                value={theme.name}
                checked={appearance.themeName === theme.name}
                onChange={() => {
                  choose(
                    { themeName: theme.name },
                    `${theme.label} theme chosen.`,
                  );
                }}
              />
              <span className="theme-swatches" aria-hidden="true">
                <span
                  style={{
                    background: theme.light.page,
                    borderColor: theme.light.border,
                  }}
                >
                  <span style={{ background: theme.light.accent }} />
                </span>
                <span
                  style={{
                    background: theme.dark.page,
                    borderColor: theme.dark.border,
                  }}
                >
                  <span style={{ background: theme.dark.accent }} />
                </span>
              </span>
              <span className="choice-text">
                <span className="choice-label">{theme.label}</span>
                <span className="choice-hint">{theme.description}</span>
              </span>
              <span className="choice-check" aria-hidden="true">
                <CheckIcon />
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="muted small">
        Saved in this browser only. Clearing this site&apos;s data goes back to
        System and Sky.
      </p>
      <StatusLine message={status} />
    </>
  );
};
