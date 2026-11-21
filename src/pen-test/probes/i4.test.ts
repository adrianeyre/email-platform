/**
 * Pen test I4 (#106): containers, Compose, the published port and the networks. Answers H9 and H14. The findings note
 * is `docs/pen-test/findings/I4.md`. A confirmed gap was an `it.fails` for the property that should hold beside a
 * `today_…` test pinning what happened; once fixed, the `today_` test is a `(regression)` test and the `it.fails` a
 * plain `it`. A refuted probe is a plain passing test.
 *
 * These are static facts of production's own `docker-compose.yml`, `Dockerfile` and `backup/Dockerfile`, read with
 * `docker compose config` (placeholder values, `--env-file /dev/null`, so no real secret is loaded) and from the
 * Dockerfiles directly, with `docker-compose.pen-test.yml` merged on top for the services only it adds. The live
 * observations the note records — which host interfaces answer on the published port,
 * whether a host firewall's INPUT rules stop it, each container's user, capabilities, read-only root,
 * no-new-privileges and limits, the networks each container can reach, and the log driver's bound — were taken on the
 * E1 deployment with `docker inspect`, `docker exec` and a port probe, as `docs/pen-test/findings/I4.md` sets out;
 * they are not host-independent, so they are not asserted here.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);

interface ComposePort {
  target: number;
  published?: string;
  host_ip?: string;
  protocol?: string;
}

interface ComposeService {
  image?: string;
  build?: unknown;
  user?: string;
  ports?: ComposePort[];
  cap_drop?: string[] | null;
  cap_add?: string[] | null;
  read_only?: boolean | null;
  security_opt?: string[] | null;
  mem_limit?: number | string | null;
  pids_limit?: number | null;
  logging?: { driver?: string; options?: Record<string, unknown> } | null;
  networks?: Record<string, unknown>;
}

interface ComposeConfig {
  services: Record<string, ComposeService>;
  networks: Record<string, { internal?: boolean }>;
}

const isComposeConfig = (value: unknown): value is ComposeConfig =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "services") === "object" &&
  typeof Reflect.get(value, "networks") === "object";

const hasCompose = await run("docker", ["compose", "version"]).then(
  () => true,
  () => false,
);

if (!hasCompose) {
  console.warn(
    "SKIPPED src/pen-test/probes/i4.test.ts: docker compose is not available, so the Compose checks did not run",
  );
}

/**
 * Production's Compose config, with placeholder values and no `.env` read, so no real secret is loaded. `files` adds
 * overrides on top; `variables` sets more. API_BIND_ADDRESS is empty unless `variables` names one.
 */
const readComposeConfig = async ({
  files = [],
  variables = {},
}: {
  files?: string[];
  variables?: Record<string, string>;
} = {}): Promise<ComposeConfig> => {
  const { stdout } = await run(
    "docker",
    [
      "compose",
      "--env-file",
      "/dev/null",
      "-f",
      "docker-compose.yml",
      ...files.flatMap((file) => ["-f", file]),
      "--profile",
      "restore",
      "config",
      "--format",
      "json",
    ],
    {
      env: {
        ...process.env,
        // Empty is Compose's default, 127.0.0.1, whatever the shell has.
        API_BIND_ADDRESS: "",
        POSTGRES_PASSWORD: "i4-placeholder-postgres-password",
        DATABASE_MIGRATE_PASSWORD: "i4-placeholder-migrate-password",
        DATABASE_API_PASSWORD: "i4-placeholder-api-password",
        DATABASE_WORKER_PASSWORD: "i4-placeholder-worker-password",
        DATABASE_BACKUP_PASSWORD: "i4-placeholder-backup-password",
        APP_URL: "http://i4.pen-test.invalid:4320",
        ENCRYPTION_KEY: "i4-placeholder",
        BACKUP_AGE_RECIPIENT: "i4-placeholder",
        BACKUP_RCLONE_REMOTE: "i4:placeholder",
        BACKUP_RCLONE_CONFIG_FILE: "/dev/null",
        ...variables,
      },
    },
  );
  const parsed: unknown = JSON.parse(stdout);
  if (!isComposeConfig(parsed)) {
    throw new Error("docker compose config did not answer a Compose file");
  }
  return parsed;
};

/** The long-running services a compromise would land in. */
const longRunning = ["api", "worker", "postgres", "backup"];
/** The services that run once and exit. */
const oneShot = ["provision", "migrate", "restore"];

