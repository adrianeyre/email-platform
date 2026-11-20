import { resolve } from "node:path";
import type { PgDatabase } from "drizzle-orm/pg-core";
import {
  drizzle,
  type NodePgDatabase,
  type NodePgQueryResultHKT,
} from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema> & { $client: Pool };

export type Queryable = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export const migrationsFolder = resolve("src/drizzle");

export const openDatabase = (databaseUrl: string): Database =>
  drizzle({ connection: { connectionString: databaseUrl }, schema });

export const migrateDatabase = async (database: Database): Promise<void> => {
  await migrate(database, { migrationsFolder });
};
