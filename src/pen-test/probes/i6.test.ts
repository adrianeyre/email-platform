/**
 * Pen test I6 (#108): the CI supply chain, the deploy script, the client package and the public site (H14, H16, H17).
 * The verdicts and evidence are in `docs/pen-test/findings/I6.md`.
 *
 * Most of this surface is files, not routes: the workflows, `ops/deploy-server.sh`, `pnpm-workspace.yaml`, the
 * published package and the images `site/build.ts` publishes, so those probes read the files (or run the script with
 * its commands stubbed, as `src/ops/deploy-server.test.ts` does) and need no container. The client probes run
 * `@adrianeyre/email-client` against the probe world's API, over a real socket, with the real Postgres and the E2
 * fixture keys behind it.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import {
  createServer as createTcpServer,
  connect,
  type Socket,
} from "node:net";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { inspect } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEmailClient,
  EmailApiError,
  EmailNetworkError,
} from "../../../packages/email-client/src/index.js";
import {
  hasContainerRuntime,
  startProbeWorld,
  warnIfSkipped,
  type ProbeWorld,
} from "./probe-world.js";

warnIfSkipped("src/pen-test/probes/i6.test.ts");

const root = resolve(".");
const readText = (path: string): string =>
  readFileSync(join(root, path), "utf8");

/* ---------- Reading the workflows: no YAML library is a dependency, and these files are plain enough to read by line ---------- */

const workflowText = (name: string): string =>
  readText(join(".github/workflows", name));
/** Every workflow in the folder, so one added later is read too. */
const allWorkflows = (): string[] =>
  readdirSync(join(root, ".github/workflows")).filter((name) =>
    /\.ya?ml$/u.test(name),
  );

/** The lines under a top-level key (`on:`, `permissions:`, `jobs:`), up to the next top-level key. */
const topLevelBlock = (text: string, key: string): string => {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start === -1) {
    return "";
  }
  const end = lines.findIndex(
    (line, index) => index > start && /^[^\s#]/u.test(line),
  );
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
};

/** The keys two spaces in under a block, such as the triggers under `on:` or the scopes under `permissions:`. */
const keysOf = (block: string): string[] =>
  [...block.matchAll(/^ {2}([\w-]+):/gmu)].map((match) => match[1] ?? "");

/** `name: value` pairs two spaces in, such as `packages: write`. */
const scopesOf = (block: string): Record<string, string> =>
  Object.fromEntries(
    [...block.matchAll(/^ {2}([\w-]+):\s*(\w+)\s*$/gmu)].map((match) => [
      match[1] ?? "",
      match[2] ?? "",
    ]),
  );

interface Job {
  name: string;
  text: string;
  /** The job's own permissions, or the workflow's when the job sets none. */
  permissions: Record<string, string>;
}

const jobsOf = (text: string): Job[] => {
  const workflowPermissions = scopesOf(topLevelBlock(text, "permissions"));
  const parts = topLevelBlock(text, "jobs").split(/^ {2}(?=[\w-]+:\s*$)/mu);
  return parts
    .filter((part) => part.trim() !== "")
    .map((part) => {
      const name = part.slice(0, part.indexOf(":"));
      const lines = part.split("\n").filter((line) => !/^\s*#/u.test(line));
      const start = lines.findIndex((line) => line === "    permissions:");
      const after = lines.slice(start + 1);
      const end = after.findIndex((line) => !line.startsWith("      "));
      const own =
        start === -1
          ? undefined
          : Object.fromEntries(
              after
                .slice(0, end === -1 ? undefined : end)
                .map((line) => /^ {6}([\w-]+):\s*(\w+)\s*$/u.exec(line))
                .filter((match) => match !== null)
                .map((match) => [match[1] ?? "", match[2] ?? ""]),
            );
      return { name, text: part, permissions: own ?? workflowPermissions };
    });
};

/** Each step of a job, from its `- ` to the next. */
const stepsOf = (job: string): string[] => job.split(/^ {6}- /mu).slice(1);

/** Every action a workflow runs, as written after `uses:`. */
const usesOf = (text: string): string[] =>
  [...text.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gmu)].map(
    (match) => match[1] ?? "",
  );
const isPinnedBySha = (reference: string): boolean =>
  /@[0-9a-f]{40}$/u.test(reference);

const runsDependencyCode = (job: Job): boolean =>
  /\bpnpm (install|run|test|site:build|--filter)\b/u.test(job.text);
const writeScopes = (job: Job): string[] =>
  Object.entries(job.permissions)
    .filter(([, access]) => access === "write")
    .map(([scope]) => scope);

