import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Client } from "pg";
import { getContainerRuntimeClient } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";
import {
  databaseRoles,
  provisionDatabase,
  roleUrl,
  type DatabaseRolePasswords,
} from "./database-roles.js";
import { buildJobQueue, createJobBoss } from "./jobs.js";
import { migrateEverything } from "./migrate.js";
import { templates } from "./schema.js";

const hasContainerRuntime = await getContainerRuntimeClient().then(
  () => true,
  () => false,
);

if (!hasContainerRuntime) {
  console.warn(
    "SKIPPED src/lib/database-roles.test.ts: no container runtime, so no roles were provisioned",
  );
}

const passwords: DatabaseRolePasswords = {
  migrate: "roles-test-migrate",
  api: "roles-test-api",
  worker: "roles-test-worker",
  backup: "roles-test-backup",
};

const failOnJobsError = (error: Error) => {
  throw error;
};

/** Runs one query on a fresh connection and answers its rows. */
const queryAs = async <Row extends Record<string, unknown>>(
  connectionString: string,
  text: string,
): Promise<Row[]> => {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return (await client.query<Row>(text)).rows;
  } finally {
    await client.end();
  }
};

describe("provisioning the database's roles", () => {
  it("refuses a login without a password", async () => {
    await expect(
      provisionDatabase({
        superuserUrl: "postgres://email_platform@postgres.invalid/x",
        passwords: { ...passwords, worker: "" },
      }),
    ).rejects.toThrow("The email_platform_worker role needs a password");
  });
});

describe.skipIf(!hasContainerRuntime)(
  "moving an install made before #121 onto its roles",
  () => {
    let postgres: StartedPostgreSqlContainer;
    let superuserUrl: string;
    const urlFor = (role: keyof DatabaseRolePasswords, password?: string) =>
      roleUrl(superuserUrl, role, password ?? passwords[role]);

    beforeAll(async () => {
      postgres = await new PostgreSqlContainer("postgres:18-alpine")
        .withUsername("email_platform")
        .withDatabase("email_platform")
        .start();
      superuserUrl = postgres.getConnectionUri();
      // As every install was before #121: migrated, and run, as the bootstrap superuser.
      await migrateEverything(superuserUrl, failOnJobsError);
      const database = openDatabase(superuserUrl);
      await database.insert(templates).values({
        name: "Made before the roles",
        slug: "made-before-the-roles",
        subject: "Hi",
        html: "<p>Hi</p>",
      });
      await database.$client.end();
    }, 300_000);

    afterAll(async () => {
      await postgres.stop();
    });

    it("hands every schema and object to the owner, then migrates and runs as the new roles", async () => {
      await provisionDatabase({ superuserUrl, passwords });
      await migrateEverything(urlFor("migrate"), failOnJobsError);

      const notTheOwners = await queryAs<{ name: string }>(
        superuserUrl,
        `select nspname as name from pg_namespace
           where nspname in ('public', 'drizzle', 'pgboss') and nspowner <> '${databaseRoles.owner}'::regrole
         union all
         select c.oid::regclass::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname in ('public', 'drizzle', 'pgboss') and c.relowner <> '${databaseRoles.owner}'::regrole
         union all
         select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'drizzle', 'pgboss') and p.proowner <> '${databaseRoles.owner}'::regrole`,
      );
      expect(notTheOwners).toEqual([]);

      const database = openDatabase(urlFor("api"));
      const boss = createJobBoss(urlFor("api"));
      boss.on("error", failOnJobsError);
      try {
        await boss.start();
        const names = await database
          .select({ name: templates.name })
          .from(templates);
        expect(names).toEqual([{ name: "Made before the roles" }]);
        const jobId = await database.transaction((transaction) =>
          buildJobQueue(boss).enqueue(transaction, "apply-retention", {}),
        );
        expect(jobId).toMatch(/^[0-9a-f-]{36}$/u);
      } finally {
        await boss.stop({ graceful: false });
        await database.$client.end();
      }
    });

    it("rotates a password when it is run again with a new one", async () => {
      const rotated = { ...passwords, api: "roles-test-api-rotated" };
      await provisionDatabase({ superuserUrl, passwords: rotated });
      await expect(queryAs(urlFor("api"), "select 1")).rejects.toThrow(
        /password authentication failed/u,
      );
      await expect(
        queryAs(urlFor("api", rotated.api), "select 1"),
      ).resolves.toHaveLength(1);
      await provisionDatabase({ superuserUrl, passwords });
    });

    it("makes and provisions a database to restore into, which migrate's role can build in", async () => {
      await provisionDatabase({
        superuserUrl,
        passwords,
        database: "restore_check",
      });
      const url = new URL(urlFor("migrate"));
      url.pathname = "/restore_check";
      await expect(
        queryAs(url.toString(), "create schema pgboss"),
      ).resolves.toEqual([]);
      const [owner] = await queryAs<{ owner: string }>(
        url.toString(),
        "select nspowner::regrole::text as owner from pg_namespace where nspname = 'public'",
      );
      expect(owner?.owner).toBe(databaseRoles.owner);
    });
  },
);
