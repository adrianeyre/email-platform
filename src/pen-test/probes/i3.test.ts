/**
 * Pen test I3 (#105): secrets and fail-closed configuration. Answers H10. The findings note is
 * `docs/pen-test/findings/I3.md`. A confirmed gap is an `it.fails` for the property that should hold beside a `today_…`
 * test pinning what happens now; a refuted probe is a plain passing test.
 *
 * Three ways in:
 *
 * - the config parser, `loadVars`, driven in-process with `vi.stubEnv`;
 * - the real entrypoint, `src/index.ts`, started with tsx as a child process (the `api`, `worker`, `migrate` and `cli`
 *   roles), with an environment built from nothing so vitest's own variables don't leak in, against the probe world's
 *   Postgres or a Postgres of its own made as Compose makes production's;
 * - `docker compose config`, with `--env-file /dev/null` and placeholder values, so no real `.env` is read.
 *
 * The probe world seals the SMTP password with a random key; "changing ENCRYPTION_KEY" is a second server, and a real
 * worker, started with another key against the same database.
 */
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { runCliCommand } from "../../access/cli.js";
import { buildHttpServer } from "../../api/http-server.js";
import { loadProvisionVars, loadVars } from "../../config/vars.js";
import type { Server } from "../../lib/http.js";
import { buildJobQueue, sendMessageRetryLimit } from "../../lib/jobs.js";
import { messages, settings } from "../../lib/schema.js";
import { decryptValue, encryptValue } from "../../lib/secrets.js";
import { sendEmailOverSmtp } from "../../sending/delivery.js";
import {
  sendQueuedMessage,
  SendWillBeRetriedError,
} from "../../sending/send-worker.js";
import {
  hasContainerRuntime,
  postgresImage,
  postgresUser,
  probeAppUrl,
  startProbeWorld,
  warnIfSkipped,
  type ProbeWorld,
} from "./probe-world.js";

warnIfSkipped("src/pen-test/probes/i3.test.ts");

const run = promisify(execFile);

/** `.env.example`'s key as it was committed until #165: 32 bytes of 0x07. `.env.example` now leaves it empty. */
const exampleEncryptionKey = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
/** A database password that clears the floor (#166), for the roles `provision` is given. */
const strongRolePassword = "0123456789abcdef".repeat(4);
const requiredAppVariables = [
  "DATABASE_URL",
  "APP_URL",
  "ENCRYPTION_KEY",
] as const;
const roles = ["api", "worker", "migrate", "cli"] as const;
type Role = (typeof roles)[number];

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const tsxBinary = join(repositoryRoot, "node_modules/.bin/tsx");
const entrypoint = join(repositoryRoot, "src/index.ts");

/* ---------- The config parser ---------- */