describe("pen test I6 (#108): the workflows", () => {
  describe("probe 1: every uses: line, pinned by tag or SHA", () => {
    it("pins every action in pages.yml and release.yml by commit SHA", () => {
      for (const name of ["pages.yml", "release.yml"]) {
        const uses = usesOf(workflowText(name));
        expect(uses.length).toBeGreaterThan(0);
        expect(uses.filter((reference) => !isPinnedBySha(reference))).toEqual(
          [],
        );
      }
    });

    it("(regression) pins every action in publish-email-client.yml by commit SHA, the same SHAs the other workflows use, with the version in a comment (#176)", () => {
      const text = workflowText("publish-email-client.yml");
      expect(usesOf(text)).toEqual([
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1",
        "pnpm/action-setup@73e46992e05b19abd31f2f3c20e0e7370d762115",
        "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9",
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1",
        "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333",
      ]);
      for (const name of allWorkflows()) {
        const lines = workflowText(name)
          .split("\n")
          .filter((line) => /^\s*(?:- )?uses:/u.test(line));
        expect(
          lines.filter(
            (line) => !/@[0-9a-f]{40} # v\d+\.\d+\.\d+$/u.test(line),
          ),
        ).toEqual([]);
      }
    });

    // The repository setting that makes GitHub refuse a tag-pinned action (sha_pinning_required) is an owner step
    // after merge, in docs/operations/website-ci-and-releases.md; this test is the in-repository half.
    it("pins every action in every workflow by commit SHA", () => {
      const unpinned = allWorkflows().flatMap((name) =>
        usesOf(workflowText(name))
          .filter((reference) => !isPinnedBySha(reference))
          .map((reference) => `${name}: ${reference}`),
      );
      expect(unpinned).toEqual([]);
    });
  });

  describe("probe 2: every checkout's persist-credentials", () => {
    const checkoutsWithoutPersistFalse = (name: string): number =>
      jobsOf(workflowText(name))
        .flatMap((job) => stepsOf(job.text))
        .filter((step) => /uses:\s*actions\/checkout@/u.test(step))
        .filter((step) => !/persist-credentials:\s*false/u.test(step)).length;

    it("sets persist-credentials: false on every checkout in pages.yml and release.yml", () => {
      expect(checkoutsWithoutPersistFalse("pages.yml")).toBe(0);
      expect(checkoutsWithoutPersistFalse("release.yml")).toBe(0);
    });

    it("(regression) keeps no token in .git/config in publish-email-client.yml: persist-credentials: false on both checkouts, the build job's and the publish job's (#175)", () => {
      const jobs = jobsOf(workflowText("publish-email-client.yml"));
      const checkouts = jobs
        .flatMap((job) => stepsOf(job.text))
        .filter((step) => /uses:\s*actions\/checkout@/u.test(step));
      expect(checkouts).toHaveLength(2);
      expect(checkoutsWithoutPersistFalse("publish-email-client.yml")).toBe(0);
      const build = jobs.find((job) => job.name === "build");
      expect(build?.text).toMatch(/pnpm install --frozen-lockfile/u);
      expect(build?.text).toMatch(
        /pnpm --filter @adrianeyre\/email-client test/u,
      );
    });

    it("sets persist-credentials: false on every checkout in every workflow", () => {
      expect(
        allWorkflows().filter((name) => checkoutsWithoutPersistFalse(name) > 0),
      ).toEqual([]);
    });
  });

  describe("probe 3: every workflow's permissions", () => {
    it("gives write scopes in pages.yml and release.yml only to jobs that install and run no dependency code", () => {
      for (const name of ["pages.yml", "release.yml"]) {
        const jobs = jobsOf(workflowText(name));
        expect(jobs.length).toBeGreaterThan(1);
        expect(
          jobs
            .filter((job) => writeScopes(job).length > 0)
            .filter(runsDependencyCode)
            .map((job) => job.name),
        ).toEqual([]);
        expect(
          scopesOf(topLevelBlock(workflowText(name), "permissions")),
        ).toEqual({ contents: "read" });
      }
    });

    it("(regression) grants packages: write in publish-email-client.yml only to the publish job, which installs nothing and runs no package script; the build job that installs, tests and packs has contents: read (#175)", () => {
      const text = workflowText("publish-email-client.yml");
      expect(scopesOf(topLevelBlock(text, "permissions"))).toEqual({
        contents: "read",
      });
      const jobs = jobsOf(text);
      expect(jobs.map((job) => job.name)).toEqual(["build", "publish"]);
      const [build, publish] = jobs;
      expect(build?.permissions).toEqual({ contents: "read" });
      expect(build !== undefined && runsDependencyCode(build)).toBe(true);
      expect(build?.text).toMatch(/uses: actions\/upload-artifact@/u);
      expect(publish?.permissions).toEqual({
        contents: "read",
        packages: "write",
      });
      expect(publish !== undefined && runsDependencyCode(publish)).toBe(false);
      expect(publish?.text).not.toMatch(/\bpnpm\b/u);
      expect(publish?.text).toMatch(/^ {4}needs: build$/mu);
      expect(publish?.text).toMatch(/uses: actions\/download-artifact@/u);
      expect(publish?.text).toMatch(
        /npm publish "\$EMAIL_CLIENT_TARBALL" --ignore-scripts/u,
      );
    });

    it("gives a write scope only to jobs that install and run no dependency code, in every workflow", () => {
      expect(
        allWorkflows().flatMap((name) =>
          jobsOf(workflowText(name))
            .filter((job) => writeScopes(job).length > 0)
            .filter(runsDependencyCode)
            .map(
              (job) => `${name}: ${job.name} (${writeScopes(job).join(", ")})`,
            ),
        ),
      ).toEqual([]);
    });
  });

  describe("probe 4: every workflow's triggers", () => {
    it("has no pull_request_target trigger, and puts no event or branch text straight into a run: script", () => {
      for (const name of allWorkflows()) {
        const text = workflowText(name);
        expect(keysOf(topLevelBlock(text, "on"))).not.toContain(
          "pull_request_target",
        );
        expect(text).not.toMatch(/\$\{\{\s*github\.(event|head_ref)/u);
      }
    });

    // #109 added the pull_request workflow, so this pair has turned, as docs/pen-test/README.md says.
    it("(regression) runs checks.yml on pull_request, and pages.yml and release.yml on a push to main, publish-email-client.yml only on a tag (#109, #177)", () => {
      const triggers = Object.fromEntries(
        allWorkflows().map((name) => [
          name,
          keysOf(topLevelBlock(workflowText(name), "on")),
        ]),
      );
      expect(triggers).toEqual({
        "checks.yml": ["pull_request"],
        "pages.yml": ["push", "workflow_dispatch"],
        "release.yml": ["push"],
        "publish-email-client.yml": ["push"],
      });
    });

    it("checks every pull request in a workflow: lint, typecheck, test and an audit", () => {
      const checks = allWorkflows().filter((name) =>
        keysOf(topLevelBlock(workflowText(name), "on")).includes(
          "pull_request",
        ),
      );
      expect(checks).not.toEqual([]);
      const text = checks.map(workflowText).join("\n");
      for (const command of [
        "pnpm lint",
        "pnpm typecheck",
        "pnpm test",
        "pnpm audit",
      ]) {
        expect(text).toContain(command);
      }
    });

    const updateConfigs = [
      ".github/dependabot.yml",
      ".github/dependabot.yaml",
      "renovate.json",
      ".github/renovate.json",
    ];

    it("(regression) has Dependabot propose grouped weekly updates to the workspace's npm packages, the email client's included, and to the SHA-pinned actions (#179)", () => {
      expect(
        updateConfigs.filter((path) => existsSync(join(root, path))),
      ).toEqual([".github/dependabot.yml"]);
      const text = readText(".github/dependabot.yml");
      const ecosystems = [
        ...text.matchAll(/^ {2}- package-ecosystem: ([\w-]+)$/gmu),
      ].map((match) => match[1]);
      expect(ecosystems).toEqual(["npm", "github-actions"]);
      for (const update of text.split(/^ {2}- /mu).slice(1)) {
        expect(update).toMatch(/^ {4}schedule:\n {6}interval: weekly$/mu);
        expect(update).toMatch(/^ {4}groups:$/mu);
      }
      expect(text).toMatch(/^ {6}- "\/"$/mu);
      expect(text).toMatch(/^ {6}- "\/packages\/email-client"$/mu);
    });

    it("has Dependabot (or Renovate) propose updates to the npm packages and to the SHA-pinned actions", () => {
      const config = updateConfigs.find((path) => existsSync(join(root, path)));
      expect(config).toBeDefined();
      const text = config === undefined ? "" : readText(config);
      expect(text).toMatch(/npm/u);
      expect(text).toMatch(/github-actions/u);
    });
  });

  describe("probe 5: what workflow_dispatch on publish-email-client.yml publishes", () => {
    const publishJob = (): string =>
      jobsOf(workflowText("publish-email-client.yml")).find(
        (job) => job.name === "publish",
      )?.text ?? "";
    const step = (named: string): string =>
      stepsOf(publishJob()).find((text) => text.includes(`name: ${named}`)) ??
      "";

    it("(regression) has no workflow_dispatch, runs only on an email-client-v* tag, and publishes from a job in the email-client environment that refuses a commit not on main and a tarball whose version isn't the tag's, whatever started the run (#177)", () => {
      const text = workflowText("publish-email-client.yml");
      expect(keysOf(topLevelBlock(text, "on"))).toEqual(["push"]);
      expect(topLevelBlock(text, "on")).toBe(
        '  push:\n    tags:\n      - "email-client-v*"\n',
      );
      expect(publishJob()).toMatch(/^ {4}environment: email-client$/mu);
      const onMain = step("Check the tag's commit is on main");
      expect(onMain).not.toMatch(/\bif:/u);
      expect(onMain).toMatch(/refs\/tags\/email-client-v\*\) ;;/u);
      expect(onMain).toMatch(
        /git merge-base --is-ancestor "\$commit" refs\/remotes\/origin\/main/u,
      );
      const version = step("Check the tag matches the package version");
      expect(version).not.toMatch(/\bif:/u);
      expect(version).toMatch(/manifest\.version !== tagVersion/u);
      expect(step("Publish")).not.toMatch(/\bif:/u);
      const names = stepsOf(publishJob()).map(
        (text) => /name: (.+)/u.exec(text)?.[1] ?? "",
      );
      expect(names.indexOf("Check the tag's commit is on main")).toBeLessThan(
        names.indexOf("Publish"),
      );
      expect(
        names.indexOf("Check the tag matches the package version"),
      ).toBeLessThan(names.indexOf("Publish"));
    });

    // The in-repository half. The environment's deployment rule (only email-client-v* tags) and the tag ruleset on
    // email-client-v* are GitHub settings, owner steps after merge in docs/operations/website-ci-and-releases.md.
    it("publishes only a version tag whose commit is on main, checked against package.json, whatever started the run", () => {
      expect(step("Check the tag matches the package version")).not.toMatch(
        /\bif:/u,
      );
      expect(publishJob()).toMatch(/merge-base --is-ancestor/u);
      expect(publishJob()).toMatch(/^ {4}environment:/mu);
    });
  });
});

/* ---------- Probe 6: what ops/deploy-server.sh installs and runs on the production host, and as whom ---------- */

describe("pen test I6 (#108): ops/deploy-server.sh on the production host", () => {
  const runStubbedDeploy = (): { exitCode: number | null; calls: string[] } => {
    const directory = mkdtempSync(join(tmpdir(), "i6-deploy-"));
    try {
      const log = join(directory, "calls.log");
      writeFileSync(log, "");
      for (const command of ["git", "pnpm", "docker", "curl"]) {
        const stub = join(directory, command);
        writeFileSync(
          stub,
          [
            "#!/bin/sh",
            `echo "uid=$(id -u) ${command} $*" >> "${log}"`,
            "exit 0",
          ].join("\n"),
        );
        chmodSync(stub, 0o755);
      }
      const result = spawnSync("sh", [join(root, "ops/deploy-server.sh")], {
        env: { PATH: `${directory}:/usr/bin:/bin` },
        encoding: "utf8",
      });
      return {
        exitCode: result.status,
        calls: readFileSync(log, "utf8")
          .split("\n")
          .filter((line) => line !== ""),
      };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };

  it("(regression) pulls main, refuses a HEAD that isn't origin/main, then only builds and runs the images on the production host, installing nothing and running no check (#178)", () => {
    const { exitCode, calls } = runStubbedDeploy();
    const uid = String(process.getuid?.() ?? "");
    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      `uid=${uid} git pull --ff-only origin main`,
      `uid=${uid} git rev-parse HEAD`,
      `uid=${uid} git rev-parse origin/main`,
      `uid=${uid} docker compose build`,
      `uid=${uid} docker compose run --rm migrate`,
      `uid=${uid} docker compose up -d --wait`,
      `uid=${uid} curl --fail --silent --show-error --retry 5 --retry-delay 2 --retry-all-errors http://127.0.0.1:4320/health`,
    ]);
    const script = readText("ops/deploy-server.sh");
    expect(script).not.toMatch(/\b(sudo|su|runuser|doas)\b/u);
    expect(script).toMatch(/\[ "\$head" != "\$main" \]/u);
  });

  it("installs no development dependency and runs no test, lint or typecheck on the production host", () => {
    const { calls } = runStubbedDeploy();
    const pnpmCalls = calls.filter((call) => call.includes(" pnpm "));
    expect(pnpmCalls.filter((call) => !/--prod\b/u.test(call))).toEqual([]);
    expect(
      readText("ops/deploy-server.sh")
        .split("\n")
        .filter((line) => !line.startsWith("#"))
        .filter((line) => /\b(pnpm|npm|npx|node)\b/u.test(line)),
    ).toEqual([]);
  });
});

