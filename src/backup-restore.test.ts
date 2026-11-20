import { resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { asc } from "drizzle-orm";
import {
  GenericContainer,
  getContainerRuntimeClient,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
} from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDatabase, openDatabase } from "./lib/database.js";
import { templates } from "./lib/schema.js";

const postgresImage = "postgres:18-alpine";
const containersStartTimeoutMs = 300_000;
const remote = "/tmp/backups";
const identityFile = "/tmp/backup-identity.txt";
const dayMs = 86_400_000;

const formatBackupStamp = (date: Date): string =>
  date
    .toISOString()
    .replace(/:/g, "")
    .replace(/\.\d{3}Z$/, "Z");

const oldStamp = formatBackupStamp(new Date(Date.now() - 15 * dayMs));
const recentStamp = formatBackupStamp(new Date(Date.now() - dayMs));
const seededBackups = [
  `email-platform-${oldStamp}.dump.age`,
  `email-platform-${recentStamp}.dump.age`,
];

const hasContainerRuntime = await getContainerRuntimeClient().then(
  () => true,
  () => false,
);

if (!hasContainerRuntime) {
  console.warn(
    "SKIPPED src/backup-restore.test.ts: no container runtime, so no backup was taken or restored",
  );
}

const buildPostgresEnvironment = (
  container: StartedPostgreSqlContainer,
  host: string,
): Record<string, string> => ({
  PGHOST: host,
  PGUSER: container.getUsername(),
  PGPASSWORD: container.getPassword(),
  PGDATABASE: container.getDatabase(),
});

const readTemplateNames = async (connectionUri: string): Promise<string[]> => {
  const database = openDatabase(connectionUri);
  const rows = await database
    .select({ name: templates.name })
    .from(templates)
    .orderBy(asc(templates.name));
  await database.$client.end();
  return rows.map((row) => row.name);
};

describe.skipIf(!hasContainerRuntime)("the nightly backup", () => {
  let network: StartedNetwork;
  let source: StartedPostgreSqlContainer;
  let target: StartedPostgreSqlContainer;
  let backup: StartedTestContainer;
  let ageRecipient: string;

  const listBackups = async (): Promise<string[]> => {
    const listing = await backup.exec(["ls", "-1", remote]);
    return listing.stdout.split("\n").filter((name) => name !== "");
  };

  const runBackup = (environment: Record<string, string> = {}) =>
    backup.exec(["backup.sh"], {
      env: {
        ...buildPostgresEnvironment(source, "source"),
        BACKUP_AGE_RECIPIENT: ageRecipient,
        BACKUP_RCLONE_REMOTE: remote,
        ...environment,
      },
    });

  beforeAll(async () => {
    network = await new Network().start();
    const [startedSource, startedTarget, backupImage] = await Promise.all([
      new PostgreSqlContainer(postgresImage)
        .withNetwork(network)
        .withNetworkAliases("source")
        .start(),
      new PostgreSqlContainer(postgresImage)
        .withNetwork(network)
        .withNetworkAliases("target")
        .start(),
      GenericContainer.fromDockerfile(resolve("backup")).build(),
    ]);
    source = startedSource;
    target = startedTarget;
    backup = await backupImage
      .withNetwork(network)
      .withCommand(["sleep", "infinity"])
      .start();

    const database = openDatabase(source.getConnectionUri());
    await migrateDatabase(database);
    await database.insert(templates).values([
      {
        name: "Backed-up welcome",
        slug: "backed-up-welcome",
        subject: "Hi",
        html: "<p>Hi</p>",
      },
      {
        name: "Backed-up receipt",
        slug: "backed-up-receipt",
        subject: "Receipt",
        html: "<p>Paid</p>",
      },
    ]);
    await database.$client.end();

    await backup.exec(["age-keygen", "-o", identityFile]);
    ageRecipient = (
      await backup.exec(["age-keygen", "-y", identityFile])
    ).stdout.trim();
    await backup.exec([
      "sh",
      "-c",
      `mkdir -p ${remote} && cd ${remote} && touch ${seededBackups.join(" ")}`,
    ]);
  }, containersStartTimeoutMs);

  afterAll(async () => {
    await Promise.all([backup.stop(), source.stop(), target.stop()]);
    await network.stop();
  });

  it("sends an encrypted dump off-server and removes backups older than 14 days", async () => {
    const run = await runBackup();
    const backups = await listBackups();
    const newBackups = backups.filter((name) => !seededBackups.includes(name));
    const header = await backup.exec([
      "head",
      "-c",
      "21",
      `${remote}/${newBackups.at(0) ?? ""}`,
    ]);

    expect(run.exitCode, run.stderr).toBe(0);
    expect(newBackups).toHaveLength(1);
    expect(newBackups.at(0)).toMatch(
      /^email-platform-\d{4}-\d{2}-\d{2}T\d{6}Z\.dump\.age$/,
    );
    expect(header.stdout).toBe("age-encryption.org/v1");
    expect(backups).toContain(`email-platform-${recentStamp}.dump.age`);
    expect(backups).not.toContain(`email-platform-${oldStamp}.dump.age`);
  });

  it("restores the latest backup into an empty database with the same data", async () => {
    const restore = await backup.exec(["restore.sh", "latest"], {
      env: {
        ...buildPostgresEnvironment(target, "target"),
        BACKUP_AGE_IDENTITY_FILE: identityFile,
        BACKUP_RCLONE_REMOTE: remote,
      },
    });

    expect(restore.exitCode, restore.stderr).toBe(0);
    expect(await readTemplateNames(target.getConnectionUri())).toEqual([
      "Backed-up receipt",
      "Backed-up welcome",
    ]);
  });

  it("fails loudly when the off-server target is unreachable", async () => {
    const run = await runBackup({
      BACKUP_RCLONE_REMOTE: "unreachable-target:email-platform",
    });

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain(
      "backup.upload.failed remote=unreachable-target:email-platform",
    );
  });

  it("refuses to run without somewhere to send the backups", async () => {
    const run = await runBackup({ BACKUP_RCLONE_REMOTE: "" });

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("set BACKUP_RCLONE_REMOTE");
  });
});