describe("pen test I3 (#105): the config parser, loadVars", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to load with any required variable unset or empty, naming it (refuted)", () => {
    for (const name of requiredAppVariables) {
      vi.stubEnv(name, "");
      expect(() => loadVars()).toThrow(`${name} must be set`);
      vi.unstubAllEnvs();
      vi.stubEnv(name, undefined);
      expect(() => loadVars()).toThrow(`${name} must be set`);
      vi.unstubAllEnvs();
    }
  });

  it("falls back to 4320 when PORT is unset, as documented (refuted)", () => {
    vi.stubEnv("PORT", undefined);
    expect(loadVars().port).toBe(4320);
  });

  it("refuses a whitespace or one-character ENCRYPTION_KEY and APP_URL by name, and never echoes the key (refuted)", () => {
    for (const value of [" ", "\t", "x"]) {
      vi.stubEnv("ENCRYPTION_KEY", value);
      expect(() => loadVars()).toThrow(
        /^ENCRYPTION_KEY must be 32 bytes encoded as base64$/u,
      );
      vi.unstubAllEnvs();
      vi.stubEnv("APP_URL", value);
      expect(() => loadVars()).toThrow(/^APP_URL must be a URL/u);
      vi.unstubAllEnvs();
    }
  });

  it("(regression) refuses .env.example's old ENCRYPTION_KEY, 32 bytes of 0x07, and an all-zero key, by name; .env.example now has none (#165)", async () => {
    for (const key of [
      exampleEncryptionKey,
      Buffer.alloc(32).toString("base64"),
    ]) {
      vi.stubEnv("ENCRYPTION_KEY", key);
      expect(() => loadVars()).toThrow(
        /^ENCRYPTION_KEY must be 32 random bytes, not one byte repeated/u,
      );
    }
    const example = await readFile(
      join(repositoryRoot, ".env.example"),
      "utf8",
    );
    const committed = /^ENCRYPTION_KEY=(.*)$/mu.exec(example)?.[1];
    expect(committed).toBe("");
    vi.stubEnv("ENCRYPTION_KEY", committed);
    expect(() => loadVars()).toThrow("ENCRYPTION_KEY must be set");
  });

  it("refuses .env.example's ENCRYPTION_KEY, or any key of one repeated byte", () => {
    vi.stubEnv("ENCRYPTION_KEY", exampleEncryptionKey);
    expect(() => loadVars()).toThrow(/ENCRYPTION_KEY/u);
    for (const byte of [0x00, 0x01, 0x7f, 0xff]) {
      vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, byte).toString("base64"));
      expect(() => loadVars()).toThrow(/ENCRYPTION_KEY/u);
    }
  });

  it("(regression) takes an http: APP_URL, ADR 0003's decision until the condition it records, but refuses javascript: and ftp: by name (#168)", () => {
    vi.stubEnv("APP_URL", "http://email.example.com:4320");
    expect(loadVars().appUrl.href).toBe("http://email.example.com:4320/");
    for (const value of ["javascript:alert(1)", "ftp://email.home"]) {
      vi.stubEnv("APP_URL", value);
      expect(() => loadVars()).toThrow(
        `APP_URL must be an http: or https: URL, not "${value}"`,
      );
    }
  });

  // Rewritten from "refuses an APP_URL that is not https:": #168's Expected is either that, or ADR 0003 recording when
  // its plain-HTTP decision stops being true. The fix takes the second, and refuses every scheme but http: and https:.
  it("refuses an APP_URL that is not http: or https:, and ADR 0003 records when its plain-HTTP decision expires", async () => {
    for (const value of [
      "javascript:alert(1)",
      "ftp://email.home",
      "data:,x",
    ]) {
      vi.stubEnv("APP_URL", value);
      expect(() => loadVars()).toThrow(/APP_URL/u);
    }
    const adr = await readFile(
      join(
        repositoryRoot,
        "docs/architectural-decision-record/0003-self-hosted-on-a-home-server-with-docker-compose.md",
      ),
      "utf8",
    );
    expect(adr).toMatch(/^## When plain HTTP stops being acceptable$/mu);
    expect(adr).toMatch(/Review by: \d{1,2} \w+ \d{4}/u);
  });

  it("(regression) refuses a whitespace DATABASE_URL, and a whitespace PORT, rather than reading it as 0 (#169)", () => {
    vi.stubEnv("DATABASE_URL", " ");
    expect(() => loadVars()).toThrow("DATABASE_URL must be a postgres:// URL");
    vi.unstubAllEnvs();
    vi.stubEnv("PORT", " ");
    expect(() => loadVars()).toThrow('PORT must be a whole number, not " "');
  });

  it("refuses a whitespace DATABASE_URL or PORT by name", () => {
    vi.stubEnv("PORT", " ");
    expect(() => loadVars()).toThrow(/PORT/u);
    vi.unstubAllEnvs();
    vi.stubEnv("DATABASE_URL", " ");
    expect(() => loadVars()).toThrow(/DATABASE_URL/u);
  });
});

/* ---------- The sealed SMTP password's format ---------- */

describe("pen test I3 (#105): the sealed format", () => {
  const key = randomBytes(32);
  const split = (sealed: string) => {
    const [version, iv, tag, ciphertext] = sealed.split(".");
    return {
      version,
      iv: Buffer.from(iv ?? "", "base64url"),
      tag: Buffer.from(tag ?? "", "base64url"),
      ciphertext: Buffer.from(ciphertext ?? "", "base64url"),
    };
  };
  const join4 = (
    version: string | undefined,
    iv: Buffer,
    tag: Buffer,
    ciphertext: Buffer,
  ) =>
    [
      version,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");

  it("seals with a fresh 12-byte IV every time: 10,000 seals of one password reuse none (refuted)", () => {
    const ivs = new Set<string>();
    for (let index = 0; index < 10_000; index += 1) {
      const { iv } = split(encryptValue(key, "the same password"));
      expect(iv).toHaveLength(12);
      ivs.add(iv.toString("hex"));
    }
    expect(ivs.size).toBe(10_000);
  });

  it("writes a full 16-byte GCM tag (refuted)", () => {
    expect(split(encryptValue(key, "password")).tag).toHaveLength(16);
  });

  it("refuses a tag truncated to 12, 8, 4, 1 or 0 bytes, and a flipped ciphertext bit (refuted)", () => {
    const sealed = split(encryptValue(key, "password"));
    for (const length of [15, 12, 8, 4, 1, 0]) {
      expect(() =>
        decryptValue(
          key,
          join4(
            sealed.version,
            sealed.iv,
            sealed.tag.subarray(0, length),
            sealed.ciphertext,
          ),
        ),
      ).toThrow();
    }
    const flipped = Buffer.from(sealed.ciphertext);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() =>
      decryptValue(key, join4(sealed.version, sealed.iv, sealed.tag, flipped)),
    ).toThrow();
    expect(
      decryptValue(
        key,
        join4(sealed.version, sealed.iv, sealed.tag, sealed.ciphertext),
      ),
    ).toBe("password");
  });

  it("refuses the right ciphertext under another key (refuted)", () => {
    expect(() =>
      decryptValue(randomBytes(32), encryptValue(key, "password")),
    ).toThrow("Unsupported state or unable to authenticate data");
  });
});

/* ---------- The real entrypoint, as a child process ---------- */

