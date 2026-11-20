// Films a still of every Stageshow scene on the website into
// docs/images/illustrations/, with Stageshow's own film.mjs and its rehearsal
// gate. The stills are what the page shows before (or without) JavaScript,
// what search engines index, and the pictures in the README.
//
// Start the site first with `pnpm site:dev`, then run `pnpm site:film`.
// SITE_FILM_URL overrides where the site is served. Filming needs Google
// Chrome (or CHROME_PATH) and playwright-core, a dev dependency.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const url = process.env.SITE_FILM_URL ?? "http://127.0.0.1:4330/";
const out = join(root, "docs/images/illustrations");
const film = join(import.meta.dirname, "stageshow/scripts/film.mjs");

/** Each scene is the element marked data-illustration="<name>" on the page. */
const scenes = [
  "hero",
  "features-logs",
  "features-preview",
  "features-socials",
  "features-slug",
  "built-ins",
];

mkdirSync(out, { recursive: true });
const failed: string[] = [];
for (const scene of scenes) {
  for (const theme of ["light", "dark"] as const) {
    const file = join(out, `${scene}${theme === "dark" ? "-dark" : ""}.png`);
    const result = spawnSync(
      process.execPath,
      [
        film,
        url,
        "--select",
        `[data-illustration="${scene}"]`,
        "--width",
        "1440",
        "--pad",
        "0",
        // The poster: the frame that tells the story on its own.
        "--reduced",
        "--still",
        "--gate",
        ...(theme === "dark" ? ["--dark"] : []),
        "--out",
        file,
      ],
      { stdio: "inherit" },
    );
    if (result.status !== 0) {
      failed.push(`${scene} (${theme})`);
    }
  }
}
if (failed.length > 0) {
  console.error(`Filming failed for: ${failed.join(", ")}`);
  process.exitCode = 1;
}
