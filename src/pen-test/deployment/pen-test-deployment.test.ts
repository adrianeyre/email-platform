import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  composeArguments,
  dockerEnvironment,
  placeholderDatabasePasswords,
  renderEnvFile,
  standInRcloneConfig,
} from "./pen-test-deployment.js";
import { penTestProjectName, penTestStateDirectory } from "./project.js";

const hasDockerCompose =
  spawnSync("docker", ["compose", "version"], { encoding: "utf8" }).status ===
  0;

if (!hasDockerCompose) {
  console.warn(
    "SKIPPED the merged pen-test Compose checks in src/pen-test/deployment/pen-test-deployment.test.ts: docker compose is not installed",
  );
}

describe("standing up the pen-test deployment (E1, #87)", () => {
  it("always names its own project, its own .env and both Compose files, never the root .env", () => {
    const args = composeArguments();
    expect(args.slice(0, 3)).toEqual([
      "compose",
      "--project-name",
      penTestProjectName,
    ]);
    expect(args[args.indexOf("--env-file") + 1]).toMatch(
      new RegExp(`/${penTestStateDirectory.replace(".", "\\.")}/\\.env$`, "u"),
    );
    expect(args.filter((arg) => arg.endsWith(".yml"))).toEqual([
      "docker-compose.yml",
      "docker-compose.pen-test.yml",
    ]);
  });

  it("gives Docker only the variables its client needs, so no exported secret reaches Compose", () => {
    const environment = dockerEnvironment({
      PATH: "/usr/bin",
      HOME: "/home/tester",
      DOCKER_HOST: "unix:///var/run/docker.sock",
      POSTGRES_PASSWORD: "production",
      ENCRYPTION_KEY: "production",
      BACKUP_RCLONE_REMOTE: "b2:email-backups",
      GITHUB_TOKEN: "production",
    });
    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/tester",
      DOCKER_HOST: "unix:///var/run/docker.sock",
    });
  });

  it("writes an .env of generated secrets and throwaway backup targets only", () => {
    const content = renderEnvFile({
      postgresPassword: "generated",
      databasePasswords: {
        migrate: "generated-migrate",
        api: "generated-api",
        worker: "generated-worker",
        backup: "generated-backup",
      },
      encryptionKey: "generated-key",
      ageRecipient: "age1generated",
    });
    expect(content).toContain(
      "BACKUP_RCLONE_REMOTE=stand-in:/srv/backup-stand-in/email-platform",
    );
    expect(content).toContain(
      `BACKUP_RCLONE_CONFIG_FILE=./${penTestStateDirectory}/rclone.conf`,
    );
    expect(content).toContain(
      `BACKUP_AGE_IDENTITY_FILE=./${penTestStateDirectory}/age-identity.txt`,
    );
    expect(content).toContain("APP_URL=http://localhost:43320");
    // A password of its own for each container's role (#121, #138).
    expect(content).toContain("DATABASE_MIGRATE_PASSWORD=generated-migrate");
    expect(content).toContain("DATABASE_API_PASSWORD=generated-api");
    expect(content).toContain("DATABASE_WORKER_PASSWORD=generated-worker");
    expect(content).toContain("DATABASE_BACKUP_PASSWORD=generated-backup");
    expect(content).not.toContain("BwcHBwc");
    expect(standInRcloneConfig).toBe("[stand-in]\ntype = local\n");
  });
});

interface ComposeService {
  image?: string;
  ports?: { host_ip?: string; published?: string; target: number }[];
  networks?: Record<string, unknown> | null;
  network_mode?: string;
  environment?: Record<string, string | null>;
  volumes?: { type: string; source?: string; target: string }[];
  profiles?: string[];
}

interface ComposeConfig {
  name: string;
  services: Record<string, ComposeService>;
  networks: Record<
    string,
    { internal?: boolean; driver_opts?: Record<string, string> }
  >;
}

const isComposeConfig = (value: unknown): value is ComposeConfig =>
  typeof value === "object" &&
  value !== null &&
  "services" in value &&
  "networks" in value;