/* ---------- Probe 7: allowBuilds, --frozen-lockfile and the published package's files ---------- */

describe("pen test I6 (#108): allowBuilds, --frozen-lockfile and the published package", () => {
  const allowBuilds = (): Record<string, boolean> =>
    Object.fromEntries(
      [
        ...topLevelBlock(
          readText("pnpm-workspace.yaml"),
          "allowBuilds",
        ).matchAll(/^ {2}"?([^":]+)"?:\s*(true|false)\s*$/gmu),
      ].map((match) => [match[1] ?? "", match[2] === "true"]),
    );

  /** Every installed package with an install script or a native build, which pnpm runs only if allowBuilds says so. */
  const packagesWithBuilds = (): string[] => {
    const store = join(root, "node_modules/.pnpm");
    const names = new Set<string>();
    const readPackage = (folder: string): void => {
      const file = join(folder, "package.json");
      if (!existsSync(file)) {
        return;
      }
      const manifest: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (typeof manifest !== "object" || manifest === null) {
        return;
      }
      const name = "name" in manifest ? manifest.name : undefined;
      const scripts =
        "scripts" in manifest &&
        typeof manifest.scripts === "object" &&
        manifest.scripts !== null
          ? Object.keys(manifest.scripts)
          : [];
      const hasBuild =
        scripts.some((script) =>
          ["preinstall", "install", "postinstall"].includes(script),
        ) || existsSync(join(folder, "binding.gyp"));
      if (typeof name === "string" && hasBuild) {
        names.add(name);
      }
    };
    for (const entry of readdirSync(store)) {
      const modules = join(store, entry, "node_modules");
      if (!existsSync(modules) || !statSync(modules).isDirectory()) {
        continue;
      }
      for (const child of readdirSync(modules)) {
        if (child.startsWith("@")) {
          for (const scoped of readdirSync(join(modules, child))) {
            readPackage(join(modules, child, scoped));
          }
        } else {
          readPackage(join(modules, child));
        }
      }
    }
    return [...names].sort();
  };

  it("names every installed package with an install script or native build in allowBuilds, and lets only esbuild and @fastify/pre-commit run", () => {
    const decided = allowBuilds();
    expect(decided).toEqual({
      esbuild: true,
      "cpu-features": false,
      protobufjs: false,
      ssh2: false,
      "@fastify/pre-commit": true,
    });
    expect(packagesWithBuilds().filter((name) => !(name in decided))).toEqual(
      [],
    );
  });

  it("installs with --frozen-lockfile everywhere the repository installs: every workflow and the Dockerfile (the deploy script installs nothing, #178)", () => {
    const installs = [
      ...allWorkflows().map((name) => join(".github/workflows", name)),
      "Dockerfile",
      "ops/deploy-server.sh",
    ].flatMap((path) =>
      readText(path)
        .split("\n")
        .filter((line) => /\bpnpm install\b/u.test(line))
        .map((line) => `${path}: ${line.trim()}`),
    );
    expect(installs.length).toBeGreaterThanOrEqual(5);
    expect(
      installs.filter((line) => !line.includes("--frozen-lockfile")),
    ).toEqual([]);
  });

  it("publishes @adrianeyre/email-client as dist's JavaScript and types, README.md and package.json only, with no dependency and no install script", () => {
    const packageDirectory = join(root, "packages/email-client");
    const manifest: unknown = JSON.parse(
      readFileSync(join(packageDirectory, "package.json"), "utf8"),
    );
    expect(manifest).toMatchObject({ files: ["dist"] });
    expect(manifest).not.toHaveProperty("dependencies");
    expect(manifest).not.toHaveProperty("scripts.preinstall");
    expect(manifest).not.toHaveProperty("scripts.install");
    expect(manifest).not.toHaveProperty("scripts.postinstall");

    // A copy of the package, built as the workflow builds it, packed as npm packs it.
    const copy = mkdtempSync(join(tmpdir(), "i6-email-client-"));
    try {
      cpSync(packageDirectory, copy, {
        recursive: true,
        filter: (source) =>
          !["node_modules", "dist"].includes(basename(source)),
      });
      symlinkSync(
        join(packageDirectory, "node_modules"),
        join(copy, "node_modules"),
      );
      const build = spawnSync(
        join(root, "node_modules/.bin/tsc"),
        ["-p", join(copy, "tsconfig.build.json")],
        { cwd: copy, encoding: "utf8" },
      );
      expect(build.status, build.stdout + build.stderr).toBe(0);
      const pack = spawnSync(
        "npm",
        ["pack", "--dry-run", "--json", "--ignore-scripts"],
        { cwd: copy, encoding: "utf8" },
      );
      expect(pack.status, pack.stderr).toBe(0);
      const packed: unknown = JSON.parse(pack.stdout);
      const entry: unknown = Array.isArray(packed) ? packed[0] : undefined;
      const listed: unknown =
        typeof entry === "object" && entry !== null && "files" in entry
          ? entry.files
          : undefined;
      const files: string[] = Array.isArray(listed)
        ? listed.map((file: unknown) =>
            typeof file === "object" && file !== null && "path" in file
              ? String(file.path)
              : "",
          )
        : [];
      expect(files).toContain("dist/index.js");
      expect(
        files.filter(
          (path) =>
            !["package.json", "README.md"].includes(path) &&
            !/^dist\/[\w-]+\.(js|d\.ts)$/u.test(path),
        ),
      ).toEqual([]);
      expect(files.filter((path) => path.includes(".test."))).toEqual([]);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  }, 60_000);
});

