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
import { openDatabase } from "./lib/database.js";
import {
  databaseRoles,
  provisionDatabase,
  roleUrl,
  type DatabaseRolePasswords,
} from "./lib/database-roles.js";
import { migrateEverything } from "./lib/migrate.js";
import { settings, templates } from "./lib/schema.js";

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

/** The same password for each role in both Postgres servers: what matters here is which role each step logs in as. */
const passwords: DatabaseRolePasswords = {
  migrate: "backup-test-migrate",
  api: "backup-test-api",
  worker: "backup-test-worker",
  backup: "backup-test-backup",
};

/** As Compose gives them: backup logs in as email_platform_backup, restore as email_platform_migrate (#121). */
const buildPostgresEnvironment = (
  container: StartedPostgreSqlContainer,
  host: string,
  role: "backup" | "migrate",
): Record<string, string> => ({
  PGHOST: host,
  PGUSER: databaseRoles[role],
  PGPASSWORD: passwords[role],
  PGDATABASE: container.getDatabase(),
});

const urlFor = (
  container: StartedPostgreSqlContainer,
  role: "migrate" | "api",
): string => roleUrl(container.getConnectionUri(), role, passwords[role]);

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
        ...buildPostgresEnvironment(source, "source", "backup"),
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

    // Provisioned and migrated as production's provision and migrate do, so the dump is of production's arrangement.
    for (const container of [source, target]) {
      await provisionDatabase({
        superuserUrl: container.getConnectionUri(),
        passwords,
      });
    }
    await migrateEverything(urlFor(source, "migrate"), (error) => {
      throw error;
    });
    const database = openDatabase(urlFor(source, "api"));
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

  /** The `backup.finished` line: the record of a backup the operator keeps a copy of off the server. */
  const readRecord = (stdout: string) => {
    const match =
      /^backup\.finished stamp=(\S+) size=(\d+) sha256=([0-9a-f]{64})$/mu.exec(
        stdout,
      );
    return {
      stamp: match?.[1] ?? "",
      size: match?.[2] ?? "",
      sha256: match?.[3] ?? "",
    };
  };

  let record = readRecord("");

  const runRestore = (
    args: string[],
    environment: Record<string, string> = {},
  ) =>
    backup.exec(["restore.sh", ...args], {
      env: {
        ...buildPostgresEnvironment(target, "target", "migrate"),
        BACKUP_AGE_IDENTITY_FILE: identityFile,
        BACKUP_RCLONE_REMOTE: remote,
        RESTORE_RETENTION_DAYS: "90",
        ...environment,
      },
    });

  const countTargetTables = async (): Promise<string> =>
    (
      await target.exec([
        "psql",
        "-U",
        target.getUsername(),
        "-d",
        target.getDatabase(),
        "-tAc",
        "select count(*) from information_schema.tables where table_schema = 'public'",
      ])
    ).stdout.trim();

  it("sends an encrypted dump off-server, logs its size and sha256, and deletes no backup (#127)", async () => {
    const run = await runBackup();
    const backups = await listBackups();
    const newBackups = backups.filter((name) => !seededBackups.includes(name));
    const file = `${remote}/${newBackups.at(0) ?? ""}`;
    const header = await backup.exec(["head", "-c", "21", file]);
    const sum = await backup.exec(["sha256sum", file]);
    const size = await backup.exec(["sh", "-c", `wc -c < ${file}`]);
    record = readRecord(run.stdout);

    expect(run.exitCode, run.stderr).toBe(0);
    expect(newBackups).toHaveLength(1);
    expect(newBackups.at(0)).toMatch(
      /^email-platform-\d{4}-\d{2}-\d{2}T\d{6}Z\.dump\.age$/,
    );
    expect(newBackups.at(0)).toBe(`email-platform-${record.stamp}.dump.age`);
    expect(header.stdout).toBe("age-encryption.org/v1");
    expect(sum.stdout.split(" ")[0]).toBe(record.sha256);
    expect(size.stdout.trim()).toBe(record.size);
    // Old backups are the remote's lifecycle rule's to delete, not the server's.
    expect(backups).toEqual(expect.arrayContaining(seededBackups));
    expect(run.stdout).not.toContain("backup.old-backup.deleted");
  });

  it("restores nothing without a named backup and its sha256, and lists the backups instead (#128)", async () => {
    for (const args of [[], ["latest"], [record.stamp]]) {
      const restore = await runRestore(args);

      expect(restore.exitCode).not.toBe(0);
      expect(restore.stderr).toContain(
        "backup.restore.refused reason=needs-stamp-and-sha256",
      );
      expect(restore.stdout).toContain(
        `backup.restore.listed stamp=${record.stamp} size=${record.size} modified=`,
      );
    }
    expect(await countTargetTables()).toBe("0");
  });

  it("refuses a backup whose sha256 isn't the record's (#128)", async () => {
    const restore = await runRestore([record.stamp, "0".repeat(64)]);

    expect(restore.exitCode).not.toBe(0);
    expect(restore.stderr).toContain(
      `backup.restore.refused reason=sha256-mismatch stamp=${record.stamp}`,
    );
    expect(await countTargetTables()).toBe("0");
  });

  it("refuses to restore without an age identity, or without the Retention days to apply", async () => {
    const noIdentity = await runRestore([record.stamp, record.sha256], {
      BACKUP_AGE_IDENTITY_FILE: "/dev/null",
    });
    const noRetention = await runRestore([record.stamp, record.sha256], {
      RESTORE_RETENTION_DAYS: "",
    });
    const badRetention = await runRestore([record.stamp, record.sha256], {
      RESTORE_RETENTION_DAYS: "0",
    });

    expect(noIdentity.exitCode).not.toBe(0);
    expect(noIdentity.stderr).toContain(
      "backup.restore.refused reason=no-identity",
    );
    expect(noRetention.exitCode).not.toBe(0);
    expect(noRetention.stderr).toContain("set RESTORE_RETENTION_DAYS");
    expect(badRetention.exitCode).not.toBe(0);
    expect(badRetention.stderr).toContain(
      "backup.restore.refused reason=bad-retention-days",
    );
    expect(await countTargetTables()).toBe("0");
  });

  it("restores the named backup into an empty database with the same data, and today's Retention (#130)", async () => {
    const restore = await runRestore([record.stamp, record.sha256], {
      RESTORE_RETENTION_DAYS: "30",
    });

    expect(restore.exitCode, restore.stderr).toBe(0);
    expect(restore.stdout).toContain(
      `backup.restore.verified stamp=${record.stamp} size=${record.size} sha256=${record.sha256}`,
    );
    expect(restore.stdout).toContain(
      "backup.restore.retention-applied days=30 deleted_messages=0",
    );
    // Read back as the api, so the restore brought back its grants as well as the data.
    expect(await readTemplateNames(urlFor(target, "api"))).toEqual([
      "Backed-up receipt",
      "Backed-up welcome",
    ]);
    const database = openDatabase(urlFor(target, "api"));
    const rows = await database
      .select({ days: settings.logRetentionDays })
      .from(settings);
    await database.$client.end();
    expect(rows.map((row) => row.days)).toEqual([30]);
  });

  it("prunes backups older than BACKUP_KEEP_DAYS only through BACKUP_PRUNE_RCLONE_REMOTE", async () => {
    const run = await runBackup({ BACKUP_PRUNE_RCLONE_REMOTE: remote });
    const backups = await listBackups();

    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.stdout).toContain(
      `backup.old-backup.deleted remote=${remote} name=email-platform-${oldStamp}.dump.age`,
    );
    expect(backups).toContain(`email-platform-${recentStamp}.dump.age`);
    expect(backups).not.toContain(`email-platform-${oldStamp}.dump.age`);
  });

  it("records each run for the healthcheck, so a backup run by hand after a failed night turns it healthy (#129)", async () => {
    const state = { BACKUP_STATE_DIR: "/tmp/run-state" };
    const health = () =>
      backup.exec(["backup-health.sh"], {
        env: { ...state, BACKUP_MAX_AGE_HOURS: "26" },
      });

    await runBackup({ ...state, BACKUP_RCLONE_REMOTE: "unreachable:nowhere" });
    const afterFailure = await health();
    await new Promise((done) => setTimeout(done, 1_100));
    await runBackup(state);
    const afterSuccess = await health();

    expect(afterFailure.exitCode).toBe(1);
    expect(afterSuccess.exitCode, afterSuccess.stdout).toBe(0);
  });

  it("names the dump step when pg_dump fails (#129)", async () => {
    const run = await runBackup({ PGHOST: "no-such-host" });

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("backup.dump.failed");
  });

  it("is healthy after a recent success, and unhealthy after a failed night or 26 hours with no success (#129)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const health = (state: Record<string, number>) =>
      backup.exec([
        "sh",
        "-c",
        [
          "rm -rf /tmp/health-state && mkdir /tmp/health-state",
          ...Object.entries(state).map(
            ([name, time]) =>
              `echo ${String(time)} > /tmp/health-state/${name}`,
          ),
          "BACKUP_STATE_DIR=/tmp/health-state backup-health.sh",
        ].join(" && "),
      ]);
    const hours = (count: number) => now - count * 3600;

    const fresh = await health({ started: hours(1) });
    const recent = await health({
      started: hours(50),
      "last-success": hours(2),
    });
    const failed = await health({
      started: hours(50),
      "last-success": hours(26),
      "last-failure": hours(2),
    });
    const stale = await health({
      started: hours(50),
      "last-success": hours(27),
    });
    const neverRan = await health({});

    expect(fresh.exitCode, fresh.stdout).toBe(0);
    expect(recent.exitCode, recent.stdout).toBe(0);
    expect(failed.exitCode).toBe(1);
    expect(failed.stdout).toContain("reason=last-night-failed");
    expect(stale.exitCode).toBe(1);
    expect(stale.stdout).toContain("reason=no-recent-success");
    expect(neverRan.exitCode).toBe(1);
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
