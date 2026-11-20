import { Badge, Bar, Stage, Text } from "./kit.ts";
import type { SceneProps } from "./main.tsx";
import "./look.css";
import "./built-ins.css";

// Many of one (references/framing.md): the 15 built-in emails as a grid of
// the same small thing, off every edge, one in focus by depth and the only
// one with words. A still. Real strings: the focus email's brand, title and
// that it is ready to send.

const COLS = 5;
const ROWS = 3;
const FOCUS = { col: 2, row: 1 };

const WIDTHS: readonly (readonly [number, number])[] = [
  [96, 64],
  [80, 52],
  [104, 70],
  [72, 58],
  [90, 46],
];

export function BuiltIns({ theme }: SceneProps) {
  return (
    <Stage
      theme={theme}
      width={640}
      height={340}
      compact={{ below: 600, width: 358, height: 340 }}
      initial={{}}
      className="ep-look eb"
    >
      {() => (
        <div className="eb-grid">
          {Array.from({ length: ROWS * COLS }, (_, index) => {
            const col = index % COLS;
            const row = Math.floor(index / COLS);
            const [a, b] = WIDTHS[(index * 3) % WIDTHS.length] ?? [80, 50];
            return col === FOCUS.col && row === FOCUS.row ? (
              <div key={index} className="eb-tile" data-focus>
                <div className="eb-thumb eb-thumb--focus">
                  <span className="eb-brand">Wizzaroo</span>
                  <span className="eb-title">A passkey was added</span>
                  <span className="eb-line" />
                  <span className="eb-line eb-line--short" />
                  <span className="eb-button" />
                </div>
                <div className="eb-meta">
                  <Text className="eb-name">Passkey added</Text>
                  <Badge tone="success" dot>
                    Built in
                  </Badge>
                </div>
              </div>
            ) : (
              <div key={index} className="eb-tile">
                <div className="eb-thumb">
                  <Bar w={a - 30} h={7} r={3.5} tone={4} />
                  <Bar w={a} h={5} tone={2} />
                  <Bar w={b} h={5} tone={2} />
                  <Bar w={42} h={12} r={4} tone={3} />
                </div>
                <div className="eb-meta">
                  <Bar w={b + 20} h={7} r={3.5} tone={3} />
                  <Bar w={40} h={8} r={4} tone={2} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Stage>
  );
}
