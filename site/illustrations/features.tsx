import { Moon, Sun } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import {
  socialIconSvg,
  socialNetworks,
} from "../../src/templates/design/social-icons.ts";
import {
  Badge,
  Bar,
  Field,
  Icon,
  Roll,
  Segmented,
  Stage,
  States,
  Text,
  Window,
  type Act,
} from "./kit.ts";
import type { SceneProps } from "./main.tsx";
import "./look.css";
import "./features.css";

// The features grid (references/bento.md), one Stage per tile picture. The
// tile copy is page HTML in site/index.html; these are only the pictures.
//
//   Tile       Span   Kind        The one thing                    Moves (once, in view)
//   Logs       2 × 1  Hero UI     the send log, one row arriving   Queued rolls to Sent
//   Retries    1 × 1  Stat        "3" retries (page HTML)          none
//   Preview    1 × 1  Component   the Light / Dark switch          flips to Dark
//   Socials    1 × 1  Collection  the 27 built-in icons, bleeding  none
//   Slug       1 × 1  Component   the slug field                   Unique appears
//
// One window in the grid (the log's). No real string repeats between tiles.

const STEP = 110;
const LEAD = 450;

interface Beat {
  on: boolean;
}
const before: Beat = { on: false };
const after: Beat = { on: true };
const beat = (index: number) => async (a: Act<Beat>) => {
  await a.wait(LEAD + index * STEP);
  await a.set({ on: true });
};

