import {
  Columns2,
  Heading,
  Image,
  Monitor,
  RectangleHorizontal,
  Share2,
  Smartphone,
  Type,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  socialIconSvg,
  type SocialNetwork,
} from "../../src/templates/design/social-icons.ts";
import {
  Bar,
  Button,
  Caret,
  Collapse,
  Prompt,
  Roll,
  Segmented,
  Stage,
  Window,
  type Act,
} from "./kit.ts";
import type { SceneProps } from "./main.tsx";
import "./look.css";
import "./hero.css";

// The home page hero: design an email, then send it from an app.
//
// Plan, written before the code (references/framing.md, motion.md):
//   Medium   an animated hero beside the page's copy, 720 × 360, loop; a
//            358-wide compact design for phones.
//   Layout   corner bleed: the designer inset one gutter top and left,
//            running off the right and bottom. A terminal is the one
//            satellite, over the email's quiet right margin and the
//            designer's inspector (chrome), never over the subject.
//   Focal    the Wizzaroo email in the designer.
//   Beats    1 Socials is clicked in the palette and drops into the email
//            2 Save presses and becomes Saved
//            3 the terminal comes forward: a curl by templateSlug, queued
//            4 payoff: sent, held
//            reset: the terminal recedes, the block is selected and deleted
//            (⌫), and Saved goes back to Save: a seen cause, no rewind.
//   Words    Wizzaroo, Reset your password, {{email}}, Choose a new password,
//            Socials, Save/Saved, and the terminal's lines. The rest is bars.

interface S {
  added: boolean;
  selected: boolean;
  saved: boolean;
  terminal: boolean;
  status: "none" | "queued" | "sent";
}

const initial: S = {
  added: false,
  selected: false,
  saved: false,
  terminal: false,
  status: "none",
};

/** The frame most people see: the block in the email, saved, and sent. */
const poster: S = {
  added: true,
  selected: false,
  saved: true,
  terminal: true,
  status: "sent",
};

const SOCIALS: readonly SocialNetwork[] = ["website", "linkedin", "facebook"];

/** The product's own icon, exactly as the email is sent with it. */
const SocialIcon = ({ network }: { network: SocialNetwork }) => (
  <span
    className="eh-social"
    dangerouslySetInnerHTML={{
      __html: socialIconSvg(
        network,
        { shape: "circle", colorMode: "custom", customColor: "#2563eb" },
        22,
      ),
    }}
  />
);

const tiles: readonly { icon: ReactNode; label?: string; target?: string }[] = [
  { icon: <Heading size={16} strokeWidth={2} /> },
  { icon: <Type size={16} strokeWidth={2} /> },
  { icon: <RectangleHorizontal size={16} strokeWidth={2} /> },
  { icon: <Image size={16} strokeWidth={2} /> },
  { icon: <Columns2 size={16} strokeWidth={2} /> },
  {
    icon: <Share2 size={16} strokeWidth={2} />,
    label: "Socials",
    target: "socials-tile",
  },
];

async function script(a: Act<S>) {
  await a.wait(500);

  // 1. Add the Socials block from the palette
  await a.move("socials-tile");
  await a.wait(250);
  await a.click();
  await a.set({ added: true, selected: true });
  await a.wait(1100);

  // 2. Save
  await a.move("save");
  await a.wait(200);
  await a.click();
  await a.set({ saved: true, selected: false });
  await a.wait(600);
  await a.move("rest");

  // 3. Send it from an app, by its slug
  await a.set({ terminal: true });
  await a.wait(1100);
  await a.set({ status: "queued" });
  await a.wait(1000);

  // 4. Payoff
  await a.set({ status: "sent" });
  a.mark("sent");
  await a.wait(2400);

  // Reset with a cause: select the block and delete it
  await a.set({ terminal: false });
  await a.wait(300);
  await a.move("socials-block");
  await a.click();
  await a.set({ selected: true });
  await a.wait(300);
  await a.key("backspace");
  await a.set({ added: false, selected: false, saved: false });
  // Let the block close and the label roll before the hidden reset.
  await a.move("rest");
  await a.wait(300);
  await a.snap({ status: "none" }, "terminal");
}