/* ---------- Probe 9: every image site/build.ts publishes, pinned to what was read ---------- */

interface ReviewedImage {
  published: string;
  source: string;
  sha256: string;
  shows: string[];
}

const isReviewedImage = (value: unknown): value is ReviewedImage =>
  typeof value === "object" &&
  value !== null &&
  "published" in value &&
  typeof value.published === "string" &&
  "source" in value &&
  typeof value.source === "string" &&
  "sha256" in value &&
  typeof value.sha256 === "string" &&
  "shows" in value &&
  Array.isArray(value.shows) &&
  value.shows.every((item) => typeof item === "string");

const reviewedImages = (): ReviewedImage[] => {
  const manifest: unknown = JSON.parse(
    readText("src/pen-test/probes/i6-reviewed-images.json"),
  );
  const images =
    typeof manifest === "object" && manifest !== null && "images" in manifest
      ? manifest.images
      : undefined;
  if (!Array.isArray(images) || !images.every(isReviewedImage)) {
    throw new Error("i6-reviewed-images.json is not a list of reviewed images");
  }
  return images;
};

/** What `site/build.ts` copies into the site: all of `docs/images`, as `images/…`, and the icons it names from `src/ui/public`. */
const publishedImages = (): Map<string, string> => {
  const build = readText("site/build.ts");
  expect(build).toContain(
    'cpSync(join(root, "docs/images"), join(folder, "images"), {',
  );
  const iconList = /for \(const file of \[([^\]]*)\]\)/u.exec(build)?.[1] ?? "";
  const icons = [...iconList.matchAll(/"([^"]+)"/gu)].map(
    (match) => match[1] ?? "",
  );
  expect(icons.length).toBeGreaterThan(0);
  const published = new Map<string, string>();
  const walk = (folder: string): void => {
    for (const entry of readdirSync(join(root, folder))) {
      const path = join(folder, entry);
      if (statSync(join(root, path)).isDirectory()) {
        walk(path);
      } else {
        published.set(join("images", relative("docs/images", path)), path);
      }
    }
  };
  walk("docs/images");
  for (const icon of icons) {
    published.set(icon, join("src/ui/public", icon));
  }
  return published;
};

