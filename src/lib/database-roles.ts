import { sql } from "drizzle-orm";
import { Client, escapeIdentifier, escapeLiteral } from "pg";
import type { Database } from "./database.js";

/**
 * The database's roles (pen test D1, #121 and #138). The bootstrap superuser `POSTGRES_USER` makes them and is held by
 * no service but `postgres` and the one-shot `provision`. Nothing logs in as the owner: `migrate` becomes it on login,
 * so everything it creates is the owner's. `api` and `worker` share the `app` group's grants on the tables they serve;
 * `backup` may only read. None of them is a superuser, so none can run `COPY … PROGRAM`, make a role or read
 * `pg_authid`, and only `migrate` can change the schema.
 */
export const databaseRoles = {
  owner: "email_platform_owner",
  app: "email_platform_app",
  migrate: "email_platform_migrate",
  api: "email_platform_api",
  worker: "email_platform_worker",
  backup: "email_platform_backup",
} as const;

export type LoginRole = "migrate" | "api" | "worker" | "backup";

export const loginRoles: readonly LoginRole[] = [
  "migrate",
  "api",
  "worker",
  "backup",
];

export type DatabaseRolePasswords = Record<LoginRole, string>;

/** The schemas the app's objects live in: its tables, Drizzle's migrations ledger and pg-boss's queue. */
const appSchemas = ["public", "drizzle", "pgboss"];

const notAnything =
  "nosuperuser nocreatedb nocreaterole noreplication nobypassrls";

const ensureRole = (name: string) =>
  `do $$ begin
     if not exists (select from pg_roles where rolname = ${escapeLiteral(name)}) then
       create role ${escapeIdentifier(name)};
     end if;
   end $$`;

/**
 * An install made before #121 has every object owned by the bootstrap superuser, which `reassign owned` can't move
 * (it also owns the system catalogs), so each of the app's schemas, and everything in them, is handed over one by one.
 * Whatever a table owns (its indexes, its serial and identity sequences) follows the table.
 */
const handOverToOwner = (owner: string) => {
  const schemas = `array[${appSchemas.map((schema) => escapeLiteral(schema)).join(", ")}]`;
  const ownerLiteral = escapeLiteral(owner);
  const notOwner = (column: string) => `${column} <> ${ownerLiteral}::regrole`;
  return `do $$
    declare
      change record;
    begin
      for change in
        select format('alter schema %I owner to %I', nspname, ${ownerLiteral}) as statement
        from pg_namespace where nspname = any (${schemas}) and ${notOwner("nspowner")}
      loop execute change.statement; end loop;

      for change in
        select format('alter %s %s owner to %I',
          case c.relkind when 'v' then 'view' when 'm' then 'materialized view' else 'table' end,
          c.oid::regclass, ${ownerLiteral}) as statement
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = any (${schemas}) and c.relkind in ('r', 'p', 'v', 'm') and ${notOwner("c.relowner")}
      loop execute change.statement; end loop;

      for change in
        select format('alter sequence %s owner to %I', c.oid::regclass, ${ownerLiteral}) as statement
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = any (${schemas}) and c.relkind = 'S' and ${notOwner("c.relowner")}
      loop execute change.statement; end loop;

      for change in
        select format('alter routine %s owner to %I', p.oid::regprocedure, ${ownerLiteral}) as statement
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = any (${schemas}) and ${notOwner("p.proowner")}
      loop execute change.statement; end loop;

      for change in
        select format('alter type %s owner to %I', t.oid::regtype, ${ownerLiteral}) as statement
        from pg_type t join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = any (${schemas}) and ${notOwner("t.typowner")}
          and (t.typtype in ('e', 'd', 'r')
            or (t.typtype = 'c' and (select relkind from pg_class where oid = t.typrelid) = 'c'))
      loop execute change.statement; end loop;
    end $$`;
};

export interface ProvisionOptions {
  /** A connection string for the bootstrap superuser. */
  superuserUrl: string;
  passwords: DatabaseRolePasswords;
  /** The database to provision, made if it doesn't exist. The superuser's own database by default. */
  database?: string;
}

