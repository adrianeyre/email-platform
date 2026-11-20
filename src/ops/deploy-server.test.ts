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

const runDeploy = async (failingCall?: string): Promise<DeployRun> => {
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

describe("pnpm deploy:server", () => {
  it("exits non-zero and leaves the running stack alone when the tests fail", async () => {
    const run = await runDeploy("pnpm test");

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("deploy.failed step=test");
    expect(run.calls.filter(isStackChange)).toEqual([]);
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

  it("pulls, checks, builds, migrates, restarts and checks /health in that order when everything passes", async () => {
    const run = await runDeploy();

    expect(run.exitCode).toBe(0);
    expect(run.calls).toEqual([
      "git pull --ff-only",
      "pnpm install --frozen-lockfile",
      "pnpm run typecheck",
      "pnpm run lint",
      "pnpm test",
      "docker compose build",
      "docker compose run --rm migrate",
      "docker compose up -d --wait",
      "curl --fail --silent --show-error --retry 5 --retry-delay 2 --retry-all-errors http://127.0.0.1:4320/health",
    ]);
  });
});