const sha256 = (path: string): string =>
  createHash("sha256")
    .update(readFileSync(join(root, path)))
    .digest("hex");

describe("pen test I6 (#108): the images the public site publishes", () => {
  it("publishes exactly the images i6-reviewed-images.json lists, each unchanged since it was read for keys, passwords, cookies and addresses", () => {
    const published = publishedImages();
    const reviewed = reviewedImages();
    const reviewedPaths = new Set(reviewed.map((image) => image.published));
    expect({
      unread: [...published.keys()].filter((path) => !reviewedPaths.has(path)),
      gone: [...reviewedPaths].filter((path) => !published.has(path)),
      changed: reviewed
        .filter(
          (image) =>
            published.get(image.published) === image.source &&
            sha256(image.source) !== image.sha256,
        )
        .map((image) => image.published),
    }).toEqual({ unread: [], gone: [], changed: [] });
  });

  it("shows no address, URL or host beyond example ones and those every Built-in email or a fresh install already sends", () => {
    const sentAnyway = [
      readText("src/templates/built-in-emails.ts"),
      readText("src/settings/default-from.ts"),
    ].join("\n");
    const isExample = (value: string): boolean =>
      /(@|\/\/|^)([\w-]+\.)*example(\.com)?(\/|$|:|\b)/u.test(value) ||
      value === "localhost:1025";
    const shown = [
      ...new Set(reviewedImages().flatMap((image) => image.shows)),
    ];
    expect(
      shown.filter((value) => !isExample(value) && !sentAnyway.includes(value)),
    ).toEqual([]);
    // H17 allows one real address; the screenshots show a second, the Built-in Configuration's own from address.
    expect(shown.filter((value) => !isExample(value)).sort()).toEqual([
      "https://adrianeyre.co.uk",
      "https://facebook.com/adrianeyre",
      "https://www.linkedin.com/in/adrianeyre",
      "no-reply@adrianeyre.co.uk",
      "no-reply@wizzaroo.adrianeyre.co.uk",
    ]);
  });

  /** The chunk types of a PNG, in order. */
  const pngChunks = (bytes: Buffer, from = 8): string[] => {
    const types: string[] = [];
    for (let offset = from; offset + 8 <= bytes.length;) {
      const type = bytes.toString("latin1", offset + 4, offset + 8);
      types.push(type);
      if (type === "IEND") {
        break;
      }
      offset += 12 + bytes.readUInt32BE(offset);
    }
    return types;
  };
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  it("carries no text, comment or EXIF metadata in any published image, and no address or key in the SVG", () => {
    for (const [published, source] of publishedImages()) {
      const bytes = readFileSync(join(root, source));
      if (source.endsWith(".svg")) {
        expect(bytes.toString("utf8"), published).not.toMatch(
          /@|ek_|password|cookie/iu,
        );
        continue;
      }
      // A PNG, or an ICO holding PNGs: read the chunks of every PNG inside.
      const chunks: string[] = [];
      for (
        let at = bytes.indexOf(pngSignature);
        at !== -1;
        at = bytes.indexOf(pngSignature, at + 1)
      ) {
        chunks.push(...pngChunks(bytes, at + 8));
      }
      expect(chunks, published).toContain("IHDR");
      expect(
        [...new Set(chunks)].filter(
          (type) => !["IHDR", "PLTE", "tRNS", "IDAT", "IEND"].includes(type),
        ),
        published,
      ).toEqual([]);
    }
  });
});

