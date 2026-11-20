import { resolve } from "node:path";
import {
  CliCommandRefusedError,
  readPasswordFromTerminal,
  runCliCommand,
} from "./access/cli.js";
import { buildHttpServer } from "./api/http-server.js";
import { loadVars, type Vars } from "./config/vars.js";
import { migrateDatabase, openDatabase } from "./lib/database.js";
import { describeError } from "./lib/http.js";
import {
  buildJobQueue,
  createJobBoss,
  createJobQueues,
  sendMessageRetryLimit,
  type JobPayloads,
} from "./lib/jobs.js";
import { sendEmailOverSmtp } from "./sending/delivery.js";
import { applyRetention } from "./sending/retention.js";
import { sendQueuedMessage } from "./sending/send-worker.js";

const roles = ["api", "worker", "migrate", "cli"] as const;
type Role = (typeof roles)[number];

const isRole = (value: string | undefined): value is Role =>
  roles.some((role) => role === value);

const writeLog = (
  event: string,
  details: Record<string, unknown> = {},
): void => {
  process.stdout.write(
    `${JSON.stringify({ time: new Date().toISOString(), event, ...details })}\n`,
  );
};

const startJobBoss = async (vars: Vars) => {
  const boss = createJobBoss(vars.databaseUrl);
  boss.on("error", (error) => {
    writeLog("jobs.error", { error: describeError(error) });
  });
  await boss.start();
  return boss;
};

const runMigrations = async (vars: Vars): Promise<void> => {
  const database = openDatabase(vars.databaseUrl);
  await migrateDatabase(database);
  await database.$client.end();
  const boss = await startJobBoss(vars);
  await createJobQueues(boss);
  await boss.stop({ graceful: false });
  writeLog("migrate.finished");
};

const startApi = async (vars: Vars): Promise<void> => {
  const database = openDatabase(vars.databaseUrl);
  const boss = await startJobBoss(vars);
  const server = await buildHttpServer({
    database,
    jobs: buildJobQueue(boss),
    appUrl: vars.appUrl,
    encryptionKey: vars.encryptionKey,
    sendEmail: sendEmailOverSmtp,
    uiDirectory: resolve("dist/ui"),
    isLogging: true,
  });
  process.once("SIGTERM", () => {
    void server.close().then(() => boss.stop());
  });
  await server.listen({ host: "0.0.0.0", port: vars.port });
};

const startWorker = async (vars: Vars): Promise<void> => {
  const database = openDatabase(vars.databaseUrl);
  const boss = await startJobBoss(vars);
  const sendParts = {
    database,
    encryptionKey: vars.encryptionKey,
    sendEmail: sendEmailOverSmtp,
  };

  await boss.work<JobPayloads["send-message"]>(
    "send-message",
    { batchSize: 1 },
    async ([job]) => {
      if (job !== undefined) {
        const outcome = await sendQueuedMessage(sendParts, job.data.messageId, {
          retryCount: job.retryCount,
          retryLimit: sendMessageRetryLimit,
        });
        writeLog("message.send.finished", {
          messageId: job.data.messageId,
          outcome,
        });
      }
    },
  );
  await boss.work("apply-retention", async () => {
    const summary = await applyRetention(database, new Date());
    writeLog("retention.finished", { ...summary });
  });
  await boss.schedule("apply-retention", "30 3 * * *");

  process.once("SIGTERM", () => {
    void boss.stop().then(() => database.$client.end());
  });
  writeLog("worker.started");
};

const runCli = async (vars: Vars, args: readonly string[]): Promise<void> => {
  const database = openDatabase(vars.databaseUrl);
  try {
    process.stdout.write(
      `${await runCliCommand(database, args, readPasswordFromTerminal)}\n`,
    );
  } catch (error) {
    if (!(error instanceof CliCommandRefusedError)) {
      throw error;
    }
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } finally {
    await database.$client.end();
  }
};

const [, , requestedRole = "api", ...args] = process.argv;
if (!isRole(requestedRole)) {
  process.stderr.write(`Run one of: ${roles.join(", ")}\n`);
  process.exit(1);
}
const vars = loadVars();
const startRole: Record<Role, () => Promise<void>> = {
  api: () => startApi(vars),
  worker: () => startWorker(vars),
  migrate: () => runMigrations(vars),
  cli: () => runCli(vars, args),
};
await startRole[requestedRole]();
