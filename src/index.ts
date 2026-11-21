import { resolve } from "node:path";
import {
  CliCommandRefusedError,
  readPasswordFromTerminal,
  runCliCommand,
} from "./access/cli.js";
import { buildHttpServer } from "./api/http-server.js";
import {
  loadProvisionVars,
  loadVars,
  type ProvisionVars,
  type Vars,
} from "./config/vars.js";
import { openDatabase } from "./lib/database.js";
import { provisionDatabase } from "./lib/database-roles.js";
import { describeErrorForLog } from "./lib/log.js";
import {
  buildJobQueue,
  createJobBoss,
  sendMessageRetryLimit,
  type JobPayloads,
} from "./lib/jobs.js";
import { migrateEverything } from "./lib/migrate.js";
import { sendEmailOverSmtp } from "./sending/delivery.js";
import { applyRetention } from "./sending/retention.js";
import { describeSendFailureForLog } from "./sending/send-failure.js";
import { sendQueuedMessage } from "./sending/send-worker.js";
import { checkSmtpPasswordOpens } from "./settings/settings-store.js";

const roles = ["api", "worker", "migrate", "provision", "cli"] as const;
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

// The worker log is outside Retention, so an error is logged without the values it carried (pen test D2, #126).
const logJobsError = (error: Error): void => {
  writeLog("jobs.error", { error: describeErrorForLog(error) });
};

const startJobBoss = async (vars: Vars) => {
  const boss = createJobBoss(vars.databaseUrl);
  boss.on("error", logJobsError);
  await boss.start();
  return boss;
};

const runMigrations = async (vars: Vars): Promise<void> => {
  await migrateEverything(vars.databaseUrl, logJobsError);
  writeLog("migrate.finished");
};

const runProvision = async (
  vars: ProvisionVars,
  args: readonly string[],
): Promise<void> => {
  const [database] = args;
  await provisionDatabase({
    ...vars,
    ...(database === undefined ? {} : { database }),
  });
  writeLog("provision.finished");
};

const startApi = async (vars: Vars): Promise<void> => {
  const database = openDatabase(vars.databaseUrl);
  await checkSmtpPasswordOpens(database, vars.encryptionKey);
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
  // A key that can't open the saved SMTP password stops the worker here, so Messages wait queued for the right key
  // rather than failing one by one (#167).
  await checkSmtpPasswordOpens(database, vars.encryptionKey);
  const boss = await startJobBoss(vars);
  const sendParts = {
    database,
    encryptionKey: vars.encryptionKey,
    sendEmail: sendEmailOverSmtp,
    // The owner's view of a failed try: Nodemailer's code, the command and the reply code, without the reply text a
    // Message no longer keeps either (#173), since it can quote a recipient's address (pen test D2, #126).
    onSendFailed: (messageId: string, error: unknown) => {
      writeLog("message.send.failed", {
        messageId,
        ...describeSendFailureForLog(error),
      });
    },
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
      `${await runCliCommand(database, args, readPasswordFromTerminal, vars.encryptionKey)}\n`,
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
const startRole: Record<Role, () => Promise<void>> = {
  api: () => startApi(loadVars()),
  worker: () => startWorker(loadVars()),
  migrate: () => runMigrations(loadVars()),
  provision: () => runProvision(loadProvisionVars(), args),
  cli: () => runCli(loadVars(), args),
};
await startRole[requestedRole]();