describe.skipIf(!hasCompose)(
  "pen test I4 (#106): the published port, container hardening and the networks",
  () => {
    let config: ComposeConfig;
    beforeAll(async () => {
      config = await readComposeConfig();
    }, 60_000);

    const service = (name: string): ComposeService => {
      const found = config.services[name];
      if (found === undefined) {
        throw new Error(`No ${name} service in the Compose file`);
      }
      return found;
    };

    /* Probe 1: the published port and the interfaces it answers on */

    // Rewritten from "api publishes 4320 on every host interface": the port now names a host_ip, loopback unless
    // API_BIND_ADDRESS names the LAN or tailnet address (#181).
    it("(regression) api publishes 4320 on loopback alone unless API_BIND_ADDRESS names the one interface to use (#181)", async () => {
      const ports = service("api").ports ?? [];
      expect(ports).toHaveLength(1);
      const [published] = ports;
      expect(published?.target).toBe(4320);
      expect(published?.published).toBe("4320");
      expect(published?.host_ip).toBe("127.0.0.1");

      const onLan = await readComposeConfig({
        variables: { API_BIND_ADDRESS: "192.0.2.10" },
      });
      expect(onLan.services.api?.ports?.map((port) => port.host_ip)).toEqual([
        "192.0.2.10",
      ]);
    }, 60_000);

    it("the published port is bound to a host interface, not every one, as ADR 0003 (LAN and tailnet only) asks", () => {
      const [published] = service("api").ports ?? [];
      expect(published?.host_ip).toBeDefined();
      expect(published?.host_ip).not.toBe("0.0.0.0");
    });

    it("(regression) the docs name API_BIND_ADDRESS and say a published port is filtered in DOCKER-USER, not INPUT (#181)", () => {
      const deploying = readFileSync("docs/operations/deploying.md", "utf8");
      expect(deploying).toContain("API_BIND_ADDRESS");
      expect(deploying).toContain("DOCKER-USER");
      expect(readFileSync(".env.example", "utf8")).toMatch(
        /^API_BIND_ADDRESS=/mu,
      );
    });

    /* Probe 2: each container's user, capabilities, read-only root, no-new-privileges and limits */

    // Rewritten from "no service drops a capability …": every service in the file, the one-shot ones too, now drops
    // every capability, adds none back, sets no-new-privileges, runs read-only and bounds its memory and PIDs (#182).
    it("(regression) every service drops every capability, adds none back, sets no-new-privileges, runs read-only and bounds memory and pids (#182)", () => {
      expect(Object.keys(config.services).sort()).toEqual(
        [...longRunning, ...oneShot].sort(),
      );
      for (const [name, svc] of Object.entries(config.services)) {
        expect(svc.cap_drop, name).toEqual(["ALL"]);
        expect(svc.cap_add ?? [], name).toEqual([]);
        expect(svc.security_opt, name).toEqual(["no-new-privileges:true"]);
        expect(svc.read_only, name).toBe(true);
        expect(svc.mem_limit, name).toBeTruthy();
        expect(svc.pids_limit, name).toBeGreaterThan(0);
      }
      // Postgres runs as postgres from the start, so its entrypoint needs no capability to chown or to drop to it.
      expect(service("postgres").user).toBe("postgres");
    });

    it("the app and backup images set a non-root USER in their Dockerfile (refuted for those two)", () => {
      expect(readFileSync("Dockerfile", "utf8")).toMatch(/^USER node$/mu);
      expect(readFileSync("backup/Dockerfile", "utf8")).toMatch(
        /^USER postgres$/mu,
      );
    });

    it("every long-running service drops all capabilities, runs read-only and sets no-new-privileges", () => {
      for (const name of longRunning) {
        const svc = service(name);
        expect(svc.cap_drop).toEqual(expect.arrayContaining(["ALL"]));
        expect(svc.read_only).toBe(true);
        expect(svc.security_opt ?? []).toEqual(
          expect.arrayContaining(["no-new-privileges:true"]),
        );
      }
    });

    it("(regression) the pen-test override's mailpit and entry (nginx) run as a non-root user, drop every capability and run read-only (#182)", async () => {
      const penTest = await readComposeConfig({
        files: ["docker-compose.pen-test.yml"],
      });
      for (const name of ["mailpit", "entry"]) {
        const svc = penTest.services[name];
        expect(svc?.user, name).toMatch(/^[1-9]\d*:[1-9]\d*$/u);
        expect(svc?.cap_drop, name).toEqual(["ALL"]);
        expect(svc?.cap_add ?? [], name).toEqual([]);
        expect(svc?.security_opt, name).toEqual(["no-new-privileges:true"]);
        expect(svc?.read_only, name).toBe(true);
        expect(svc?.mem_limit, name).toBeTruthy();
        expect(svc?.pids_limit, name).toBeGreaterThan(0);
      }
      // The one root container left is one-shot, on no network, and keeps only CHOWN to hand its folder over.
      expect(penTest.services["backup-stand-in-folder"]?.cap_add).toEqual([
        "CHOWN",
      ]);
    }, 60_000);

    /* Probe 3: every image and package named by tag rather than digest */

    const digestPinned = /^[\w./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/u;
    const dockerfileFroms = () =>
      [
        ...readFileSync("Dockerfile", "utf8").matchAll(/^FROM (\S+)/gmu),
        ...readFileSync("backup/Dockerfile", "utf8").matchAll(/^FROM (\S+)/gmu),
      ].map((match) => match[1] ?? "");

    // Rewritten from "every image in the Compose file is named by a mutable tag": the one image pulled is pinned by
    // digest, and email-platform:local is never pulled but built here, from a Dockerfile whose bases are (#183).
    it("(regression) the Compose file pulls only digest-pinned images, and builds email-platform:local from the pinned Dockerfile (#183)", () => {
      expect(service("postgres").image).toMatch(digestPinned);
      for (const name of ["provision", "migrate", "api", "worker"]) {
        expect(service(name).image, name).toBe("email-platform:local");
        expect(service(name).build, name).toBeDefined();
      }
      for (const name of ["backup", "restore"]) {
        expect(service(name).build, name).toBeDefined();
      }
    });

    it("(regression) the Dockerfiles pull base images by digest and apk-add age and rclone at a fixed version (#183)", () => {
      for (const image of dockerfileFroms()) {
        expect(image).toMatch(digestPinned);
      }
      expect(readFileSync("backup/Dockerfile", "utf8")).toMatch(
        /^RUN apk add --no-cache age=\d[\w.-]* rclone=\d[\w.-]*$/mu,
      );
    });

    // Every image is pulled by digest or built here from a Dockerfile whose bases are; email-platform:local and the
    // backup image are the second kind, so they are checked through their Dockerfiles' FROM lines.
    it("every image the Compose file and Dockerfiles name is pinned by digest", async () => {
      const penTest = await readComposeConfig({
        files: ["docker-compose.pen-test.yml"],
      });
      const pulled = [
        ...Object.values(config.services),
        ...Object.values(penTest.services),
      ]
        .filter((svc) => svc.build === undefined)
        .map((svc) => svc.image ?? "");
      const dev = [
        ...readFileSync("docker-compose.dev.yml", "utf8").matchAll(
          /^\s+image: (\S+)$/gmu,
        ),
      ].map((match) => match[1] ?? "");
      expect(pulled.length).toBeGreaterThan(0);
      expect(dev).toHaveLength(2);
      for (const image of [...pulled, ...dev, ...dockerfileFroms()]) {
        expect(image).toMatch(digestPinned);
      }
    }, 60_000);

    /* Probe 4: the container log driver's bound */

    it("(regression) every long-running service pins the json-file driver to three 10 MB files, whatever the host's default (#126)", () => {
      for (const name of longRunning) {
        expect(service(name).logging, name).toEqual({
          driver: "json-file",
          options: { "max-size": "10m", "max-file": "3" },
        });
      }
    });

    it("the api service bounds its container log with a driver and a size limit (see also D2 #126)", () => {
      const logging = service("api").logging;
      expect(logging).not.toBeNull();
      expect(Object.keys(logging?.options ?? {})).toContain("max-size");
    });

    /* Probe 5: which containers can reach which networks, and which have a way out (see D1 #139) */

    const hasWayOut = (svc: ComposeService) =>
      Object.keys(svc.networks ?? {}).some(
        (network) => config.networks[network]?.internal !== true,
      );

    it("(regression) api, worker, backup and restore sit on the non-internal default network, which in production reaches the LAN and the internet, and migrate does not (#139)", () => {
      expect(config.networks.default?.internal).not.toBe(true);
      expect(config.networks.database?.internal).toBe(true);
      for (const name of ["api", "worker", "backup", "restore"]) {
        expect(hasWayOut(service(name)), name).toBe(true);
      }
      expect(Object.keys(service("migrate").networks ?? {})).toEqual([
        "database",
      ]);
    });

    it("a service that only needs Postgres (migrate) has no way out (filed under D1 #139)", () => {
      expect(hasWayOut(service("migrate"))).toBe(false);
    });
  },
);
