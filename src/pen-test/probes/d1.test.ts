/**
 * Pen test D1 (#99): Postgres privilege. Answers H4. The findings note is `docs/pen-test/findings/D1.md`. A confirmed
 * gap is an `it.fails` for the property that should hold beside a `today_…` test pinning what happens now; a refuted
 * probe is a plain passing test.
 *
 * The probe world's Postgres is made as Compose makes production's (`POSTGRES_USER: email_platform` on
 * `postgres:18-alpine`), its roles provisioned and its schema migrated as `provision` and `migrate` do, and the app's
 * queries here go over the api's own connection string, as `email_platform_api` (#121). The other logins are probed
 * over theirs.
 *
 * Which containers hold a database password and which networks they sit on is read from `docker compose config`, with
 * placeholder values for the variables Compose requires and no `.env` read, so no real secret is ever loaded.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseRoles, type LoginRole } from "../../lib/database-roles.js";
import { createJobBoss } from "../../lib/jobs.js";
import {
  hasContainerRuntime,
  startProbeWorld,
  warnIfSkipped,
  type ProbeWorld,
} from "./probe-world.js";

warnIfSkipped("src/pen-test/probes/d1.test.ts");

const run = promisify(execFile);

let world: ProbeWorld;

const query = async <Row extends Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<Row[]> =>
  (await world.database.$client.query<Row>(text, values)).rows;

/** Runs a shell command in the postgres container through COPY … FROM PROGRAM and answers its output lines. */
const copyFromProgram = async (
  command: string,
  pool: Pool = world.database.$client,
): Promise<string[]> => {
  const client = await pool.connect();
  try {
    await client.query(
      "create temp table if not exists d1_program_output (line text)",
    );
    await client.query("truncate d1_program_output");
    await client.query(
      `copy d1_program_output from program '${command.replaceAll("'", "''")}'`,
    );
    const { rows } = await client.query<{ line: string }>(
      "select line from d1_program_output",
    );
    return rows.map((row) => row.line);
  } finally {
    client.release();
  }
};

/** Runs statements in a transaction that is always rolled back, so a probe that succeeds changes nothing. */
const inRolledBackTransaction = async (
  pool: Pool,
  statements: string[],
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const statement of statements) {
      await client.query(statement);
    }
  } finally {
    await client.query("rollback");
    client.release();
  }
};

