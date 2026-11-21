/**
 * Pen test D2 (#100): the `api` role as `src/index.ts` starts it, with Fastify's request log on, so a probe can read
 * the log production writes. It differs from `startApi` only in serving no UI (`uiDirectory` is undefined, as the
 * gated run has no built UI) and listening on 127.0.0.1. `d2.test.ts` runs it in a child process and reads its stdout.
 *
 * Reads DATABASE_URL, APP_URL, ENCRYPTION_KEY and PORT (0 for any free port), as production does.
 */
import { buildHttpServer } from "../../api/http-server.js";
import { loadVars } from "../../config/vars.js";
import { openDatabase } from "../../lib/database.js";
import { describeErrorForLog } from "../../lib/log.js";
import { buildJobQueue, createJobBoss } from "../../lib/jobs.js";
import { sendEmailOverSmtp } from "../../sending/delivery.js";

const vars = loadVars();
const database = openDatabase(vars.databaseUrl);
const boss = createJobBoss(vars.databaseUrl);
boss.on("error", (error) => {
  process.stdout.write(
    `${JSON.stringify({ time: new Date().toISOString(), event: "jobs.error", error: describeErrorForLog(error) })}\n`,
  );
});
await boss.start();
const server = await buildHttpServer({
  database,
  jobs: buildJobQueue(boss),
  appUrl: vars.appUrl,
  encryptionKey: vars.encryptionKey,
  sendEmail: sendEmailOverSmtp,
  uiDirectory: undefined,
  isLogging: true,
});
process.once("SIGTERM", () => {
  void server
    .close()
    .then(() => boss.stop({ graceful: false }))
    .then(() => database.$client.end());
});
await server.listen({ host: "127.0.0.1", port: vars.port });