describe.skipIf(!hasDockerCompose)(
  "the merged pen-test Compose configuration (E1, #87)",
  () => {
    let directory: string;
    let config: ComposeConfig;

    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), "pen-test-compose-"));
      const environmentFile = join(directory, ".env");
      await writeFile(
        environmentFile,
        renderEnvFile({
          postgresPassword: "placeholder",
          databasePasswords: placeholderDatabasePasswords("placeholder"),
          encryptionKey: "placeholder",
          ageRecipient: "age1placeholder",
        }),
      );
      const result = spawnSync(
        "docker",
        [
          ...composeArguments(environmentFile),
          "--profile",
          "restore",
          "config",
          "--format",
          "json",
        ],
        { encoding: "utf8", env: dockerEnvironment() },
      );
      expect(result.status, result.stderr).toBe(0);
      const parsed: unknown = JSON.parse(result.stdout);
      if (!isComposeConfig(parsed)) {
        throw new Error("docker compose config gave something unexpected");
      }
      config = parsed;
    });

    afterAll(async () => {
      await rm(directory, { recursive: true, force: true });
    });

    const networksOf = (service: ComposeService) =>
      Object.keys(service.networks ?? {});

    it("is its own Compose project with its own app image, never production's", () => {
      expect(config.name).toBe(penTestProjectName);
      for (const name of ["api", "worker", "migrate", "provision"]) {
        expect(config.services[name]?.image).toBe(
          "email-platform-pen-test:local",
        );
      }
    });

    it("has one network that isn't internal, holding only the entry proxy, which doesn't masquerade", () => {
      const open = Object.entries(config.networks)
        .filter(([, network]) => network.internal !== true)
        .map(([name]) => name);
      expect(open).toEqual(["entry"]);
      expect(config.networks.entry?.driver_opts).toEqual({
        "com.docker.network.bridge.enable_ip_masquerade": "false",
      });
      const onEntry = Object.entries(config.services)
        .filter(([, service]) => networksOf(service).includes("entry"))
        .map(([name]) => name);
      expect(onEntry).toEqual(["entry"]);
    });

    it("publishes ports from the entry proxy only, and on 127.0.0.1 only", () => {
      const published = Object.entries(config.services).flatMap(
        ([name, service]) =>
          (service.ports ?? []).map(
            (port) =>
              `${name} ${port.host_ip ?? "0.0.0.0"}:${port.published ?? ""}`,
          ),
      );
      expect(published.toSorted()).toEqual([
        "entry 127.0.0.1:43320",
        "entry 127.0.0.1:43325",
      ]);
    });

    it("sends email to Mailpit on an internal network, and backups to a volume of its own", () => {
      expect(networksOf(config.services.mailpit ?? {})).toEqual(["default"]);
      expect(config.networks.default?.internal).toBe(true);
      const backup = config.services.backup ?? {};
      expect(backup.environment?.BACKUP_RCLONE_REMOTE).toBe(
        "stand-in:/srv/backup-stand-in/email-platform",
      );
      const hostMounts = Object.entries(config.services).flatMap(
        ([name, service]) =>
          (service.volumes ?? [])
            .filter((volume) => volume.type === "bind")
            .map((volume) => `${name} ${volume.source ?? ""}`),
      );
      // The only files mounted from the host are the deployment's own throwaway rclone.conf and age identity.
      for (const mount of hostMounts) {
        expect(mount).toMatch(
          new RegExp(
            `/${penTestStateDirectory.replace(".", "\\.")}/(rclone\\.conf|age-identity\\.txt)$`,
            "u",
          ),
        );
      }
    });

    it("tells the app it is the pen-test deployment, so the fixture loader runs there and nowhere else", () => {
      for (const name of ["api", "worker", "migrate"]) {
        expect(config.services[name]?.environment?.PEN_TEST_DEPLOYMENT).toBe(
          penTestProjectName,
        );
      }
    });
  },
);
