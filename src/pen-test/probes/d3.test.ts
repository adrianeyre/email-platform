/**
 * Pen test D3 (#101): backups and restore. Answers H12 and H13 of the pen-testing PRD. The verdicts and evidence are
 * in `docs/pen-test/findings/D3.md`.
 *
 * The backup image is production's (`backup/Dockerfile`), run as `src/backup-restore.test.ts` runs it: a throwaway age
 * key made in the container, and a local rclone remote path standing in for the off-server target, with full access.
 * Probe 2 adds an append-only SFTP remote, the credential the runbook now asks for (#127).
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import {
  GenericContainer,
  type GenericContainer as Image,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "../../lib/database.js";
import {
  databaseRoles,
  provisionDatabase,
  type DatabaseRolePasswords,
} from "../../lib/database-roles.js";
import { messages, users } from "../../lib/schema.js";
import { applyRetention } from "../../sending/retention.js";
import {
  hasContainerRuntime,
  postgresImage,
  postgresUser,
  startProbeWorld,
  warnIfSkipped,
  type ProbeWorld,
} from "./probe-world.js";

warnIfSkipped("src/pen-test/probes/d3.test.ts");

const remote = "/tmp/backups";
const identityFile = "/tmp/backup-identity.txt";
const otherIdentityFile = "/tmp/other-identity.txt";
/** The fixtures' synthetic Wizzaroo link tokens all end so. */
const linkTokenSuffix = "-not-a-real-token";

/* ---------- Probe 5: .gitignore against every secret file the Compose file and runbooks name ---------- */

const isIgnored = (path: string): boolean =>
  spawnSync("git", ["check-ignore", "--no-index", "-q", path], {
    cwd: resolve("."),
  }).status === 0;

describe("pen test D3 (#101): .gitignore against the secret files", () => {
  it("ignores .env, rclone.conf and the pen-test deployment's state folder", () => {
    expect(
      [
        ".env",
        "rclone.conf",
        ".pen-test-deployment/.env",
        ".pen-test-deployment/age-identity.txt",
        ".pen-test-deployment/rclone.conf",
        ".pen-test-deployment/fixture-seed.txt",
        ".pen-test-deployment/credentials-package.env",
        ".npmrc",
      ].filter((path) => !isIgnored(path)),
    ).toEqual([]);
  });

  it("(regression) ignores backup-identity.txt, the restore's age identity, and key.txt, the runbook's age key (#131)", () => {
    expect(isIgnored("backup-identity.txt")).toBe(true);
    expect(isIgnored("key.txt")).toBe(true);
    // Neither has a default place in the checkout any more: the restore mounts nothing unless one is named.
    expect(readFileSync(resolve("docker-compose.yml"), "utf8")).not.toContain(
      "./backup-identity.txt",
    );
  });

  it("ignores backup-identity.txt and key.txt, the private keys that open every backup", () => {
    expect(isIgnored("backup-identity.txt")).toBe(true);
    expect(isIgnored("key.txt")).toBe(true);
  });
});