describe.skipIf(!hasContainerRuntime)(
  "pen test D1 (#99): Postgres privilege",
  () => {
    const pools = new Map<LoginRole | "superuser", Pool>();
    const poolFor = (role: LoginRole | "superuser"): Pool => {
      const pool =
        pools.get(role) ??
        new Pool({ connectionString: world.databaseUrls[role] });
      pools.set(role, pool);
      return pool;
    };

    beforeAll(async () => {
      world = await startProbeWorld({ hasMailpit: false });
    }, 300_000);
    afterAll(async () => {
      await Promise.all([...pools.values()].map((pool) => pool.end()));
      await world.stop();
    });

    /* Probe 1: with the app's own connection string */

    it("(regression) the app's role is not a superuser, can't bypass row-level security and can't create roles (#121)", async () => {
      const [role] = await query<{
        rolname: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreaterole: boolean;
      }>(
        "select rolname, rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname = current_user",
      );
      expect(role).toEqual({
        rolname: databaseRoles.api,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
      });
    });

    it("the app's role is not a superuser", async () => {
      const [role] = await query<{ rolsuper: boolean }>(
        "select rolsuper from pg_roles where rolname = current_user",
      );
      expect(role?.rolsuper).toBe(false);
    });

    it("(regression) the app's connection reads and writes the tables in public and pgboss, but not Drizzle's migrations ledger (#121)", async () => {
      const tables = await query<{ name: string }>(
        `select format('%I.%I', table_schema, table_name) as name from information_schema.tables
       where table_schema in ('public', 'pgboss') and table_type = 'BASE TABLE' order by 1`,
      );
      expect(tables.map((table) => table.name)).toEqual(
        expect.arrayContaining([
          "pgboss.job",
          "public.api_keys",
          "public.messages",
          "public.sessions",
          "public.settings",
          "public.users",
        ]),
      );
      for (const { name } of tables) {
        await expect(
          query(`select count(*) from ${name}`),
        ).resolves.toHaveLength(1);
      }
      await expect(
        inRolledBackTransaction(world.database.$client, [
          "update settings set updated_at = updated_at",
        ]),
      ).resolves.toBeUndefined();
      await expect(
        query("select count(*) from drizzle.__drizzle_migrations"),
      ).rejects.toThrow(/permission denied for schema drizzle/u);
    });

    it("the app's connection cannot drop or alter the schema it runs on", async () => {
      const client = await world.database.$client.connect();
      try {
        await client.query("begin");
        await expect(
          client.query("drop table messages cascade"),
        ).rejects.toThrow(/permission denied|must be owner/u);
      } finally {
        await client.query("rollback");
        client.release();
      }
    });

    it("(regression) COPY … FROM PROGRAM is refused to the app's connection, so it has no shell in the postgres container (#121)", async () => {
      await expect(copyFromProgram("id")).rejects.toThrow(
        /permission denied to COPY to or from an external program/u,
      );
    });

    it("a program run by COPY … FROM PROGRAM finds no POSTGRES_PASSWORD in the server's environment (refuted: the entrypoint keeps it out)", async () => {
      // Only the bootstrap superuser can run a program now (#121), so this is the strongest attacker's view.
      const lines = await copyFromProgram(
        "printenv POSTGRES_PASSWORD || echo absent",
        poolFor("superuser"),
      );
      expect(lines).toEqual(["absent"]);
      expect(lines).not.toContain(world.postgres.getPassword());
    });

    it("the app's connection cannot run a program in the postgres container", async () => {
      await expect(copyFromProgram("id")).rejects.toThrow(
        /permission denied|must be superuser|pg_execute_server_program/u,
      );
    });

    it("(regression) the app's connection can't create a login role (#121)", async () => {
      await expect(
        query("create role d1_probe_role login password 'd1-probe-only'"),
      ).rejects.toThrow(/permission denied to create role/u);
      await expect(
        query("select rolname from pg_roles where rolname = 'd1_probe_role'"),
      ).resolves.toEqual([]);
    });

    it("the app's connection cannot create a role", async () => {
      try {
        await expect(query("create role d1_probe_role_2")).rejects.toThrow(
          /permission denied/u,
        );
      } finally {
        // The app's role can't drop a role either, so the clean-up is the superuser's.
        await poolFor("superuser").query("drop role if exists d1_probe_role_2");
      }
    });

    it("(regression) the app's connection can't read pg_authid, not even its own SCRAM verifier (#121)", async () => {
      await expect(
        query("select rolpassword from pg_authid where rolname = current_user"),
      ).rejects.toThrow(/permission denied for table pg_authid/u);
    });

    it("the app's connection cannot read pg_authid", async () => {
      await expect(query("select rolpassword from pg_authid")).rejects.toThrow(
        /permission denied/u,
      );
    });

    it("no login, migrate's included, is a superuser, runs a program, makes a role or reads pg_authid, and only migrate changes the schema (#121)", async () => {
      const refused =
        /permission denied|must be owner|must be superuser|pg_execute_server_program/u;
      for (const role of ["migrate", "api", "worker", "backup"] as const) {
        const pool = poolFor(role);
        const { rows } = await pool.query<{
          user: string;
          rolsuper: boolean;
          rolcreaterole: boolean;
          rolcreatedb: boolean;
        }>(
          "select current_user as user, rolsuper, rolcreaterole, rolcreatedb from pg_roles where rolname = session_user",
        );
        expect(rows, role).toEqual([
          {
            // migrate becomes the owner on login, so what it makes is the owner's.
            user:
              role === "migrate" ? databaseRoles.owner : databaseRoles[role],
            rolsuper: false,
            rolcreaterole: false,
            rolcreatedb: false,
          },
        ]);
        await expect(copyFromProgram("id", pool), role).rejects.toThrow(
          refused,
        );
        await expect(
          pool.query("create role d1_probe_role_3"),
          role,
        ).rejects.toThrow(refused);
        await expect(
          pool.query("select rolpassword from pg_authid"),
          role,
        ).rejects.toThrow(refused);
        const ddl = inRolledBackTransaction(pool, [
          "alter table messages add column d1_probe text",
          "drop table pgboss.job cascade",
        ]);
        await (role === "migrate"
          ? expect(ddl, role).resolves.toBeUndefined()
          : expect(ddl, role).rejects.toThrow(refused));
      }
    });

    it("backup reads every table pg_dump needs, the migrations ledger included, and writes none (#121)", async () => {
      const pool = poolFor("backup");
      for (const table of [
        "drizzle.__drizzle_migrations",
        "public.users",
        "public.api_keys",
        "pgboss.job",
      ]) {
        await expect(
          pool.query(`select count(*) from ${table}`),
          table,
        ).resolves.toBeDefined();
      }
      await expect(
        inRolledBackTransaction(pool, ["delete from users"]),
      ).rejects.toThrow(/permission denied for table users/u);
    });

    it("the worker's pg-boss sends, fetches, completes, schedules and runs its maintenance without changing the schema (#121)", async () => {
      const boss = createJobBoss(world.databaseUrls.worker);
      const errors: Error[] = [];
      boss.on("error", (error) => {
        errors.push(error);
      });
      await boss.start();
      try {
        const id = await boss.send("apply-retention", {});
        const [job] = await boss.fetch("apply-retention");
        expect(job?.id).toBe(id);
        await boss.complete("apply-retention", id ?? "");
        await boss.schedule("apply-retention", "30 3 * * *");
        await boss.supervise();
      } finally {
        await boss.stop({ graceful: false });
      }
      expect(errors).toEqual([]);
    });

    /* Probe 2: queries a request can steer */

    it("the log search treats %, _ and quotes as text, not as SQL or patterns (refuted)", async () => {
      const headers = await world.asUser("victim");
      const search = async (term: string) => {
        const response = await world.server.inject({
          method: "GET",
          url: "/app/messages",
          query: { search: term },
          headers,
        });
        expect(response.statusCode).toBe(200);
        return response.json<{ total: number }>().total;
      };
      const everything = await search("");
      expect(everything).toBeGreaterThan(0);
      expect(await search("%")).toBe(0);
      expect(await search("_")).toBe(0);
      expect(await search("' or '1'='1")).toBe(0);
      expect(await search("\\")).toBe(0);
    });

    it("(regression) odd log filters, a page past bigint and the year 0000, are refused by the schema with 422 (#157)", async () => {
      const headers = await world.asUser("victim");
      const page = await world.server.inject({
        method: "GET",
        url: "/app/messages",
        query: { page: "100000000000000000000" },
        headers,
      });
      const year0 = await world.server.inject({
        method: "GET",
        url: "/app/messages",
        query: { after: "0000-01-01T00:00:00Z" },
        headers,
      });
      expect([page.statusCode, year0.statusCode]).toEqual([422, 422]);
      expect(page.json()).toMatchObject({ error: "validation_failed" });
      expect(year0.json()).toMatchObject({ error: "validation_failed" });
    });

    it("odd log filters stop above the database with a 4xx", async () => {
      const headers = await world.asUser("victim");
      const filters: Record<string, string>[] = [
        { page: "100000000000000000000" },
        { after: "0000-01-01T00:00:00Z" },
      ];
      for (const filter of filters) {
        const response = await world.server.inject({
          method: "GET",
          url: "/app/messages",
          query: filter,
          headers,
        });
        expect(response.statusCode).toBeLessThan(500);
      }
    });
  },
);