/** The tile owns the crop: a bleeding Stage matches its slot's width, at 1:1. */
function usePictureWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const node = ref.current?.parentElement;
    if (!node) return;
    const measure = () => {
      setWidth(Math.max(1, Math.round(node.getBoundingClientRect().width)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, width] as const;
}

/* ---------------- Logs (hero) ---------------- */

const LOG_ROWS = [
  { to: 54, subject: 120, time: 36 },
  { real: "sam" as const },
  { to: 70, subject: 96, time: 36 },
  { to: 62, subject: 132, time: 36 },
  { to: 48, subject: 110, time: 36 },
];

export function Logs({ theme }: SceneProps) {
  const [ref, width] = usePictureWidth(760);
  const wide = width >= 560;
  return (
    <div ref={ref} className="ef-fit">
      <Stage<Beat>
        theme={theme}
        width={width}
        height={wide ? 270 : 250}
        initial={before}
        poster={after}
        play="once"
        script={beat(0)}
        className={`ep-look ef ef-logs${wide ? "" : " ef-logs--narrow"}`}
      >
        {(s) => (
          <Window title="Logs" className="ef-window" body={{ "data-crop": "" }}>
            <div className="ef-table">
              <div className="ef-row ef-row--head">
                <span>Status</span>
                <span>To</span>
                {wide ? <span>Subject</span> : null}
                {wide ? <span>When</span> : null}
              </div>
              <div className="ef-row ef-row--new" data-on={s.on || undefined}>
                <span>
                  <States
                    value={s.on ? "sent" : "queued"}
                    align="start"
                    states={{
                      queued: (
                        <Badge tone="neutral" dot>
                          Queued
                        </Badge>
                      ),
                      sent: (
                        <Badge
                          tone="success"
                          icon={<Icon name="check" size={12} />}
                        >
                          Sent
                        </Badge>
                      ),
                    }}
                  />
                </span>
                <Text className="ef-cell ef-cell--strong">ada@example.com</Text>
                {wide ? (
                  <Text className="ef-cell">Reset your password</Text>
                ) : null}
                {wide ? (
                  <span className="ef-cell ef-cell--faint">
                    <Roll>{s.on ? "Just now" : "Sending"}</Roll>
                  </span>
                ) : null}
              </div>
              {LOG_ROWS.map((row, index) =>
                "real" in row ? (
                  <div key={index} className="ef-row">
                    <span>
                      <Badge tone="danger" dot>
                        Failed
                      </Badge>
                    </span>
                    <Text className="ef-cell ef-cell--strong">sam@example</Text>
                    {wide ? (
                      <Text className="ef-cell">550 Mailbox not found</Text>
                    ) : null}
                    {wide ? (
                      <Text className="ef-cell ef-cell--faint">10:02</Text>
                    ) : null}
                  </div>
                ) : (
                  <div key={index} className="ef-row">
                    <span>
                      <Bar w={44} h={18} r={9} tone={1} />
                    </span>
                    <Bar w={row.to + 40} h={6} tone={3} />
                    {wide ? <Bar w={row.subject} h={6} tone={2} /> : null}
                    {wide ? <Bar w={row.time} h={6} tone={2} /> : null}
                  </div>
                ),
              )}
            </div>
          </Window>
        )}
      </Stage>
    </div>
  );
}

/* ---------------- Light and dark preview (component) ---------------- */

export function Preview({ theme }: SceneProps) {
  const [ref, width] = usePictureWidth(360);
  return (
    <div ref={ref} className="ef-fit">
      <Stage<Beat>
        theme={theme}
        width={width}
        height={220}
        initial={before}
        poster={after}
        play="once"
        script={beat(2)}
        className="ep-look ef ef-preview"
      >
        {(s) => (
          <>
            <Segmented
              items={[
                <span key="l" className="ef-seg-item">
                  <Sun size={14} strokeWidth={2} /> Light
                </span>,
                <span key="d" className="ef-seg-item">
                  <Moon size={14} strokeWidth={2} /> Dark
                </span>,
              ]}
              value={s.on ? 1 : 0}
              className="ef-seg"
            />
            {/* The email as a dark-mode mail app shows it: inverted, the
                picture kept as drawn, exactly as the app's preview does. */}
            <div className="ef-mail" data-dark={s.on || undefined}>
              <span className="ef-mail-brand">Wizzaroo</span>
              <span className="ef-mail-title">Confirm your email</span>
              <Bar w={170} h={6} tone={2} className="ef-mail-bar" />
              <Bar w={120} h={6} tone={2} className="ef-mail-bar" />
              <span className="ef-mail-button">Confirm</span>
            </div>
          </>
        )}
      </Stage>
    </div>
  );
}

/* ---------------- Socials (collection) ---------------- */

const look = { shape: "circle", colorMode: "brand", customColor: "" } as const;

export function Socials({ theme }: SceneProps) {
  const [ref, width] = usePictureWidth(360);
  return (
    <div ref={ref} className="ef-fit">
      <Stage
        theme={theme}
        width={width}
        height={260}
        initial={{}}
        className="ep-look ef ef-socials"
      >
        {() => (
          <div className="ef-icons" aria-hidden="true">
            {socialNetworks.map((network) => (
              <span
                key={network}
                className="ef-icon"
                dangerouslySetInnerHTML={{
                  __html: socialIconSvg(network, look, 40),
                }}
              />
            ))}
          </div>
        )}
      </Stage>
    </div>
  );
}

/* ---------------- Slug (component) ---------------- */

export function Slug({ theme }: SceneProps) {
  const [ref, width] = usePictureWidth(360);
  return (
    <div ref={ref} className="ef-fit">
      <Stage<Beat>
        theme={theme}
        width={width}
        height={180}
        initial={before}
        poster={after}
        play="once"
        script={beat(4)}
        className="ep-look ef ef-slug"
      >
        {(s) => (
          <div className="ef-slug-card">
            <Field
              label="Slug"
              value="wizzaroo-email-changed"
              status={s.on ? "valid" : undefined}
              className="ef-field"
            />
            <span className="ef-slug-hint">
              <States
                value={s.on ? "ok" : "check"}
                align="start"
                states={{
                  check: <span className="ef-faint">Checking…</span>,
                  ok: (
                    <Badge
                      tone="success"
                      icon={<Icon name="check" size={12} />}
                    >
                      Unique
                    </Badge>
                  ),
                }}
              />
            </span>
            <code className="ef-code">
              <span className="ef-code-key">&quot;templateSlug&quot;</span>:{" "}
              <span className="ef-code-value">
                &quot;wizzaroo-email-changed&quot;
              </span>
            </code>
          </div>
        )}
      </Stage>
    </div>
  );
}
