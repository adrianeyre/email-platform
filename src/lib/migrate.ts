import { migrateDatabase, openDatabase } from "./database.js";
import { grantRuntimeAccess } from "./database-roles.js";
import {
  createJobQueues,
  createMigratingJobBoss,
  waitForJobSchemaBuilds,
} from "./jobs.js";

/**
 * Everything `migrate` does, in order: Drizzle's migrations, pg-boss's install or migration and its queues, then the
 * runtime roles' grants on whatever those made. In production it logs in as `email_platform_migrate`, so all of it is
 * the owner's (#121).
 */
export const migrateEverything = async (
  databaseUrl: string,
  onJobsError: (error: Error) => void,
): Promise<void> => {
  const database = openDatabase(databaseUrl);
  try {
    await migrateDatabase(database);
    const boss = createMigratingJobBoss(databaseUrl);
    boss.on("error", onJobsError);
    await boss.start();
    try {
      await createJobQueues(boss);
      await waitForJobSchemaBuilds(boss);
    } finally {
      await boss.stop({ graceful: false });
    }
    await grantRuntimeAccess(database);
  } finally {
    await database.$client.end();
  }
};