export function Hero({ theme }: SceneProps) {
  return (
    <Stage<S>
      theme={theme}
      width={720}
      height={360}
      compact={{ below: 640, width: 358, height: 340 }}
      initial={initial}
      poster={poster}
      script={script}
      cursor={{ at: { wide: "rest", compact: "rest" } }}
      keys={{ wide: "bottom-left", compact: "bottom-left" }}
      className="ep-look eh"
    >
      {(s, _rect, layout) => (
        <>
          <Window url="mail.example.com" className="eh-window">
            <div className="eh-app">
              <aside className="eh-palette">
                <span className="eh-panel-title">Add blocks</span>
                <div className="eh-tiles">
                  {tiles.map((tile, index) => (
                    <span
                      key={index}
                      className="eh-tile"
                      data-target={tile.target}
                      data-cursor={tile.target ? "pointer" : undefined}
                    >
                      {tile.icon}
                      {tile.label ? (
                        <span className="eh-tile-label">{tile.label}</span>
                      ) : (
                        <Bar w={30 + ((index * 7) % 14)} h={5} tone={3} />
                      )}
                    </span>
                  ))}
                </div>
                <span className="eh-panel-title eh-panel-title--outline">
                  <Bar w={44} h={5} tone={3} />
                </span>
                {[78, 60, 70].map((w) => (
                  <Bar key={w} w={w} h={6} tone={2} className="eh-outline" />
                ))}
              </aside>

              <section className="eh-center">
                <div className="eh-topbar">
                  <Segmented
                    items={[
                      <Monitor key="d" size={14} strokeWidth={2} />,
                      <Smartphone key="p" size={14} strokeWidth={2} />,
                    ]}
                    value={0}
                    className="eh-seg"
                  />
                  <Button variant="primary" size="medium" data-target="save">
                    {s.saved ? "Saved" : "Save"}
                  </Button>
                </div>

                <div className="eh-canvas">
                  <div className="eh-email">
                    <div className="eh-brand">Wizzaroo</div>
                    <div className="eh-heading">Reset your password</div>
                    <div className="eh-para">
                      <Bar w={layout === "wide" ? 230 : 190} h={6} tone={2} />
                      <span className="eh-line">
                        <Bar w={46} h={6} tone={2} />
                        <span className="eh-var">{"{{email}}"}</span>
                        <Bar w={layout === "wide" ? 96 : 54} h={6} tone={2} />
                      </span>
                    </div>
                    <span className="eh-button">Choose a new password</span>
                    <span className="eh-rule" />
                    <Collapse open={s.added} reveal="drop">
                      <div
                        className="eh-block"
                        data-target="socials-block"
                        data-selected={s.selected || undefined}
                      >
                        {SOCIALS.map((network) => (
                          <SocialIcon key={network} network={network} />
                        ))}
                      </div>
                    </Collapse>
                    <div className="eh-note">
                      <Bar w={180} h={5} tone={1} />
                      <Bar w={120} h={5} tone={1} />
                    </div>
                  </div>
                </div>
              </section>

              {layout === "wide" ? (
                <aside className="eh-inspector">
                  <Bar w={64} h={5} tone={3} />
                  <Bar w={150} h={26} r={6} tone={1} />
                  <Bar w={50} h={5} tone={3} />
                  <Bar w={150} h={26} r={6} tone={1} />
                </aside>
              ) : null}
            </div>
          </Window>

          <Window
            chrome="terminal"
            title="app — zsh"
            className="eh-terminal"
            data-target="terminal"
            data-show={s.terminal || undefined}
          >
            <Prompt path="~/app">curl $MAIL/v1/messages \</Prompt>
            <div className="eh-cmd">
              -d &apos;{"{"}&quot;templateSlug&quot;:
            </div>
            <div className="eh-cmd">
              &nbsp;&nbsp;&quot;wizzaroo-reset-your-password&quot;,
            </div>
            <div className="eh-cmd eh-cmd--to">
              &nbsp;&nbsp;&quot;to&quot;:[&quot;ada@example.com&quot;]{"}"}
              &apos;
            </div>
            <div
              className="eh-out"
              data-show={s.status !== "none" || undefined}
            >
              <span className="dim">202</span>{" "}
              <span className={s.status === "sent" ? "ok" : "dim"}>
                <Roll>{s.status === "sent" ? "✓ sent" : "• queued"}</Roll>
              </span>
            </div>
            <Caret />
          </Window>

          <span data-target="rest" className="eh-rest" />
        </>
      )}
    </Stage>
  );
}