/* ---------- Probe 8: @adrianeyre/email-client against the probe world's API ---------- */

/** A TCP relay in front of the API that keeps every byte the client sends, as anyone on the path would see it. */
const startRecordingRelay = async (
  target: number,
): Promise<{
  port: number;
  seen: () => string;
  close: () => Promise<void>;
}> => {
  const chunks: Buffer[] = [];
  const sockets = new Set<Socket>();
  const relay = createTcpServer((client) => {
    const upstream = connect(target, "127.0.0.1");
    sockets.add(client).add(upstream);
    client.on("data", (chunk: Buffer) => chunks.push(chunk));
    client.pipe(upstream).pipe(client);
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
  });
  await new Promise<void>((done) => relay.listen(0, "127.0.0.1", done));
  const address = relay.address();
  return {
    port: typeof address === "object" && address !== null ? address.port : 0,
    seen: () => Buffer.concat(chunks).toString("latin1"),
    close: () =>
      new Promise<void>((done) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        relay.close(() => {
          done();
        });
      }),
  };
};

const listen = async (server: Server): Promise<number> => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
};
const close = (server: Server): Promise<void> =>
  new Promise((done) =>
    server.close(() => {
      done();
    }),
  );

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** A fetch that keeps what the client asks for and answers with an empty template list, for hosts the probe can't run. */
const recordingFetch =
  (requests: RecordedRequest[]): typeof globalThis.fetch =>
  (input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: input instanceof Request ? input.url : String(input),
      headers: Object.fromEntries(headers.entries()),
      body: typeof init?.body === "string" ? init.body : "",
    });
    return Promise.resolve(
      new Response(JSON.stringify({ templates: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };

describe.skipIf(!hasContainerRuntime)(
  "pen test I6 (#108): @adrianeyre/email-client",
  () => {
    let world: ProbeWorld;
    let apiUrl: string;
    let key: string;

    beforeAll(async () => {
      world = await startProbeWorld({ hasMailpit: false });
      await world.server.listen({ host: "127.0.0.1", port: 0 });
      const address = world.server.server.address();
      apiUrl = `http://127.0.0.1:${String(typeof address === "object" && address !== null ? address.port : 0)}`;
      key = world.credentials.apiKeys.wizzaroo;
    });

    afterAll(async () => {
      await world.stop();
    });

    describe("probe 8a: how it sends the key", () => {
      it("sends the key only as an Authorization: Bearer header, never in the URL or the body", async () => {
        const requests: RecordedRequest[] = [];
        const record = recordingFetch(requests);
        const client = createEmailClient({
          baseUrl: apiUrl,
          apiKey: key,
          fetch: async (input, init) => {
            await record(input, init);
            return globalThis.fetch(input, init);
          },
        });
        expect((await client.listTemplates()).length).toBeGreaterThan(0);
        await expect(
          client.sendContent({
            to: "nobody@i6.pen-test.invalid",
            subject: "i6",
            text: "i6",
          }),
        ).resolves.toMatchObject({ status: "queued" });
        expect(requests).toHaveLength(2);
        for (const request of requests) {
          expect(request.headers.authorization).toBe(`Bearer ${key}`);
          expect(request.url).not.toContain(key);
          expect(request.body).not.toContain(key);
        }
      });

      it("doesn't carry the key across a redirect to another origin (the POST body, recipients and variables, does follow a 307)", async () => {
        const arrivals: { authorization: string | undefined; body: string }[] =
          [];
        const elsewhere = createHttpServer((request, response) => {
          let body = "";
          request.on("data", (chunk: Buffer) => (body += chunk.toString()));
          request.on("end", () => {
            arrivals.push({
              authorization: request.headers.authorization,
              body,
            });
            response.writeHead(202, { "content-type": "application/json" });
            response.end(JSON.stringify({ id: "x", status: "queued", to: [] }));
          });
        });
        const elsewherePort = await listen(elsewhere);
        const redirecting = createHttpServer((_request, response) => {
          response.writeHead(307, {
            location: `http://127.0.0.1:${String(elsewherePort)}/v1/messages`,
          });
          response.end();
        });
        const redirectingPort = await listen(redirecting);
        try {
          const client = createEmailClient({
            baseUrl: `http://127.0.0.1:${String(redirectingPort)}`,
            apiKey: key,
          });
          await client.sendBySlug({
            slug: "any",
            to: "nobody@i6.pen-test.invalid",
            variables: { resetUrl: "https://wizzaroo.i6.pen-test.invalid/r" },
          });
          expect(arrivals).toHaveLength(1);
          expect(arrivals[0]?.authorization).toBeUndefined();
          expect(arrivals[0]?.body).toContain("wizzaroo.i6.pen-test.invalid");
        } finally {
          await Promise.all([close(redirecting), close(elsewhere)]);
        }
      });
    });

    describe("probe 8b: an http: baseUrl", () => {
      it("(regression) refuses an http: baseUrl on a host other than loopback before sending anything, unless the caller passes allowInsecureHttp: true; loopback still works (#180)", async () => {
        const relay = await startRecordingRelay(Number(new URL(apiUrl).port));
        try {
          // Loopback never leaves the machine, so it needs no opt-in.
          const loopback = createEmailClient({
            baseUrl: `http://127.0.0.1:${String(relay.port)}`,
            apiKey: key,
          });
          expect((await loopback.listTemplates()).length).toBeGreaterThan(0);

          const requests: RecordedRequest[] = [];
          expect(() =>
            createEmailClient({
              baseUrl: "http://mail.example.com",
              apiKey: key,
              fetch: recordingFetch(requests),
            }),
          ).toThrow(
            /refuses the http: baseUrl http:\/\/mail\.example\.com: .*allowInsecureHttp: true/u,
          );
          expect(requests).toEqual([]);

          // The opt-in, by name, as an Application on ADR 0003's plain-HTTP LAN must.
          await createEmailClient({
            baseUrl: "http://mail.example.com",
            apiKey: key,
            allowInsecureHttp: true,
            fetch: recordingFetch(requests),
          }).listTemplates();
          expect(requests[0]?.url).toBe("http://mail.example.com/v1/templates");
        } finally {
          await relay.close();
        }
      });

      it("refuses an http: baseUrl for a host other than loopback, so the key never crosses a network in the clear", async () => {
        const requests: RecordedRequest[] = [];
        let refused = false;
        try {
          const client = createEmailClient({
            baseUrl: "http://mail.example.com",
            apiKey: key,
            fetch: recordingFetch(requests),
          });
          await client.listTemplates();
        } catch {
          refused = true;
        }
        expect(requests).toEqual([]);
        expect(refused).toBe(true);
      });
    });

    describe("probe 8c: what its errors carry", () => {
      const caught = async (attempt: Promise<unknown>): Promise<unknown> =>
        attempt.then(
          () => undefined,
          (error: unknown) => error,
        );
      const showsKey = (error: unknown, secret: string): boolean =>
        inspect(error, { depth: Infinity, showHidden: true }).includes(
          secret,
        ) ||
        JSON.stringify(error).includes(secret) ||
        (error instanceof Error && error.stack?.includes(secret) === true);

      it("carries the status, the app's own code, message and field errors, the first 200 characters of a body that isn't JSON, and the baseUrl when unreachable, but never the key", async () => {
        const deleted = world.credentials.apiKeys.deleted;
        const refusedKey = await caught(
          createEmailClient({
            baseUrl: apiUrl,
            apiKey: deleted,
          }).listTemplates(),
        );
        expect(refusedKey).toBeInstanceOf(EmailApiError);
        expect(refusedKey).toMatchObject({ status: 401 });
        expect(showsKey(refusedKey, deleted)).toBe(false);

        const client = createEmailClient({ baseUrl: apiUrl, apiKey: key });
        const invalid = await caught(
          client.sendContent({ to: [], subject: "i6", text: "i6" }),
        );
        expect(invalid).toBeInstanceOf(EmailApiError);
        expect(invalid).toMatchObject({
          status: 422,
          code: "validation_failed",
        });
        expect(
          invalid instanceof EmailApiError && invalid.fieldErrors.length > 0,
        ).toBe(true);
        expect(showsKey(invalid, key)).toBe(false);

        const missing = await caught(
          client.getMessage("7e570000-0000-4000-8000-0000000000ff"),
        );
        expect(missing).toMatchObject({ status: 404 });
        expect(showsKey(missing, key)).toBe(false);

        const unreachable = await caught(
          createEmailClient({
            baseUrl: "http://127.0.0.1:1",
            apiKey: key,
          }).listTemplates(),
        );
        expect(unreachable).toBeInstanceOf(EmailNetworkError);
        expect(unreachable).toMatchObject({
          message: "Couldn't reach the email app at http://127.0.0.1:1",
        });
        expect(showsKey(unreachable, key)).toBe(false);

        const proxy = createHttpServer((_request, response) => {
          response.writeHead(502, { "content-type": "text/plain" });
          response.end(`upstream said: ${"x".repeat(300)}`);
        });
        const proxyPort = await listen(proxy);
        try {
          const notJson = await caught(
            createEmailClient({
              baseUrl: `http://127.0.0.1:${String(proxyPort)}`,
              apiKey: key,
            }).listTemplates(),
          );
          expect(notJson).toMatchObject({ status: 502, code: "http_502" });
          expect(notJson instanceof Error ? notJson.message.length : 0).toBe(
            "The email app answered 502: ".length + 200,
          );
          expect(showsKey(notJson, key)).toBe(false);
        } finally {
          await close(proxy);
        }
      });
    });
  },
);
