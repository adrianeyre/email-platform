// Mounts each Stageshow scene into its place on the page: an element marked
// data-illustration="<name>". The element holds a still image of the scene
// (filmed into docs/images/illustrations/), which the page shows without
// JavaScript and which the scene replaces here.
import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { BuiltIns } from "./built-ins.tsx";
import { Logs, Preview, Slug, Socials } from "./features.tsx";
import { Hero } from "./hero.tsx";
import { useTheme } from "./theme.ts";

export interface SceneProps {
  theme: "light" | "dark";
}

const scenes: Record<string, ComponentType<SceneProps> | undefined> = {
  hero: Hero,
  "features-logs": Logs,
  "features-preview": Preview,
  "features-socials": Socials,
  "features-slug": Slug,
  "built-ins": BuiltIns,
};

const Themed = ({ Scene }: { Scene: ComponentType<SceneProps> }) => (
  <Scene theme={useTheme()} />
);

for (const host of document.querySelectorAll<HTMLElement>(
  "[data-illustration]",
)) {
  const Scene = scenes[host.dataset.illustration ?? ""];
  if (Scene !== undefined) {
    host.dataset.live = "";
    createRoot(host).render(
      <StrictMode>
        <Themed Scene={Scene} />
      </StrictMode>,
    );
  }
}