/* Probe 3 and 4: which containers hold a database password, their networks, and a role for each */

interface ComposeService {
  environment?: Record<string, string | null>;
  networks?: Record<string, unknown>;
}

interface ComposeConfig {
  services: Record<string, ComposeService>;
  networks: Record<string, { internal?: boolean }>;
}

/** A placeholder for every database password Compose requires, each its own, so a holder shows which one it holds. */
const placeholderPasswords = {
  POSTGRES_PASSWORD: "d1-placeholder-postgres-password",
  DATABASE_MIGRATE_PASSWORD: "d1-placeholder-migrate-password",
  DATABASE_API_PASSWORD: "d1-placeholder-api-password",
  DATABASE_WORKER_PASSWORD: "d1-placeholder-worker-password",
  DATABASE_BACKUP_PASSWORD: "d1-placeholder-backup-password",
};

type PasswordVariable = keyof typeof placeholderPasswords;

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
    "SKIPPED the Compose checks in src/pen-test/probes/d1.test.ts: docker compose is not available",
  );
}

const readComposeConfig = async (): Promise<ComposeConfig> => {
  const { stdout } = await run(
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
    {
      env: {
        ...process.env,
        ...placeholderPasswords,
        APP_URL: "http://d1.pen-test.invalid:4320",
        ENCRYPTION_KEY: "d1-placeholder",
        BACKUP_AGE_RECIPIENT: "d1-placeholder",
        BACKUP_RCLONE_REMOTE: "d1:placeholder",
        BACKUP_RCLONE_CONFIG_FILE: "/dev/null",
      },
    },
  );
  const parsed: unknown = JSON.parse(stdout);
  if (!isComposeConfig(parsed)) {
    throw new Error("docker compose config did not answer a Compose file");
  }
  return parsed;
};

