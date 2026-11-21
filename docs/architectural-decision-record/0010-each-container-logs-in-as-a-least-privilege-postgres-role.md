# Each container logs in as a least-privilege Postgres role

[ADR 0003](0003-self-hosted-on-a-home-server-with-docker-compose.md) runs the platform under Docker Compose with one Postgres. Until the first pen-test round every container (`api`, `worker`, `migrate`, `backup`, `restore`) logged in as `email_platform`, the bootstrap superuser the `postgres` image makes from `POSTGRES_USER`, with the one `POSTGRES_PASSWORD`. Over the app's own connection pen test D1 ran a shell in the `postgres` container with `COPY … FROM PROGRAM`, made a login role, read every SCRAM verifier in `pg_authid` and dropped a table (#121, high); and every container held the same password (#138).

## Decision

- **A role per container, none of them a superuser.** `email_platform_owner` (`NOLOGIN`) owns the `public`, `drizzle` and `pgboss` schemas and everything in them. `email_platform_migrate` is a member of it and becomes it on login (`alter role … set role`), so everything `migrate` makes, and everything a restore makes, is the owner's. `email_platform_api` and `email_platform_worker` share the `email_platform_app` group's `select, insert, update, delete` on the tables in `public` and `pgboss`, and nothing on Drizzle's ledger. `email_platform_backup` may only `select`, in all three schemas. Each login has its own password in `.env` (`DATABASE_MIGRATE_PASSWORD`, `DATABASE_API_PASSWORD`, `DATABASE_WORKER_PASSWORD`, `DATABASE_BACKUP_PASSWORD`).
- **A one-shot `provision` container makes them**, from the app image (`dist/src/index.js provision`, `src/lib/database-roles.ts`). With `postgres`, it is the only holder of `POSTGRES_PASSWORD`, and it sits on the internal `database` network only. It runs before `migrate` on every deploy and is idempotent: it makes any missing role, sets every password (which is how one is rotated), grants the owner `create` on the database, and hands the three schemas and every object in them to the owner. That last step is what moves an install made before the roles; `reassign owned` can't, because the bootstrap superuser also owns the system catalogs.
- **`migrate` grants the runtime roles their access** after it has migrated, as the owner, so a table a later migration adds is covered without a default privilege. Where the roles were never made (the development stack, which logs in as the superuser) it skips the grants.
- **Only `migrate` changes pg-boss's schema.** The api and worker start pg-boss with `migrate: false`, `createSchema: false` and `reindex: false`; `migrate` installs or migrates it, makes the queues and waits for any background index builds a pg-boss migration leaves.
- **A restore runs as `email_platform_migrate`**, because it recreates the schema. The dump carries each table's grants, so the restored data is usable by the other roles straight away.

## Consequences

- Five Postgres passwords to keep in `.env` instead of one. A missing one stops Compose with its name (`:?`).
- No app container can run a program in the `postgres` container, make a role, read `pg_authid`, or, except `migrate`, drop or alter a table. A later control in the database (a revoke, a trigger) can't be undone by the connection it guards.
- `backup` deliberately doesn't use `pg_read_all_data`: that role can also read `pg_authid`.
- Bloated pg-boss indexes are no longer rebuilt at run time (`reindex: false`); pg-boss still warns of them. On one home server's queue this is not expected to matter.
- The api and worker share one set of grants. Narrowing the worker to the tables it uses is possible, at the cost of a grant to keep in step with every new table.
- The networks each container sits on were left to #139, which puts `migrate` on the internal `database` network alone, so it has no way out. `api`, `worker`, `backup` and `restore` keep the `default` network, which they need for the UI's port, the SMTP provider and the backup remote, and hold only their own role.