interface Exited {
  kind: "exited";
  code: number | null;
  stdout: string;
  stderr: string;
}

interface Running {
  kind: "running";
  stdout: () => string;
  stderr: () => string;
  stop: () => Promise<void>;
}

/** An environment built from nothing but what tsx and Docker need, plus `vars`. */
const childEnvironment = (
  vars: Record<string, string | undefined>,
): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
  };
  for (const [name, value] of Object.entries(vars)) {
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  return environment;
};

const freePort = (): Promise<number> =>
  new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => {
        resolvePort(port);
      });
    });
  });

/**
 * Starts `tsx src/index.ts <role>` and answers when it exits, or when `isReady` says it has started. `cwd` holds a stub
 * `dist/ui/index.html`, which the `api` role reads at boot, and a link to `src/drizzle`, which `migrate` reads.
 */
const startEntrypoint = (
  role: Role | "provision",
  vars: Record<string, string | undefined>,
  {
    cwd,
    isReady = () => Promise.resolve(false),
    timeoutMs = 60_000,
  }: {
    cwd: string;
    isReady?: (stdout: string) => Promise<boolean>;
    timeoutMs?: number;
  },
): Promise<Exited | Running> =>
  new Promise((resolveStart, rejectStart) => {
    const child = spawn(
      tsxBinary,
      ["--tsconfig", join(repositoryRoot, "tsconfig.json"), entrypoint, role],
      { cwd, env: childEnvironment(vars), stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let isSettled = false;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const exited = new Promise<void>((resolveExit) => {
      child.once("exit", () => {
        resolveExit();
      });
    });
    const stop = async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    };
    const settle = (value: Exited | Running) => {
      if (!isSettled) {
        isSettled = true;
        clearInterval(poll);
        clearTimeout(timer);
        resolveStart(value);
      }
    };
    child.once("exit", (code) => {
      settle({ kind: "exited", code, stdout, stderr });
    });
    const poll = setInterval(() => {
      void isReady(stdout).then((isStarted) => {
        if (isStarted) {
          settle({
            kind: "running",
            stdout: () => stdout,
            stderr: () => stderr,
            stop,
          });
        }
      });
    }, 250);
    const timer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        clearInterval(poll);
        void stop().then(() => {
          rejectStart(
            new Error(
              `${role} neither exited nor started in ${String(timeoutMs)} ms:\n${stdout}\n${stderr}`,
            ),
          );
        });
      }
    }, timeoutMs);
  });

const isHealthy = (port: number) => async (): Promise<boolean> => {
  try {
    return (await fetch(`http://127.0.0.1:${String(port)}/health`)).ok;
  } catch {
    return false;
  }
};

const hasLogged = (event: string) => (stdout: string) =>
  Promise.resolve(stdout.includes(`"event":"${event}"`));

const refusalOf = (
  outcome: Exited | Running,
): { code: number | null; stderr: string } | "started" =>
  outcome.kind === "exited"
    ? { code: outcome.code, stderr: outcome.stderr }
    : "started";