const holdsPassword = (
  service: ComposeService,
  variables: readonly PasswordVariable[],
) =>
  Object.values(service.environment ?? {}).some((value) =>
    variables.some(
      (variable) => value?.includes(placeholderPasswords[variable]) === true,
    ),
  );

const passwordVariables = Object.keys(placeholderPasswords).filter(
  (name): name is PasswordVariable => name in placeholderPasswords,
);

const loginUser = (service: ComposeService): string | undefined => {
  const environment = service.environment ?? {};
  const url = environment.DATABASE_URL;
  if (typeof url === "string") {
    return new URL(url).username;
  }
  return environment.PGUSER ?? environment.POSTGRES_USER ?? undefined;
};

describe.skipIf(!hasCompose)(
  "pen test D1 (#99): the Compose file's password holders and networks",
  () => {
    let config: ComposeConfig;
    beforeAll(async () => {
      config = await readComposeConfig();
    }, 60_000);

    const holders = (variables: readonly PasswordVariable[]) =>
      Object.entries(config.services)
        .filter(([, service]) => holdsPassword(service, variables))
        .map(([name]) => name)
        .toSorted();

    const hasWayOut = (service: ComposeService) =>
      Object.keys(service.networks ?? {}).some(
        (network) => config.networks[network]?.internal !== true,
      );

    it("(regression) migrate sits on the internal database network alone, and only api, worker, backup and restore, which need a way out, hold a database password beside the default network (#139)", () => {
      const all = holders(passwordVariables);
      expect(all).toEqual([
        "api",
        "backup",
        "migrate",
        "postgres",
        "provision",
        "restore",
        "worker",
      ]);
      expect(
        Object.fromEntries(
          all.map((name) => [
            name,
            Object.keys(config.services[name]?.networks ?? {}).toSorted(),
          ]),
        ),
      ).toEqual({
        // The api serves the UI's port and sends a test email, the worker reaches the SMTP provider, and backup and
        // restore reach the backup remote. Each holds only its own least-privilege role.
        api: ["database", "default"],
        backup: ["database", "default"],
        migrate: ["database"],
        postgres: ["database"],
        provision: ["database"],
        restore: ["database", "default"],
        worker: ["database", "default"],
      });
      expect(config.networks.database?.internal).toBe(true);
      expect(config.networks.default?.internal).not.toBe(true);
      // The superuser's password stays on the internal network.
      for (const name of holders(["POSTGRES_PASSWORD"])) {
        expect(hasWayOut(config.services[name] ?? {}), name).toBe(false);
      }
    });

    it("a service that only talks to Postgres (migrate) has no way out", () => {
      expect(hasWayOut(config.services.migrate ?? {})).toBe(false);
    });

    it("(regression) each service logs in as a role of its own, and only postgres and provision hold the superuser's password (#138, #121)", () => {
      expect(holders(["POSTGRES_PASSWORD"])).toEqual(["postgres", "provision"]);
      expect(
        Object.fromEntries(
          holders(passwordVariables).map((name) => [
            name,
            loginUser(config.services[name] ?? {}),
          ]),
        ),
      ).toEqual({
        api: "email_platform_api",
        backup: "email_platform_backup",
        migrate: "email_platform_migrate",
        postgres: "email_platform",
        provision: "email_platform",
        // A restore recreates the schema, which only migrate's role may do.
        restore: "email_platform_migrate",
        worker: "email_platform_worker",
      });
      expect(holders(["DATABASE_API_PASSWORD"])).toEqual(["api", "provision"]);
      expect(holders(["DATABASE_WORKER_PASSWORD"])).toEqual([
        "provision",
        "worker",
      ]);
      expect(holders(["DATABASE_BACKUP_PASSWORD"])).toEqual([
        "backup",
        "provision",
      ]);
      expect(holders(["DATABASE_MIGRATE_PASSWORD"])).toEqual([
        "migrate",
        "provision",
        "restore",
      ]);
    });

    it("api, worker, migrate and backup each log in as a role of their own", () => {
      const users = ["api", "worker", "migrate", "backup"].map((name) =>
        loginUser(config.services[name] ?? {}),
      );
      expect(new Set(users).size).toBe(users.length);
    });
  },
);
