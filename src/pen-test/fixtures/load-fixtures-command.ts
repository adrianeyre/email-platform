/**
 * `node dist/src/pen-test/fixtures/load-fixtures-command.js`, run in the pen-test deployment's `api` container by
 * `pnpm pen-test:seed`. The fixture seed arrives on standard input, never as an argument, where `ps` would show it.
 * It refuses to run anywhere `PEN_TEST_DEPLOYMENT` doesn't name the pen-test project, which only
 * `docker-compose.pen-test.yml` sets, so it can't load synthetic Users and API Keys into production.
 */
import { loadVars } from "../../config/vars.js";
import { openDatabase } from "../../lib/database.js";
import { penTestProjectName } from "../deployment/project.js";
import { loadPenTestFixtures } from "./load-fixtures.js";

const readStandardInput = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
};

const main = async () => {
  if (process.env.PEN_TEST_DEPLOYMENT !== penTestProjectName) {
    process.stderr.write(
      `Refused: PEN_TEST_DEPLOYMENT is not ${penTestProjectName}, so this is not the pen-test deployment\n`,
    );
    process.exitCode = 1;
    return;
  }
  const seed = await readStandardInput();
  const vars = loadVars();
  const database = openDatabase(vars.databaseUrl);
  try {
    const { summary } = await loadPenTestFixtures(database, {
      seed,
      encryptionKey: vars.encryptionKey,
    });
    process.stdout.write(`${summary}\n`);
  } finally {
    await database.$client.end();
  }
};

await main();