describe.skipIf(!hasContainerRuntime)(
  "pen test I3 (#105): the real entrypoint, against a real Postgres",
  () => {
    let world: ProbeWorld;
    let cwd: string;
    // The owner's login: testcontainers gives the superuser the password "test", which the floor refuses (#166).
    const appVars = (overrides: Record<string, string | undefined> = {}) => ({
      DATABASE_URL: world.databaseUrls.migrate,
      APP_URL: probeAppUrl.href,
      ENCRYPTION_KEY: world.encryptionKey.toString("base64"),
      ...overrides,
    });

    beforeAll(async () => {
      world = await startProbeWorld();
      cwd = await mkdtemp(join(tmpdir(), "i3-entrypoint-"));
      await mkdir(join(cwd, "dist/ui"), { recursive: true });
      await writeFile(
        join(cwd, "dist/ui/index.html"),
        "<!doctype html><title>i3</title>",
      );
      // Migrations are read from `src/drizzle` under the working directory, as in the image.
      await mkdir(join(cwd, "src"), { recursive: true });
      await symlink(
        join(repositoryRoot, "src/drizzle"),
        join(cwd, "src/drizzle"),
      );
    }, 300_000);
    afterAll(async () => {
      await world.stop();
      await rm(cwd, { recursive: true, force: true });
    });

    /* Probe 1: unset each variable the app reads, in turn */

    it("every role refuses to start with DATABASE_URL, APP_URL or ENCRYPTION_KEY unset, naming it, exit 1 (refuted)", async () => {
      const refusals: string[] = [];
      for (const name of requiredAppVariables) {
        for (const role of roles) {
          const outcome = refusalOf(
            await startEntrypoint(role, appVars({ [name]: undefined }), {
              cwd,
            }),
          );
          expect(outcome).not.toBe("started");
          if (outcome !== "started") {
            expect(outcome.code).toBe(1);
            expect(outcome.stderr).toContain(`Error: ${name} must be set`);
            refusals.push(`${role}:${name}`);
          }
        }
      }
      expect(refusals).toHaveLength(12);
    }, 240_000);

    it("refuses a wrong-length ENCRYPTION_KEY by name without printing the value (refuted)", async () => {
      const wrongKey = randomBytes(16).toString("base64");
      const outcome = refusalOf(
        await startEntrypoint(
          "migrate",
          appVars({ ENCRYPTION_KEY: wrongKey }),
          {
            cwd,
          },
        ),
      );
      expect(outcome).not.toBe("started");
      if (outcome !== "started") {
        expect(outcome.stderr).toContain(
          "ENCRYPTION_KEY must be 32 bytes encoded as base64",
        );
        expect(outcome.stderr).not.toContain(wrongKey);
      }
    }, 60_000);

    it("(regression) a whitespace DATABASE_URL is refused by the parser, naming DATABASE_URL, before connecting (#169)", async () => {
      const outcome = refusalOf(
        await startEntrypoint("migrate", appVars({ DATABASE_URL: " " }), {
          cwd,
        }),
      );
      expect(outcome).not.toBe("started");
      if (outcome !== "started") {
        expect(outcome.code).toBe(1);
        expect(outcome.stderr).toContain(
          "Error: DATABASE_URL must be a postgres:// URL",
        );
      }
    }, 60_000);

    /* Probe 2: weak values */

    it("(regression) migrate, api and worker each refuse .env.example's old ENCRYPTION_KEY, and an all-zero key, naming it, so nothing is sealed with either (#165)", async () => {
      const sealedBefore = await world.database
        .select({ sealed: settings.smtpPasswordEncrypted })
        .from(settings)
        .where(eq(settings.id, 1));
      for (const key of [
        exampleEncryptionKey,
        Buffer.alloc(32).toString("base64"),
      ]) {
        for (const role of ["migrate", "worker", "api"] as const) {
          const port = await freePort();
          const outcome = refusalOf(
            await startEntrypoint(
              role,
              appVars({ ENCRYPTION_KEY: key, PORT: String(port) }),
              {
                cwd,
                isReady:
                  role === "api"
                    ? isHealthy(port)
                    : hasLogged("worker.started"),
              },
            ),
          );
          expect(outcome, role).not.toBe("started");
          if (outcome !== "started") {
            expect(outcome.code).toBe(1);
            expect(outcome.stderr).toContain(
              "Error: ENCRYPTION_KEY must be 32 random bytes, not one byte repeated",
            );
            expect(outcome.stderr).not.toContain(key);
          }
        }
      }
      expect(
        await world.database
          .select({ sealed: settings.smtpPasswordEncrypted })
          .from(settings)
          .where(eq(settings.id, 1)),
      ).toEqual(sealedBefore);
    }, 240_000);

    it("migrate refuses to start with .env.example's ENCRYPTION_KEY", async () => {
      const outcome = refusalOf(
        await startEntrypoint(
          "migrate",
          appVars({ ENCRYPTION_KEY: exampleEncryptionKey }),
          { cwd },
        ),
      );
      expect(outcome).not.toBe("started");
      if (outcome !== "started") {
        expect(outcome.code).not.toBe(0);
        expect(outcome.stderr).toContain("ENCRYPTION_KEY");
      }
    }, 60_000);

    it("(regression) the api starts with an http: APP_URL, ADR 0003's decision until the condition it records (#168)", async () => {
      const port = await freePort();
      const api = await startEntrypoint(
        "api",
        appVars({
          APP_URL: "http://email.example.com:4320",
          PORT: String(port),
        }),
        { cwd, isReady: isHealthy(port) },
      );
      expect(api.kind).toBe("running");
      if (api.kind === "running") {
        await api.stop();
      }
    }, 90_000);

    // Rewritten from "the api refuses to start with an http: APP_URL": #168 is answered by refusing every scheme but
    // http: and https:, and by ADR 0003 recording when its plain-HTTP decision expires (see the parser's test above).
    it("the api refuses to start with an APP_URL that is not http: or https:, naming it", async () => {
      for (const value of ["ftp://email.example.com", "javascript:alert(1)"]) {
        const port = await freePort();
        const api = await startEntrypoint(
          "api",
          appVars({ APP_URL: value, PORT: String(port) }),
          { cwd, isReady: isHealthy(port) },
        );
        if (api.kind === "running") {
          await api.stop();
        }
        expect(api).toMatchObject({ kind: "exited", code: 1 });
        expect(api.kind === "exited" ? api.stderr : "").toContain(
          "Error: APP_URL must be an http: or https: URL",
        );
      }
    }, 120_000);

    describe("a Postgres made with a one-character or whitespace POSTGRES_PASSWORD", () => {
      const weakPasswords = ["x", " "] as const;
      const urls = new Map<string, string>();
      const containers: { stop: () => Promise<unknown> }[] = [];

      beforeAll(async () => {
        for (const password of weakPasswords) {
          const container = await new PostgreSqlContainer(postgresImage)
            .withUsername(postgresUser)
            .withDatabase(postgresUser)
            .withPassword(password)
            .start();
          containers.push(container);
          // As docker-compose.yml:8 builds it: the password substituted as is.
          urls.set(
            password,
            `postgres://${postgresUser}:${password}@${container.getHost()}:${String(container.getPort())}/${postgresUser}`,
          );
        }
      }, 300_000);
      afterAll(async () => {
        await Promise.all(containers.map((container) => container.stop()));
      });

      it("(regression) migrate and the api refuse a Postgres password of one character, or one space, naming DATABASE_URL and never showing it (#166)", async () => {
        for (const password of weakPasswords) {
          const vars = appVars({ DATABASE_URL: urls.get(password) });
          const migrated = refusalOf(
            await startEntrypoint("migrate", vars, { cwd }),
          );
          const port = await freePort();
          const api = refusalOf(
            await startEntrypoint(
              "api",
              { ...vars, PORT: String(port) },
              { cwd, isReady: isHealthy(port) },
            ),
          );
          for (const outcome of [migrated, api]) {
            expect(outcome).not.toBe("started");
            if (outcome !== "started") {
              expect(outcome.code).toBe(1);
              expect(outcome.stderr).toMatch(
                /Error: (The password in DATABASE_URL must be at least 16 characters|DATABASE_URL must have no whitespace in it)/u,
              );
              expect(outcome.stderr).not.toContain(urls.get(password));
            }
          }
        }
      }, 240_000);

      it("the stack refuses to start on a one-character or whitespace POSTGRES_PASSWORD", async () => {
        const outcome = await startEntrypoint(
          "migrate",
          appVars({ DATABASE_URL: urls.get("x") }),
          { cwd },
        );
        expect(outcome).toMatchObject({ kind: "exited" });
        expect(outcome).not.toMatchObject({ code: 0 });
      }, 120_000);

      it("provision, which every other app container waits on, refuses a one-character or whitespace POSTGRES_PASSWORD by name (#166)", async () => {
        for (const password of weakPasswords) {
          const outcome = refusalOf(
            await startEntrypoint(
              "provision",
              {
                DATABASE_URL: urls.get(password),
                DATABASE_MIGRATE_PASSWORD: strongRolePassword,
                DATABASE_API_PASSWORD: strongRolePassword,
                DATABASE_WORKER_PASSWORD: strongRolePassword,
                DATABASE_BACKUP_PASSWORD: strongRolePassword,
              },
              { cwd },
            ),
          );
          expect(outcome).not.toBe("started");
          if (outcome !== "started") {
            expect(outcome.code).toBe(1);
            expect(outcome.stderr).toContain("POSTGRES_PASSWORD");
          }
        }
      }, 120_000);
    });

    /* Probe 3: change ENCRYPTION_KEY on a running install */

    describe("ENCRYPTION_KEY changed under a sealed SMTP password", () => {
      const otherKey = randomBytes(32);
      let rotated: Server;
      let cookie: string;

      const queueMessage = async (subject: string): Promise<string> => {
        const response = await world.request(
          { key: "wizzaroo" },
          {
            method: "POST",
            url: "/v1/messages",
            payload: {
              to: ["parent1@families.pen-test.invalid"],
              subject,
              text: "I3 key rotation probe",
            },
          },
        );
        expect(response.statusCode).toBe(202);
        const body: unknown = response.json();
        const id: unknown =
          typeof body === "object" && body !== null
            ? Reflect.get(body, "id")
            : undefined;
        if (typeof id !== "string") {
          throw new Error(`No Message id in ${response.body}`);
        }
        return id;
      };

      const readMessage = async (id: string) => {
        const [row] = await world.database
          .select({
            status: messages.status,
            attempts: messages.attempts,
            error: messages.error,
          })
          .from(messages)
          .where(eq(messages.id, id));
        return row;
      };

      beforeAll(async () => {
        await world.reloadFixtures();
        await world.clearMail();
        rotated = await buildHttpServer({
          database: world.database,
          jobs: buildJobQueue(world.boss),
          appUrl: probeAppUrl,
          encryptionKey: otherKey,
          sendEmail: sendEmailOverSmtp,
          uiDirectory: undefined,
          isLogging: false,
        });
        cookie = `session=${await world.signIn("victim")}`;
      }, 60_000);
      afterAll(async () => {
        await rotated.close();
        await world.reloadFixtures();
      });

      it("the old key still sends through Mailpit (the control)", async () => {
        const id = await queueMessage("I3 control");
        await expect(world.deliver(id)).resolves.toBe("sent");
        await world.clearMail();
      });

      it("(regression) the settings page, under the new key, says the saved SMTP password can't be read; under the old key, that it can (#167)", async () => {
        const response = await rotated.inject({
          method: "GET",
          url: "/app/settings",
          headers: { cookie },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          hasSmtpPassword: true,
          isSmtpPasswordUnreadable: true,
        });
        const underOldKey = await world.request(
          { user: "victim" },
          { method: "GET", url: "/app/settings" },
        );
        expect(underOldKey.json()).toMatchObject({
          hasSmtpPassword: true,
          isSmtpPasswordUnreadable: false,
        });
      });

      it("(regression) Send a test email, under the new key, answers 409 smtp_password_unreadable naming ENCRYPTION_KEY, and sends nothing (#167)", async () => {
        const response = await rotated.inject({
          method: "POST",
          url: "/app/settings/test",
          headers: { cookie },
          payload: { to: "owner@pen-test.invalid" },
        });
        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({
          error: "smtp_password_unreadable",
          message:
            "The saved SMTP password can't be read with ENCRYPTION_KEY: enter it again under Delivery, or start with the key it was saved under",
        });
        expect(await world.listMail()).toHaveLength(0);
      });

      it("Send a test email, under the new key, says the saved SMTP password can't be read with ENCRYPTION_KEY", async () => {
        const response = await rotated.inject({
          method: "POST",
          url: "/app/settings/test",
          headers: { cookie },
          payload: { to: "owner@pen-test.invalid" },
        });
        expect(response.statusCode).toBeLessThan(500);
        expect(response.body).toMatch(/ENCRYPTION_KEY|password/iu);
      });

      it("(regression) the send worker, should one run under the new key, records that the saved SMTP password can't be read with ENCRYPTION_KEY, not GCM's own error (#167)", async () => {
        const unreadable =
          "The saved SMTP password can't be read with ENCRYPTION_KEY: enter it again under Delivery, or start with the key it was saved under";
        const id = await queueMessage("I3 rotated");
        const parts = {
          database: world.database,
          encryptionKey: otherKey,
          sendEmail: sendEmailOverSmtp,
        };
        await expect(
          sendQueuedMessage(parts, id, {
            retryCount: 0,
            retryLimit: sendMessageRetryLimit,
          }),
        ).rejects.toBeInstanceOf(SendWillBeRetriedError);
        expect(await readMessage(id)).toEqual({
          status: "queued",
          attempts: 1,
          error: unreadable,
        });
        await expect(
          sendQueuedMessage(parts, id, {
            retryCount: sendMessageRetryLimit,
            retryLimit: sendMessageRetryLimit,
          }),
        ).resolves.toBe("failed");
        expect(await readMessage(id)).toEqual({
          status: "failed",
          attempts: 2,
          error: unreadable,
        });
        expect(await world.listMail()).toHaveLength(0);
      });

      it("(regression) re-entering the SMTP password under Delivery reseals it under the new key, and so does smtp-password:reseal given the old key (#167)", async () => {
        const saved = await rotated.inject({
          method: "PUT",
          url: "/app/settings",
          headers: { cookie },
          payload: { smtpPassword: world.credentials.smtpPassword },
        });
        expect(saved.statusCode).toBe(200);
        expect(saved.json()).toMatchObject({ isSmtpPasswordUnreadable: false });
        const readSealed = async () => {
          const [row] = await world.database
            .select({ sealed: settings.smtpPasswordEncrypted })
            .from(settings)
            .where(eq(settings.id, 1));
          return row?.sealed ?? "";
        };
        const resealed = await readSealed();
        expect(decryptValue(otherKey, resealed)).toBe(
          world.credentials.smtpPassword,
        );
        expect(() => decryptValue(world.encryptionKey, resealed)).toThrow();
        await world.reloadFixtures();

        // The rotation path with no password to hand: the old key, prompted for, opens it and it is sealed again.
        const reseal = (oldKey: Buffer) =>
          runCliCommand(
            world.database,
            ["smtp-password:reseal"],
            () => Promise.resolve(oldKey.toString("base64")),
            otherKey,
          );
        await expect(reseal(randomBytes(32))).rejects.toThrow(
          "The old key can't open the saved SMTP password either; nothing changed",
        );
        expect(decryptValue(world.encryptionKey, await readSealed())).toBe(
          world.credentials.smtpPassword,
        );
        await expect(reseal(world.encryptionKey)).resolves.toBe(
          "Sealed the saved SMTP password again under ENCRYPTION_KEY.",
        );
        expect(decryptValue(otherKey, await readSealed())).toBe(
          world.credentials.smtpPassword,
        );
        await expect(reseal(world.encryptionKey)).resolves.toBe(
          "The saved SMTP password already opens with ENCRYPTION_KEY; nothing changed.",
        );

        // With the old key lost: forget it, and enter it again under Delivery.
        await expect(
          runCliCommand(world.database, ["smtp-password:forget"], () =>
            Promise.reject(new Error("No prompt is expected")),
          ),
        ).resolves.toBe(
          "Removed the saved SMTP password. Enter it again under Delivery.",
        );
        expect(await readSealed()).toBe("");
        await world.reloadFixtures();
      });

      it("(regression) a real worker and api started with the new key refuse to start, naming ENCRYPTION_KEY, and a queued Message waits untouched (#167)", async () => {
        const id = await queueMessage("I3 rotated, real worker");
        const port = await freePort();
        for (const role of ["worker", "api"] as const) {
          const outcome = refusalOf(
            await startEntrypoint(
              role,
              appVars({
                ENCRYPTION_KEY: otherKey.toString("base64"),
                PORT: String(port),
              }),
              {
                cwd,
                isReady:
                  role === "api"
                    ? isHealthy(port)
                    : hasLogged("worker.started"),
              },
            ),
          );
          expect(outcome, role).not.toBe("started");
          if (outcome !== "started") {
            expect(outcome.code).toBe(1);
            expect(outcome.stderr).toContain(
              "Error: ENCRYPTION_KEY can't open the saved SMTP password",
            );
          }
        }
        expect(await readMessage(id)).toEqual({
          status: "queued",
          attempts: 0,
          error: null,
        });
        await expect(world.deliver(id)).resolves.toBe("sent");
        await world.clearMail();
      }, 120_000);

      it("a worker started with a key that can't open the saved SMTP password refuses to start, naming ENCRYPTION_KEY", async () => {
        const worker = await startEntrypoint(
          "worker",
          appVars({ ENCRYPTION_KEY: otherKey.toString("base64") }),
          { cwd, isReady: hasLogged("worker.started") },
        );
        if (worker.kind === "running") {
          await worker.stop();
        }
        expect(worker).toMatchObject({ kind: "exited" });
        expect(worker.kind === "exited" ? worker.stderr : "").toContain(
          "ENCRYPTION_KEY",
        );
      }, 120_000);
    });

    /* The SMTP password as kept */

    it("keeps the SMTP password sealed in Postgres, v1 with a 16-byte tag, and never serves it (refuted)", async () => {
      await world.reloadFixtures();
      const [row] = await world.database
        .select({ sealed: settings.smtpPasswordEncrypted })
        .from(settings)
        .where(eq(settings.id, 1));
      const sealed = row?.sealed ?? "";
      expect(sealed).toMatch(/^v1\.[\w-]{16}\.[\w-]{22}\.[\w-]+$/u);
      expect(sealed).not.toContain(world.credentials.smtpPassword);
      const response = await world.request(
        { user: "victim" },
        { method: "GET", url: "/app/settings" },
      );
      expect(response.body).not.toContain(world.credentials.smtpPassword);
      expect(response.body).not.toContain(sealed);
    });
  },
);

