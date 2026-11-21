import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const deployScript = resolve("ops/deploy-server.sh");
const stubbedCommands = ["git", "pnpm", "docker", "curl"] as const;

interface DeployRun {
  exitCode: number | null;
  calls: string[];
  stderr: string;
}

const directories: string[] = [];

/**
 * Runs the script with its commands stubbed: each records its call, `failingCall` exits 1, and a call named in
 * `outputs` prints that text.
 */
const runDeploy = async (
  failingCall?: string,
  outputs: Record<string, string> = {},
): Promise<DeployRun> => {
  const directory = await mkdtemp(join(tmpdir(), "deploy-server-"));
  directories.push(directory);
  const log = join(directory, "calls.log");
  await writeFile(log, "");
  for (const command of stubbedCommands) {
    const stub = join(directory, command);
    await writeFile(
      stub,
      [
        "#!/bin/sh",
        `call="${command} $*"`,
        `echo "$call" >> "${log}"`,
        `if [ "$call" = "${failingCall ?? ""}" ]; then exit 1; fi`,
        ...Object.entries(outputs).map(
          ([named, output]) =>
            `if [ "$call" = "${named}" ]; then echo "${output}"; fi`,
        ),
        "exit 0",
      ].join("\n"),
    );
    await chmod(stub, 0o755);
  }
  const result = spawnSync("sh", [deployScript], {
    env: { PATH: `${directory}:/usr/bin:/bin` },
    encoding: "utf8",
  });
  const calls = (await readFile(log, "utf8"))
    .split("\n")
    .filter((line) => line !== "");
  return { exitCode: result.status, calls, stderr: result.stderr };
};

const isStackChange = (call: string): boolean =>
  call.startsWith("docker compose up") || call === "docker compose build";

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ops/deploy-server.sh", () => {
  it("exits non-zero and leaves the running stack alone when the pull fails", async () => {
    const run = await runDeploy("git pull --ff-only origin main");

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("deploy.failed step=pull");
    expect(run.calls.filter((call) => call.startsWith("docker"))).toEqual([]);
  });

  it("refuses to deploy a checkout whose HEAD is not origin/main, such as one with a local commit", async () => {
    const run = await runDeploy(undefined, {
      "git rev-parse HEAD": "1111111111111111111111111111111111111111",
      "git rev-parse origin/main": "2222222222222222222222222222222222222222",
    });

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("deploy.failed step=pull");
    expect(run.stderr).toContain("is not origin/main");
    expect(run.calls.filter((call) => call.startsWith("docker"))).toEqual([]);
  });

  it("exits non-zero and leaves the running stack alone when the images fail to build", async () => {
    const run = await runDeploy("docker compose build");

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("deploy.failed step=build-images");
    expect(run.calls.filter(isStackChange)).toEqual(["docker compose build"]);
    expect(
      run.calls.filter((call) => call.startsWith("docker compose up")),
    ).toEqual([]);
  });

  it("exits non-zero without replacing any container when a migration fails", async () => {
    const run = await runDeploy("docker compose run --rm migrate");

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("deploy.failed step=migrate");
    expect(
      run.calls.filter((call) => call.startsWith("docker compose up")),
    ).toEqual([]);
  });

  it("exits non-zero when /health does not return 200 after the restart", async () => {
    const run = await runDeploy(
      "curl --fail --silent --show-error --retry 5 --retry-delay 2 --retry-all-errors http://127.0.0.1:4320/health",
    );

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("deploy.failed step=health");
  });

  it("pulls main, builds, migrates, restarts and checks /health in that order when everything passes, installing nothing and running no check on the host (#178)", async () => {
    const sha = "3333333333333333333333333333333333333333";
    const run = await runDeploy(undefined, {
      "git rev-parse HEAD": sha,
      "git rev-parse origin/main": sha,
    });

    expect(run.exitCode).toBe(0);
    expect(run.calls).toEqual([
      "git pull --ff-only origin main",
      "git rev-parse HEAD",
      "git rev-parse origin/main",
      "docker compose build",
      "docker compose run --rm migrate",
      "docker compose up -d --wait",
      "curl --fail --silent --show-error --retry 5 --retry-delay 2 --retry-all-errors http://127.0.0.1:4320/health",
    ]);
    expect(run.calls.filter((call) => call.startsWith("pnpm"))).toEqual([]);
  });
});