const openClient = async (connectionString: string): Promise<Client> => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

const ensureDatabase = async (superuserUrl: string, database: string) => {
  const client = await openClient(superuserUrl);
  try {
    const { rowCount } = await client.query(
      "select from pg_database where datname = $1",
      [database],
    );
    if (rowCount === 0) {
      await client.query(`create database ${escapeIdentifier(database)}`);
    }
  } finally {
    await client.end();
  }
};

/**
 * Makes (or brings up to date) every role, sets each login's password, and hands the app's schemas to the owner. Safe
 * to run on every deploy: it is how a password is rotated, and how an install made before #121 is moved onto the roles.
 */
export const provisionDatabase = async ({
  superuserUrl,
  passwords,
  database,
}: ProvisionOptions): Promise<void> => {
  for (const role of loginRoles) {
    if (passwords[role] === "") {
      throw new Error(`The ${databaseRoles[role]} role needs a password`);
    }
  }
  const url = new URL(superuserUrl);
  if (database !== undefined) {
    await ensureDatabase(superuserUrl, database);
    url.pathname = `/${encodeURIComponent(database)}`;
  }
  const { owner, app, migrate, api, worker } = databaseRoles;
  const id = escapeIdentifier;
  const statements = [
    // Roles belong to the whole server, so two runs at once would race to make them.
    "select pg_advisory_xact_lock(hashtext('email_platform.provision'))",
    ...[owner, app].flatMap((role) => [
      ensureRole(role),
      `alter role ${id(role)} nologin ${notAnything}`,
    ]),
    ...loginRoles.flatMap((role) => [
      ensureRole(databaseRoles[role]),
      `alter role ${id(databaseRoles[role])} login ${notAnything} password ${escapeLiteral(passwords[role])}`,
    ]),
    `grant ${id(owner)} to ${id(migrate)}`,
    // So that what migrate creates (tables, pg-boss's partitions, a restore) is the owner's, not migrate's.
    `alter role ${id(migrate)} set role = ${escapeLiteral(owner)}`,
    `grant ${id(app)} to ${id(api)}, ${id(worker)}`,
    // Drizzle and pg-boss make their own schemas.
    `do $$ begin execute format('grant create on database %I to %I', current_database(), ${escapeLiteral(owner)}); end $$`,
    handOverToOwner(owner),
  ];
  const client = await openClient(url.toString());
  try {
    await client.query("begin");
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
};

/**
 * Grants the runtime roles what they need on whatever `migrate` has just made: `app` reads and writes the tables in
 * `public` and `pgboss` (not Drizzle's ledger), and `backup` reads all three schemas for `pg_dump`. Run by `migrate`,
 * as the owner, after every migration, so a new table is covered. Skipped where the roles were never made, as in the
 * development stack, where the app logs in as the superuser.
 */
export const grantRuntimeAccess = async (database: Database): Promise<void> => {
  const { app, backup } = databaseRoles;
  const id = escapeIdentifier;
  await database.execute(
    sql.raw(`do $$ begin
      if exists (select from pg_roles where rolname = ${escapeLiteral(app)}) then
        grant usage on schema public, pgboss to ${id(app)};
        grant select, insert, update, delete on all tables in schema public, pgboss to ${id(app)};
        grant usage, select on all sequences in schema public, pgboss to ${id(app)};
      end if;
      if exists (select from pg_roles where rolname = ${escapeLiteral(backup)}) then
        grant usage on schema public, drizzle, pgboss to ${id(backup)};
        grant select on all tables in schema public, drizzle, pgboss to ${id(backup)};
        grant select on all sequences in schema public, drizzle, pgboss to ${id(backup)};
      end if;
    end $$`),
  );
};

/** A login role's connection string: the superuser's, with the role and its password in place of the superuser's. */
export const roleUrl = (
  superuserUrl: string,
  role: LoginRole,
  password: string,
): string => {
  const url = new URL(superuserUrl);
  url.username = databaseRoles[role];
  url.password = password;
  return url.toString();
};