/* ---------- Compose ---------- */

const composeRequired = {
  POSTGRES_PASSWORD: "i3-placeholder-postgres-password",
  DATABASE_MIGRATE_PASSWORD: "i3-placeholder-migrate-password",
  DATABASE_API_PASSWORD: "i3-placeholder-api-password",
  DATABASE_WORKER_PASSWORD: "i3-placeholder-worker-password",
  DATABASE_BACKUP_PASSWORD: "i3-placeholder-backup-password",
  APP_URL: "http://i3.pen-test.invalid:4320",
  ENCRYPTION_KEY: "i3-placeholder",
  BACKUP_AGE_RECIPIENT: "i3-placeholder",
  BACKUP_RCLONE_REMOTE: "i3:placeholder",
  BACKUP_RCLONE_CONFIG_FILE: "/dev/null",
} as const;
const composeVariables = Object.keys(composeRequired);

const hasCompose = await run("docker", ["compose", "version"]).then(
  () => true,
  () => false,
);

if (!hasCompose) {
  console.warn(
    "SKIPPED the Compose checks in src/pen-test/probes/i3.test.ts: docker compose is not available",
  );
}

/** `docker compose config` with no `.env`, and only the variables given; answers its exit and output. */
const composeConfig = async (
  vars: Record<string, string | undefined>,
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const name of [
    ...Object.keys(composeRequired),
    "DATABASE_URL",
    "PORT",
  ]) {
    Reflect.deleteProperty(environment, name);
  }
  for (const [name, value] of Object.entries(vars)) {
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  try {
    const { stdout, stderr } = await run(
      "docker",
      [
        "compose",
        "--env-file",
        "/dev/null",
        "-f",
        "docker-compose.yml",
        "--profile",
        "restore",
        "config",
        "--format",
        "json",
      ],
      { cwd: repositoryRoot, env: environment },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const read = (name: string): unknown =>
      typeof error === "object" && error !== null
        ? Reflect.get(error, name)
        : undefined;
    const code = read("code");
    const stdout = read("stdout");
    const stderr = read("stderr");
    return {
      code: typeof code === "number" ? code : 1,
      stdout: typeof stdout === "string" ? stdout : "",
      stderr: typeof stderr === "string" ? stderr : "",
    };
  }
};

const renderedEnvironment = (stdout: string, service: string) => {
  const parsed: unknown = JSON.parse(stdout);
  const services: unknown =
    typeof parsed === "object" && parsed !== null
      ? Reflect.get(parsed, "services")
      : undefined;
  const found: unknown =
    typeof services === "object" && services !== null
      ? Reflect.get(services, service)
      : undefined;
  const environment: unknown =
    typeof found === "object" && found !== null
      ? Reflect.get(found, "environment")
      : undefined;
  return typeof environment === "object" && environment !== null
    ? Object.fromEntries(Object.entries(environment))
    : {};
};

const renderedDependsOn = (stdout: string, service: string) => {
  const parsed: unknown = JSON.parse(stdout);
  const services: unknown =
    typeof parsed === "object" && parsed !== null
      ? Reflect.get(parsed, "services")
      : undefined;
  const found: unknown =
    typeof services === "object" && services !== null
      ? Reflect.get(services, service)
      : undefined;
  const dependsOn: unknown =
    typeof found === "object" && found !== null
      ? Reflect.get(found, "depends_on")
      : undefined;
  return typeof dependsOn === "object" && dependsOn !== null
    ? Object.fromEntries(Object.entries(dependsOn))
    : {};
};

/** Stubs a service's rendered environment into `process.env`, as the container would see it. */
const stubRendered = (environment: Record<string, unknown>) => {
  for (const [name, value] of Object.entries(environment)) {
    if (typeof value === "string") {
      vi.stubEnv(name, value);
    }
  }
};

describe.skipIf(!hasCompose)(
  "pen test I3 (#105): Compose's :? refusals",
  () => {
    it("renders with every required variable set (the control)", async () => {
      const { code } = await composeConfig(composeRequired);
      expect(code).toBe(0);
    }, 60_000);

    it("refuses to render with each required variable unset or empty, naming it (refuted)", async () => {
      for (const name of composeVariables) {
        for (const value of [undefined, ""]) {
          const result = await composeConfig({
            ...composeRequired,
            [name]: value,
          });
          expect(result.code, `${name}=${String(value)}`).not.toBe(0);
          expect(result.stderr).toContain(`set ${name} in .env`);
        }
      }
    }, 240_000);

    it("defaults BACKUP_KEEP_DAYS, BACKUP_HOUR_UTC, RESTORE_DATABASE and BACKUP_AGE_IDENTITY_FILE when unset, as documented (refuted)", async () => {
      const { code, stdout } = await composeConfig(composeRequired);
      expect(code).toBe(0);
      expect(renderedEnvironment(stdout, "backup")).toMatchObject({
        BACKUP_KEEP_DAYS: "14",
        BACKUP_HOUR_UTC: "2",
      });
      expect(renderedEnvironment(stdout, "restore")).toMatchObject({
        PGDATABASE: "email_platform",
      });
    }, 60_000);

    // Compose's interpolation can refuse only an unset or empty value, so it still renders these; what refuses them is
    // provision and every app role, below and in the entrypoint probes above.
    it("(regression) renders with a one-character or whitespace POSTGRES_PASSWORD and .env.example's old ENCRYPTION_KEY, but provision refuses the password and the api the key, each by name (#165, #166)", async () => {
      for (const password of ["x", " "]) {
        const { code, stdout } = await composeConfig({
          ...composeRequired,
          POSTGRES_PASSWORD: password,
          ENCRYPTION_KEY: exampleEncryptionKey,
        });
        expect(code).toBe(0);
        expect(renderedEnvironment(stdout, "postgres").POSTGRES_PASSWORD).toBe(
          password,
        );
        // Since #121 only provision connects as the superuser, with POSTGRES_PASSWORD.
        expect(renderedEnvironment(stdout, "provision")).toMatchObject({
          DATABASE_URL: `postgres://email_platform:${password}@postgres:5432/email_platform`,
        });
        expect(renderedEnvironment(stdout, "api")).toMatchObject({
          ENCRYPTION_KEY: exampleEncryptionKey,
        });
        try {
          stubRendered(renderedEnvironment(stdout, "provision"));
          expect(() => loadProvisionVars()).toThrow(/POSTGRES_PASSWORD/u);
          vi.unstubAllEnvs();
          stubRendered(renderedEnvironment(stdout, "api"));
          expect(() => loadVars()).toThrow(/ENCRYPTION_KEY/u);
        } finally {
          vi.unstubAllEnvs();
        }
      }
    }, 60_000);

    // Rewritten from asserting `docker compose config` exits non-zero: Compose's `:?` can't look inside a value, so the
    // floor is checked where the password is first used. provision gets it, and every other app container waits on
    // provision (or on migrate, which waits on provision), so none of them starts (#166).
    it("refuses a whitespace POSTGRES_PASSWORD", async () => {
      const { code, stdout } = await composeConfig({
        ...composeRequired,
        POSTGRES_PASSWORD: " ",
      });
      expect(code).toBe(0);
      try {
        stubRendered(renderedEnvironment(stdout, "provision"));
        expect(() => loadProvisionVars()).toThrow(/POSTGRES_PASSWORD/u);
      } finally {
        vi.unstubAllEnvs();
      }
      const waitsOn = (service: string) => renderedDependsOn(stdout, service);
      for (const service of ["migrate", "backup", "restore"]) {
        expect(waitsOn(service), service).toMatchObject({
          provision: { condition: "service_completed_successfully" },
        });
      }
      for (const service of ["api", "worker"]) {
        expect(waitsOn(service), service).toMatchObject({
          migrate: { condition: "service_completed_successfully" },
        });
      }
    }, 60_000);
  },
);