describe.skipIf(!hasContainerRuntime)(
  "pen test D3 (#101): backups and restore",
  () => {
    let world: ProbeWorld;
    let target: StartedPostgreSqlContainer;
    let backup: StartedTestContainer;
    let fullDisk: StartedTestContainer;
    let appendOnly: StartedTestContainer;
    let appendOnlyEnvironment: Record<string, string>;
    let ageRecipient: string;
    let sourceHost: string;
    let targetHost: string;
    /** The operator's record, kept off the server: each honest backup's `backup.finished` sha256, by stamp. */
    const record = new Map<string, string>();

    /** The target's roles, provisioned as production's provision does, so a restore runs as it does there (#121). */
    const targetPasswords: DatabaseRolePasswords = {
      migrate: "d3-target-migrate",
      api: "d3-target-api",
      worker: "d3-target-worker",
      backup: "d3-target-backup",
    };

    /** As Compose gives backup its login: email_platform_backup, not the superuser (#121). */
    const sourceEnvironment = () => {
      const url = new URL(world.databaseUrls.backup);
      return {
        PGHOST: sourceHost,
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGDATABASE: url.pathname.slice(1),
      };
    };

    const listBackups = async (): Promise<string[]> => {
      const listing = await backup.exec(["ls", "-1", remote]);
      return listing.stdout.split("\n").filter((name) => name !== "");
    };

    const readRecord = (stdout: string) => {
      const match =
        /^backup\.finished stamp=(\S+) size=\d+ sha256=([0-9a-f]{64})$/mu.exec(
          stdout,
        );
      return { stamp: match?.[1] ?? "", sha256: match?.[2] ?? "" };
    };

    /** Runs backup.sh once and returns the new backup's name. Stamps are to the second, so wait for a new one. */
    const takeBackup = async (): Promise<string> => {
      await new Promise((done) => setTimeout(done, 1_100));
      const before = await listBackups();
      const run = await backup.exec(["backup.sh"], {
        env: {
          ...sourceEnvironment(),
          BACKUP_AGE_RECIPIENT: ageRecipient,
          BACKUP_RCLONE_REMOTE: remote,
        },
      });
      expect(run.exitCode, run.stderr).toBe(0);
      const added = (await listBackups()).filter(
        (name) => !before.includes(name),
      );
      expect(added).toHaveLength(1);
      const { stamp, sha256 } = readRecord(run.stdout);
      record.set(stamp, sha256);
      return added[0] ?? "";
    };

    const stampOf = (name: string): string =>
      name.replace(/^email-platform-/, "").replace(/\.dump\.age$/, "");

    /** A fresh, empty, provisioned database in the target Postgres, as the runbook's RESTORE_DATABASE. */
    const createTargetDatabase = async (name: string) => {
      await provisionDatabase({
        superuserUrl: target.getConnectionUri(),
        passwords: targetPasswords,
        database: name,
      });
      const uri = new URL(target.getConnectionUri());
      uri.pathname = `/${name}`;
      return uri.toString();
    };

    /** restore.sh as the runbook runs it: with the Retention days in force now (90 unless a probe set them). */
    const restore = (
      database: string,
      args: readonly string[],
      retentionDays = "90",
    ) =>
      backup.exec(["restore.sh", ...args], {
        env: {
          PGHOST: targetHost,
          PGUSER: databaseRoles.migrate,
          PGPASSWORD: targetPasswords.migrate,
          PGDATABASE: database,
          BACKUP_AGE_IDENTITY_FILE: identityFile,
          BACKUP_RCLONE_REMOTE: remote,
          RESTORE_RETENTION_DAYS: retentionDays,
        },
      });

    const startBackupContainer = (image: Image) =>
      image.withCommand(["sleep", "infinity"]).start();

    /**
     * An append-only remote: an SFTP server whose account (the credential the server holds) may create files, and may
     * not remove, rename or rewrite them. sshd enforces it, not the client: internal-sftp refuses the remove and rename
     * requests outright, and creates every file read-only (and refuses setstat), so an existing backup can't be opened
     * to overwrite. It stands in for an S3 or B2 key with no delete permission on an object-locked bucket.
     */
    const appendOnlySetup = [
      "set -e",
      "apk add --no-cache openssh-server >/dev/null",
      "ssh-keygen -A >/dev/null",
      "adduser -D backup",
      'echo "backup:$APPEND_ONLY_PASSWORD" | chpasswd',
      "mkdir -p /home/backup/backups && chown backup /home/backup/backups",
      "printf '%s\\n' 'PasswordAuthentication yes' 'Subsystem sftp internal-sftp' 'Match User backup' '  AllowTcpForwarding no' '  ForceCommand internal-sftp -u 0222 -P remove,rmdir,rename,posix-rename,hardlink,symlink,setstat,fsetstat,lsetstat,copy-data' > /etc/ssh/sshd_config",
      "exec /usr/sbin/sshd -D -e",
    ].join("\n");
    const appendOnlyRemote = "appendonly:backups";

    beforeAll(async () => {
      const appendOnlyPassword = randomUUID();
      const [startedWorld, startedTarget, image, startedAppendOnly] =
        await Promise.all([
          startProbeWorld({ hasMailpit: false }),
          new PostgreSqlContainer(postgresImage)
            .withUsername(postgresUser)
            .withDatabase(postgresUser)
            .start(),
          GenericContainer.fromDockerfile(resolve("backup")).build(),
          new GenericContainer("alpine:3.22")
            .withEnvironment({ APPEND_ONLY_PASSWORD: appendOnlyPassword })
            .withCopyContentToContainer([
              { content: appendOnlySetup, target: "/setup.sh" },
            ])
            .withCommand(["sh", "/setup.sh"])
            .withWaitStrategy(Wait.forLogMessage(/Server listening/u))
            .start(),
        ]);
      world = startedWorld;
      target = startedTarget;
      appendOnly = startedAppendOnly;
      backup = await startBackupContainer(image);
      // "Full disk": the work folder backup.sh makes with mktemp is on a 64 KiB tmpfs.
      fullDisk = await startBackupContainer(
        image.withTmpFs({ "/tmp": "rw,size=64k,mode=1777" }),
      );
      sourceHost = world.postgres.getIpAddress("bridge");
      targetHost = target.getIpAddress("bridge");
      appendOnlyEnvironment = {
        RCLONE_CONFIG_APPENDONLY_TYPE: "sftp",
        RCLONE_CONFIG_APPENDONLY_HOST: appendOnly.getIpAddress("bridge"),
        RCLONE_CONFIG_APPENDONLY_USER: "backup",
        RCLONE_CONFIG_APPENDONLY_PASS: (
          await backup.exec(["rclone", "obscure", appendOnlyPassword])
        ).stdout.trim(),
        RCLONE_CONFIG_APPENDONLY_SHELL_TYPE: "none",
        RCLONE_CONFIG_APPENDONLY_SET_MODTIME: "false",
        RCLONE_CONFIG_APPENDONLY_KNOWN_HOSTS_FILE: "none",
        RCLONE_RETRIES: "1",
      };
      await backup.exec(["age-keygen", "-o", identityFile]);
      await backup.exec(["age-keygen", "-o", otherIdentityFile]);
      ageRecipient = (
        await backup.exec(["age-keygen", "-y", identityFile])
      ).stdout.trim();
      await backup.exec(["mkdir", "-p", remote]);
      for (const container of [backup, fullDisk]) {
        await container.exec([
          "sh",
          "-c",
          "mkdir -p /var/lib/postgresql/stub /var/lib/postgresql/remote && printf '#!/bin/sh\\nexec /bin/sleep 1\\n' > /var/lib/postgresql/stub/sleep && chmod +x /var/lib/postgresql/stub/sleep",
        ]);
      }
    }, 300_000);

    afterAll(async () => {
      await Promise.all([
        backup.stop(),
        fullDisk.stop(),
        appendOnly.stop(),
        target.stop(),
        world.stop(),
      ]);
    });

    describe("probe 1: a backup can't be read without the age identity", () => {
      it("is age-encrypted, refuses another age identity and pg_restore, holds no link in the clear, and holds every link the log keeps once decrypted with the identity", async () => {
        await world.reloadFixtures();
        const name = await takeBackup();
        const file = `${remote}/${name}`;
        const header = await backup.exec(["head", "-c", "21", file]);
        const otherKey = await backup.exec([
          "age",
          "--decrypt",
          "--identity",
          otherIdentityFile,
          "--output",
          "/dev/null",
          file,
        ]);
        const asDump = await backup.exec(["pg_restore", "--list", file]);
        const inTheClear = await backup.exec([
          "sh",
          "-c",
          `grep -a -c -- '${linkTokenSuffix}' ${file} || true`,
        ]);
        const decrypted = await backup.exec([
          "sh",
          "-c",
          `age --decrypt --identity ${identityFile} ${file} | pg_restore --data-only --table=messages -f - | grep -c -- '${linkTokenSuffix}'`,
        ]);

        expect(header.stdout).toBe("age-encryption.org/v1");
        expect(otherKey.exitCode).not.toBe(0);
        expect(otherKey.stderr).toContain(
          "no identity matched any of the recipients",
        );
        expect(asDump.exitCode).not.toBe(0);
        expect(inTheClear.stdout.trim()).toBe("0");
        // One row per queued Wizzaroo Message with a link: the backup is a copy of the log (H2), which drops a
        // Message's body, link and all, once it is sent or has failed (#116).
        expect(decrypted.stdout.trim()).toBe(
          String(
            world.plan.messages.filter(
              (message) => message.link !== null && message.status === "queued",
            ).length,
          ),
        );
      });
    });

    describe("probe 2: the backup container's rclone credential and the backups", () => {
      it("(regression) backup.sh deletes no backup, however old, unless a separate prune remote is set (#127)", async () => {
        await world.reloadFixtures();
        const old = "email-platform-2000-01-01T020000Z.dump.age";
        await backup.exec(["touch", `${remote}/${old}`]);
        try {
          await takeBackup();
          expect(await listBackups()).toContain(old);
        } finally {
          await backup.exec(["rm", "-f", `${remote}/${old}`]);
        }
      });

      it("refuses to delete a backup with the credential the server holds", async () => {
        const run = await backup.exec(["backup.sh"], {
          env: {
            ...sourceEnvironment(),
            ...appendOnlyEnvironment,
            BACKUP_AGE_RECIPIENT: ageRecipient,
            BACKUP_RCLONE_REMOTE: appendOnlyRemote,
          },
        });
        const { stamp, sha256 } = readRecord(run.stdout);
        const file = `${appendOnlyRemote}/email-platform-${stamp}.dump.age`;
        const asRemote = { env: appendOnlyEnvironment };
        const deleteOne = await backup.exec(
          ["rclone", "deletefile", file],
          asRemote,
        );
        const deleteAll = await backup.exec(
          ["rclone", "delete", appendOnlyRemote],
          asRemote,
        );
        const overwrite = await backup.exec(
          ["rclone", "copyto", "--inplace", "/etc/hostname", file],
          asRemote,
        );
        const listing = await backup.exec(
          ["rclone", "lsf", appendOnlyRemote],
          asRemote,
        );
        const kept = await backup.exec(
          ["sh", "-c", `rclone cat ${file} | sha256sum`],
          asRemote,
        );

        // backup.sh works with a credential that can only add.
        expect(run.exitCode, run.stderr).toBe(0);
        expect(deleteOne.exitCode).not.toBe(0);
        expect(deleteOne.stderr).toContain("permission denied");
        expect(deleteAll.exitCode).not.toBe(0);
        expect(overwrite.exitCode).not.toBe(0);
        expect(listing.stdout).toContain(`email-platform-${stamp}.dump.age`);
        expect(kept.stdout.split(" ")[0]).toBe(sha256);
      });

      const plantedEmail = "planted@attacker.pen-test.invalid";
      const forgedFile = "/tmp/forged.dump.age";

      /**
       * Writes, with what the server holds (the rclone credential and the public recipient), a dump holding a planted
       * User, named as the latest backup; then takes an honest backup without the User.
       */
      const forgeLatestBackup = async () => {
        await world.reloadFixtures();
        await world.database
          .insert(users)
          .values({ email: plantedEmail, passwordHash: "planted-not-a-hash" });
        const forgedName = "email-platform-2099-01-01T000000Z.dump.age";
        const forged = await backup.exec(
          [
            "sh",
            "-c",
            `pg_dump --format=custom | age --recipient "$BACKUP_AGE_RECIPIENT" > ${forgedFile} && rclone copyto ${forgedFile} ${remote}/${forgedName}`,
          ],
          {
            env: { ...sourceEnvironment(), BACKUP_AGE_RECIPIENT: ageRecipient },
          },
        );
        expect(forged.exitCode, forged.stderr).toBe(0);
        const forgedSha256 = (
          await backup.exec(["sh", "-c", `sha256sum ${forgedFile}`])
        ).stdout.split(" ")[0];
        await world.database.delete(users).where(eq(users.email, plantedEmail));
        const honestName = await takeBackup();
        return { forgedName, forgedSha256: forgedSha256 ?? "", honestName };
      };

      const restoredUsers = async (database: string) => {
        const restored = openDatabase(database);
        try {
          const table = await restored.$client.query<{ name: string | null }>(
            "select to_regclass('users')::text as name",
          );
          if ((table.rows[0]?.name ?? null) === null) {
            return [];
          }
          const rows = await restored
            .select({ email: users.email })
            .from(users);
          return rows.map((row) => row.email);
        } finally {
          await restored.$client.end();
        }
      };

      it("(regression) restores no backup as the latest, names the forged future stamp as refused, and refuses it even with its own sha256 (#128)", async () => {
        const { forgedName, forgedSha256 } = await forgeLatestBackup();
        try {
          const uri = await createTargetDatabase("forged_regression");
          const latest = await restore("forged_regression", ["latest"]);
          const named = await restore("forged_regression", [
            stampOf(forgedName),
            forgedSha256,
          ]);

          expect(latest.exitCode).not.toBe(0);
          expect(latest.stderr).toContain(
            "backup.restore.refused reason=needs-stamp-and-sha256",
          );
          expect(latest.stdout).toMatch(
            /^backup\.restore\.listed stamp=2099-01-01T000000Z size=\d+ modified=\S+ refused=future-stamp$/mu,
          );
          expect(named.exitCode).not.toBe(0);
          expect(named.stderr).toContain(
            "backup.restore.refused reason=future-stamp stamp=2099-01-01T000000Z",
          );
          expect(await restoredUsers(uri)).toEqual([]);
        } finally {
          await backup.exec(["rm", "-f", `${remote}/${forgedName}`]);
        }
      });

      it("refuses to restore a backup the server could have forged", async () => {
        const { forgedName, honestName } = await forgeLatestBackup();
        const honestStamp = stampOf(honestName);
        // The forger's other move: put the forged dump under the name of a backup the record holds.
        await backup.exec(["cp", forgedFile, `${remote}/${honestName}`]);
        try {
          const uri = await createTargetDatabase("forged_fails");
          await restore("forged_fails", ["latest"]);
          await restore("forged_fails", [
            honestStamp,
            record.get(honestStamp) ?? "",
          ]);
          expect(await restoredUsers(uri)).not.toContain(plantedEmail);
        } finally {
          await backup.exec([
            "rm",
            "-f",
            `${remote}/${forgedName}`,
            `${remote}/${honestName}`,
          ]);
        }
      });
    });

    describe("probe 3: a night that fails", () => {
      /** nightly.sh as the backup container runs it, with `sleep` cut to a second, for at most 12 seconds. */
      const runNights = (
        container: StartedTestContainer,
        environment: Record<string, string>,
      ) =>
        container.exec(
          [
            "sh",
            "-c",
            'PATH=/var/lib/postgresql/stub:$PATH timeout 12 nightly.sh; echo "nightly.exit=$?"; backup-health.sh; echo "health.exit=$?"',
          ],
          {
            env: {
              ...sourceEnvironment(),
              BACKUP_AGE_RECIPIENT: ageRecipient,
              ...environment,
            },
          },
        );

      const countFailures = (stderr: string) =>
        stderr
          .split("\n")
          .filter((line) => line.startsWith("backup.nightly.failed")).length;

      it("(regression) with a bad remote, stops after the night that failed and is unhealthy until one succeeds (#129)", async () => {
        const run = await runNights(backup, {
          BACKUP_RCLONE_REMOTE: "unreachable-target:email-platform",
          BACKUP_STATE_DIR: "/var/lib/postgresql/state-bad-remote",
        });

        expect(run.stderr).toContain(
          "backup.upload.failed remote=unreachable-target:email-platform",
        );
        expect(countFailures(run.stderr)).toBe(1);
        expect(run.stdout).toContain("nightly.exit=1");
        expect(run.stdout).toContain(
          "backup.health.failed reason=last-night-failed",
        );
        expect(run.stdout).toContain("health.exit=1");
      });

      it("(regression) with a full disk, names the dump step, stops, is unhealthy, and leaves no backup (#129)", async () => {
        const run = await runNights(fullDisk, {
          BACKUP_RCLONE_REMOTE: "/var/lib/postgresql/remote",
          BACKUP_STATE_DIR: "/var/lib/postgresql/state-full-disk",
        });
        const listing = await fullDisk.exec([
          "ls",
          "-1",
          "/var/lib/postgresql/remote",
        ]);

        expect(run.stderr).toContain(
          "age: error: write /dev/stdout: no space left on device",
        );
        expect(run.stderr).toContain("backup.dump.failed");
        expect(countFailures(run.stderr)).toBe(1);
        expect(run.stdout).toContain("nightly.exit=1");
        expect(run.stdout).toContain("health.exit=1");
        expect(listing.stdout.trim()).toBe("");
      });

      it("stops, so the container is seen to fail, when a night's backup fails", async () => {
        const run = await runNights(backup, {
          BACKUP_RCLONE_REMOTE: "unreachable-target:email-platform",
          BACKUP_STATE_DIR: "/var/lib/postgresql/state-stops",
        });
        expect(countFailures(run.stderr)).toBe(1);
        expect(run.stdout).not.toContain("nightly.exit=143");
      });
    });

    describe("probe 4: Retention, then a restore of a backup taken before it", () => {
      const sweepAfterBackup = async () => {
        await world.reloadFixtures();
        const name = await takeBackup();
        const response = await world.request(
          { user: "victim" },
          {
            method: "PUT",
            url: "/app/settings",
            payload: { logRetentionDays: 1 },
          },
        );
        expect(response.statusCode).toBe(200);
        const before = await world.database
          .select({ id: messages.id })
          .from(messages);
        await applyRetention(world.database, new Date());
        const after = await world.database
          .select({ id: messages.id })
          .from(messages);
        const kept = new Set(after.map((row) => row.id));
        const deleted = before
          .map((row) => row.id)
          .filter((id) => !kept.has(id));
        const stamp = stampOf(name);
        return { stamp, sha256: record.get(stamp) ?? "", deleted };
      };

      const readRestored = async (uri: string) => {
        const restored = openDatabase(uri);
        try {
          const rows = await restored
            .select({ id: messages.id, text: messages.text })
            .from(messages);
          const retention = await restored.$client.query<{ days: number }>(
            "select log_retention_days as days from settings",
          );
          return { rows, retentionDays: retention.rows[0]?.days };
        } finally {
          await restored.$client.end();
        }
      };

      it("(regression) re-applies today's Retention: brings back no Message it deleted, and keeps the Retention setting set since (#130)", async () => {
        const { stamp, sha256, deleted } = await sweepAfterBackup();
        const uri = await createTargetDatabase("after_retention_regression");
        // The runbook's RESTORE_RETENTION_DAYS: the Retention in force now, 1 day.
        const restored = await restore(
          "after_retention_regression",
          [stamp, sha256],
          "1",
        );
        const { rows, retentionDays } = await readRestored(uri);
        await world.reloadFixtures();
        const linkedPlan = world.plan.messages.filter(
          (message) => message.link !== null && deleted.includes(message.id),
        );

        expect(restored.exitCode, restored.stderr).toBe(0);
        expect(restored.stdout).toContain(
          "backup.restore.retention-applied days=1 deleted_messages=",
        );
        expect(deleted.length).toBeGreaterThan(0);
        expect(rows.filter((row) => deleted.includes(row.id))).toEqual([]);
        expect(linkedPlan.length).toBeGreaterThan(0);
        for (const message of linkedPlan) {
          const { link } = message;
          expect(
            rows.some(
              (row) => link !== null && row.text?.includes(link) === true,
            ),
          ).toBe(false);
        }
        expect(retentionDays).toBe(1);
      });

      it("brings back no Message a Retention sweep deleted after the backup was taken", async () => {
        const { stamp, sha256, deleted } = await sweepAfterBackup();
        const uri = await createTargetDatabase("after_retention_fails");
        await restore("after_retention_fails", [stamp, sha256], "1");
        const { rows } = await readRestored(uri);
        await world.reloadFixtures();
        expect(rows.filter((row) => deleted.includes(row.id))).toEqual([]);
      });
    });
  },
);
