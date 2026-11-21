/**
 * Pen test D2 (#100): the log, Retention and the personal data it holds. Answers H2 and H12 of the pen-testing PRD.
 * The verdicts and evidence are in `docs/pen-test/findings/D2.md`.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq, notInArray } from "drizzle-orm";
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { messageAttachments, messages } from "../../lib/schema.js";
import { applyRetention, bodyDroppedError } from "../../sending/retention.js";
import { builtInEmails } from "../../templates/built-in-emails.js";
import { fixtureDomain, wizzarooLinkOrigin } from "../fixtures/fixture-plan.js";
import {
  hasContainerRuntime,
  mailpitImage,
  startProbeWorld,
  warnIfSkipped,
  type ProbeWorld,
} from "./probe-world.js";

warnIfSkipped("src/pen-test/probes/d2.test.ts");

describe("pen test D2 (#100): the container logs' bound", () => {
  const compose = readFileSync(resolve("docker-compose.yml"), "utf8");

  /** A top-level block of the Compose file, from its key to the next line that starts in the first column. */
  const topLevelBlock = (key: string): string =>
    new RegExp(`^${key}:.*\\n((?:[ #].*\\n|\\n)*)`, "m").exec(compose)?.[1] ??
    "";
  const serviceBlock = (name: string): string =>
    new RegExp(`^ {2}${name}:\\n((?: {4}.*\\n|\\n)*)`, "m").exec(
      topLevelBlock("services"),
    )?.[1] ?? "";

  it("(regression) docker-compose.yml bounds every service's json-file log to three 10 MB files (#126)", () => {
    const logging = topLevelBlock("x-logging");
    expect(logging).toMatch(/driver: json-file/);
    expect(logging).toMatch(/max-size: 10m/);
    expect(logging).toMatch(/max-file: "3"/);
    expect(topLevelBlock("x-app")).toMatch(/^ {2}logging: \*logging$/m);
    for (const name of ["migrate", "api", "worker"]) {
      expect(serviceBlock(name), name).toMatch(/<<: \*app/);
    }
    for (const name of ["postgres", "backup", "restore"]) {
      expect(serviceBlock(name), name).toMatch(/^ {4}logging: \*logging$/m);
    }
  });

  it("bounds the api and worker container logs, so a search term in them goes within Retention", () => {
    expect(compose).toMatch(/^\s*logging:/m);
  });
});

const repoRoot = resolve(".");
const dayMs = 86_400_000;

/** Handlebars escapes `&<>"'`=` in `{{…}}`; a browser reading the href undoes it, so the probe does too. */
const decodeHtml = (html: string): string =>
  html
    .replaceAll("&#x3D;", "=")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#x60;", "`")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

const newToken = (): string => randomBytes(16).toString("hex");

/** The Built-in emails that carry a link, and the variables that hold one. */
const linkedBuiltIns = builtInEmails
  .map((email) => ({
    slug: email.slug,
    sampleVariables: email.sampleVariables,
    linkVariables: Object.keys(email.sampleVariables).filter((name) =>
      name.endsWith("Url"),
    ),
  }))
  .filter((email) => email.linkVariables.length > 0);

const resetBuiltIn = () => {
  const reset = linkedBuiltIns.find(
    (email) => email.slug === "wizzaroo-reset-your-password",
  );
  if (reset === undefined) {
    throw new Error("No reset Built-in");
  }
  return reset;
};

/** Variables for a Built-in, each link a fresh synthetic credential on Wizzaroo's fixture origin. */
const variablesWithLinks = (
  email: (typeof linkedBuiltIns)[number],
  recipient: string,
): { variables: Record<string, unknown>; links: string[] } => {
  const links: string[] = [];
  const variables = Object.fromEntries(
    Object.entries(email.sampleVariables).map(([name, value]) => {
      if (name === "email") {
        return [name, recipient];
      }
      if (email.linkVariables.includes(name) && typeof value === "string") {
        const link = `${wizzarooLinkOrigin}${new URL(value).pathname}?token=${newToken()}`;
        links.push(link);
        return [name, link];
      }
      return [name, value];
    }),
  );
  return { variables, links };
};

const readString = (value: unknown, key: string): string => {
  const field: unknown =
    typeof value === "object" && value !== null
      ? Reflect.get(value, key)
      : undefined;
  return typeof field === "string" ? field : "";
};

const waitFor = async (
  check: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<void> => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) {
      return;
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`Timed out waiting for ${what}`);
};

interface RunningChild {
  child: ChildProcess;
  output: () => string;
  stop: () => Promise<void>;
}

/** Runs a TypeScript entry with tsx in a child process, as `pnpm run:local` does, and keeps what it writes. */
const startChild = (
  args: readonly string[],
  environment: Record<string, string>,
): RunningChild => {
  const child = spawn(process.execPath, ["--import", "tsx", ...args], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      ...environment,
    },
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  return {
    child,
    output: () => output,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      await exited;
      clearTimeout(timer);
    },
  };
};

describe.skipIf(!hasContainerRuntime)(
  "pen test D2 (#100): the log, Retention and the personal data it holds",
  () => {
    let world: ProbeWorld;

    beforeAll(async () => {
      world = await startProbeWorld();
    }, 300_000);

    afterAll(async () => {
      await world.stop();
    });

    /** Every column in the database, in every schema, whose text holds the needle. */
    const findCopies = async (needle: string): Promise<string[]> => {
      const columns = await world.database.$client.query<{
        table_schema: string;
        table_name: string;
        column_name: string;
      }>(
        `select c.table_schema, c.table_name, c.column_name
           from information_schema.columns c
           join information_schema.tables t using (table_schema, table_name)
          where t.table_type = 'BASE TABLE'
            and c.table_schema not in ('pg_catalog', 'information_schema')
          order by 1, 2, 3`,
      );
      const pattern = `%${needle.replace(/[\\%_]/g, "\\$&")}%`;
      const places: string[] = [];
      for (const column of columns.rows) {
        const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
        const result = await world.database.$client.query<{ n: number }>(
          `select count(*)::int as n from ${quote(column.table_schema)}.${quote(column.table_name)} where ${quote(column.column_name)}::text like $1`,
          [pattern],
        );
        if ((result.rows[0]?.n ?? 0) > 0) {
          places.push(
            `${column.table_schema}.${column.table_name}.${column.column_name}`,
          );
        }
      }
      return places;
    };

    const sendBuiltIn = async (
      email: (typeof linkedBuiltIns)[number],
      recipient: string,
    ) => {
      const { variables, links } = variablesWithLinks(email, recipient);
      const response = await world.request(
        { key: "wizzaroo" },
        {
          method: "POST",
          url: "/v1/messages",
          payload: { templateSlug: email.slug, to: [recipient], variables },
        },
      );
      const body: unknown = response.json();
      return { status: response.statusCode, id: readString(body, "id"), links };
    };

    const readRow = async (id: string) => {
      const [row] = await world.database
        .select()
        .from(messages)
        .where(eq(messages.id, id));
      if (row === undefined) {
        throw new Error(`Message ${id} is not in the log`);
      }
      return row;
    };

    /** Sends every linked Built-in through /v1 and delivers it through Mailpit, as the worker would. */
    const sendAndDeliverEveryLinkedBuiltIn = async () => {
      await world.reloadFixtures();
      await world.clearMail();
      const sent = [];
      for (const [index, email] of linkedBuiltIns.entries()) {
        const recipient = `d2-probe1-${String(index)}@families.${fixtureDomain}`;
        const { status, id, links } = await sendBuiltIn(email, recipient);
        expect(status).toBe(202);
        expect(await world.deliver(id)).toBe("sent");
        sent.push({ slug: email.slug, recipient, id, links });
      }
      return sent;
    };

    describe("probe 1: the link in each Built-in email's stored body", () => {
      it("(regression) delivers each Built-in email's link to Mailpit exactly as Wizzaroo sent it, and keeps neither html nor text in the sent Message", async () => {
        const sent = await sendAndDeliverEveryLinkedBuiltIn();
        const mail = await world.listMail();

        expect(sent.map((item) => item.slug)).toEqual([
          "wizzaroo-confirm-your-email-address",
          "wizzaroo-reset-your-password",
          "wizzaroo-teacher-invite",
          "wizzaroo-parent-invite",
          "wizzaroo-family-device-signed-in",
          "wizzaroo-family-join-request",
        ]);
        for (const item of sent) {
          const row = await readRow(item.id);
          const summary = mail.find((entry) =>
            entry.To.some((to) => to.Address === item.recipient),
          );
          const delivered: unknown = await (
            await fetch(
              `${world.mailpitApi ?? ""}/api/v1/message/${summary?.ID ?? ""}`,
            )
          ).json();
          expect(row.status).toBe("sent");
          expect({ html: row.html, text: row.text }).toEqual({
            html: null,
            text: null,
          });
          for (const link of item.links) {
            expect(decodeHtml(readString(delivered, "HTML"))).toContain(
              `href="${link}"`,
            );
            expect(readString(delivered, "Text")).toContain(link);
          }
        }
      });

      it("keeps no working account link in a sent Message's stored html or text", async () => {
        const sent = await sendAndDeliverEveryLinkedBuiltIn();
        for (const item of sent) {
          const row = await readRow(item.id);
          for (const link of item.links) {
            const token = new URL(link).searchParams.get("token") ?? "";
            expect(row.html ?? "").not.toContain(token);
            expect(row.text ?? "").not.toContain(token);
          }
        }
      });
    });

    describe("probe 2: who can read a Wizzaroo Message", () => {
      const sentWizzarooLink = () => {
        const message = world.plan.messages.find(
          (item) =>
            item.application === "wizzaroo" &&
            item.status === "sent" &&
            item.templateSlug === "wizzaroo-reset-your-password",
        );
        if (message?.link == null) {
          throw new Error("The fixtures have no sent Wizzaroo reset");
        }
        return { id: message.id, link: message.link };
      };

      it("(regression) serves a sent Wizzaroo password reset to every User through GET /app/messages/:id with its summary but no body or link, even from a row sent before the body was dropped", async () => {
        await world.reloadFixtures();
        const { id, link } = sentWizzarooLink();
        const token = new URL(link).searchParams.get("token") ?? "";
        // A row sent before the deploy that drops bodies, should one survive the migration.
        await world.database
          .update(messages)
          .set({ html: `<a href="${link}">Reset</a>`, text: link })
          .where(eq(messages.id, id));
        try {
          for (const user of ["victim", "colleague"] as const) {
            const response = await world.request(
              { user },
              { method: "GET", url: `/app/messages/${id}` },
            );
            const body: unknown = response.json();
            expect(response.statusCode).toBe(200);
            expect(body).toMatchObject({
              id,
              status: "sent",
              subject: "Reset your Wizzaroo password",
              isBodyKept: false,
              html: null,
              text: null,
            });
            expect(response.body).not.toContain(token);
          }
        } finally {
          await world.reloadFixtures();
        }
      });

      it("serves a sent Wizzaroo account link to no User", async () => {
        await world.reloadFixtures();
        const { id, link } = sentWizzarooLink();
        const response = await world.request(
          { user: "colleague" },
          { method: "GET", url: `/app/messages/${id}` },
        );
        const token = new URL(link).searchParams.get("token") ?? "";
        expect(response.statusCode).toBe(200);
        expect(response.body).not.toContain(token);
      });

      it("returns no html, text or link through GET /v1/messages/:id, to either key, and nothing at all to no one", async () => {
        await world.reloadFixtures();
        const { id, link } = sentWizzarooLink();
        const token = new URL(link).searchParams.get("token") ?? "";
        for (const key of ["wizzaroo", "secondApp"] as const) {
          const response = await world.request(
            { key },
            { method: "GET", url: `/v1/messages/${id}` },
          );
          const body: unknown = response.json();
          // Wizzaroo's key reads its summary; since K1's fix (#118), the second Application's key gets 404.
          expect(response.statusCode).toBe(key === "wizzaroo" ? 200 : 404);
          expect(Object.keys(body ?? {})).not.toContain("html");
          expect(Object.keys(body ?? {})).not.toContain("text");
          expect(response.body).not.toContain(token);
        }
        for (const url of [`/v1/messages/${id}`, `/app/messages/${id}`]) {
          const response = await world.request("anonymous", {
            method: "GET",
            url,
          });
          expect(response.statusCode).toBe(401);
          expect(response.body).not.toContain(token);
        }
      });

      it("(regression) the platform's database login reads a Wizzaroo link in the log only while its Message is queued, and none once it is sent or failed", async () => {
        await world.reloadFixtures();
        const linked = world.plan.messages.filter((item) => item.link !== null);
        const rows = await world.database.$client.query<{ status: string }>(
          `select status from messages where text like '%' || $1 || '%' or html like '%' || $1 || '%'`,
          ["-not-a-real-token"],
        );
        expect(linked).toHaveLength(6);
        expect(rows.rows.map((row) => row.status)).toEqual(
          linked.filter((item) => item.status === "queued").map(() => "queued"),
        );
      });
    });

    describe("probe 3: Retention at 1 and at 3,650 days", () => {
      const removeProbeMessages = async () => {
        await world.reloadFixtures();
        await world.database.delete(messages).where(
          notInArray(
            messages.id,
            world.plan.messages.map((item) => item.id),
          ),
        );
      };

      const setRetention = async (days: number) => {
        const response = await world.request(
          { user: "colleague" },
          {
            method: "PUT",
            url: "/app/settings",
            payload: { logRetentionDays: days },
          },
        );
        expect(response.statusCode).toBe(200);
      };

      it("at 1 day deletes every older Message in every status, with its attachments, and leaves only its id in the job queue", async () => {
        await removeProbeMessages();
        await setRetention(1);
        const attachmentMessage = world.plan.messages.find(
          (item) => item.attachments.length > 0,
        );
        if (attachmentMessage === undefined) {
          throw new Error("The fixtures have no Message with an attachment");
        }
        const tenDaysAgo = new Date(Date.now() - 10 * dayMs);
        await world.database
          .update(messages)
          .set({ createdAt: tenDaysAgo })
          .where(eq(messages.id, attachmentMessage.id));
        const queuedNow = await sendBuiltIn(
          resetBuiltIn(),
          `d2-retention@families.${fixtureDomain}`,
        );
        await world.database
          .update(messages)
          .set({ createdAt: tenDaysAgo })
          .where(eq(messages.id, queuedNow.id));

        const before = await world.database
          .select({
            id: messages.id,
            status: messages.status,
            createdAt: messages.createdAt,
          })
          .from(messages);
        const { cutoff, deletedMessages } = await applyRetention(
          world.database,
          new Date(),
        );
        const after = await world.database
          .select({ id: messages.id })
          .from(messages);
        const expectedGone = before.filter((row) => row.createdAt < cutoff);
        const attachments = await world.database
          .select({ id: messageAttachments.id })
          .from(messageAttachments)
          .where(eq(messageAttachments.messageId, attachmentMessage.id));
        const jobs = await world.database.$client.query<{ data: unknown }>(
          `select data from pgboss.job where data->>'messageId' = $1`,
          [queuedNow.id],
        );

        expect(deletedMessages).toBe(expectedGone.length);
        expect(after.map((row) => row.id).sort()).toEqual(
          before
            .filter((row) => row.createdAt >= cutoff)
            .map((row) => row.id)
            .sort(),
        );
        expect(new Set(expectedGone.map((row) => row.status))).toEqual(
          new Set(["queued", "sent", "failed"]),
        );
        expect(attachments).toEqual([]);
        expect(jobs.rows.map((row) => row.data)).toEqual([
          { messageId: queuedNow.id },
        ]);
      });

      /** A Wizzaroo password reset sent through the worker, then made 120 days old: past its 24-hour life and the default 90 days. */
      const ageSentReset = async () => {
        const reset = await sendBuiltIn(
          resetBuiltIn(),
          `d2-retention-sent@families.${fixtureDomain}`,
        );
        expect(reset.status).toBe(202);
        expect(await world.deliver(reset.id)).toBe("sent");
        const createdAt = new Date(Date.now() - 120 * dayMs);
        await world.database
          .update(messages)
          .set({ createdAt })
          .where(eq(messages.id, reset.id));
        return { id: reset.id, link: reset.links[0] ?? "" };
      };

      it("(regression) at 3,650 days, which any User may set, deletes nothing, but a sent 120-day-old reset holds no link: its body went when it was sent", async () => {
        await removeProbeMessages();
        await setRetention(3650);
        const reset = await ageSentReset();
        const now = new Date();
        const { deletedMessages, cutoff } = await applyRetention(
          world.database,
          now,
        );
        const row = await readRow(reset.id);

        expect(reset.link).not.toBe("");
        expect(deletedMessages).toBe(0);
        expect(now.getTime() - cutoff.getTime()).toBe(3650 * dayMs);
        expect(row.status).toBe("sent");
        expect({ html: row.html, text: row.text }).toEqual({
          html: null,
          text: null,
        });
      });

      it("removes a sent Wizzaroo link from the log once it is older than the link's own life, whatever Retention is", async () => {
        await removeProbeMessages();
        await setRetention(3650);
        const reset = await ageSentReset();
        await applyRetention(world.database, new Date());
        const [row] = await world.database
          .select()
          .from(messages)
          .where(eq(messages.id, reset.id));
        const token = new URL(reset.link).searchParams.get("token") ?? "";
        expect(token).not.toBe("");
        expect(row?.text ?? "").not.toContain(token);
        expect(row?.html ?? "").not.toContain(token);
      });

      it("(regression) at 3,650 days, a reset left queued for eight days, as by a stopped worker, loses its link and is failed, never sent late (#147)", async () => {
        await removeProbeMessages();
        await setRetention(3650);
        const reset = await sendBuiltIn(
          resetBuiltIn(),
          `d2-retention-queued@families.${fixtureDomain}`,
        );
        expect(reset.status).toBe(202);
        await world.database
          .update(messages)
          .set({ createdAt: new Date(Date.now() - 8 * dayMs) })
          .where(eq(messages.id, reset.id));
        const token =
          new URL(reset.links[0] ?? "").searchParams.get("token") ?? "";
        expect(token).not.toBe("");
        expect((await readRow(reset.id)).text).toContain(token);

        const { deletedMessages, droppedBodies } = await applyRetention(
          world.database,
          new Date(),
        );
        const row = await readRow(reset.id);

        expect(deletedMessages).toBe(0);
        expect(droppedBodies).toBeGreaterThanOrEqual(1);
        expect(row).toMatchObject({
          status: "failed",
          error: bodyDroppedError,
          html: null,
          text: null,
        });
        expect(await world.deliver(reset.id)).toBe("skipped");
      });
    });

    describe("probes 4 and 5: the api, worker and postgres logs, and every copy in the database", () => {
      let rejecting: StartedTestContainer;
      let apiLog = "";
      let workerLog = "";
      let postgresLog = "";
      let searchStatus = 0;
      let failedQueryStatus = 0;
      const searchTerm = `parent1@families.${fixtureDomain}`;
      const failedQueryTerm = `parent2@families.${fixtureDomain}`;
      const refusedRecipient = `d2-refused@families.${fixtureDomain}`;
      const sentRecipient = `d2-sent@allowed.${fixtureDomain}`;
      const refused = { id: "", token: "" };
      const sent = { id: "", token: "" };

      beforeAll(async () => {
        await world.reloadFixtures();
        // An SMTP provider that refuses every recipient but one domain, so one send fails and one is sent.
        rejecting = await new GenericContainer(mailpitImage)
          .withEnvironment({
            MP_SMTP_AUTH_ACCEPT_ANY: "true",
            MP_SMTP_AUTH_ALLOW_INSECURE: "true",
            MP_SMTP_ALLOWED_RECIPIENTS: `@allowed\\.pen-test\\.invalid$`,
          })
          .withExposedPorts(1025, 8025)
          .withWaitStrategy(Wait.forListeningPorts())
          .start();
        const environment = {
          DATABASE_URL: world.databaseUrls.api,
          APP_URL: "http://localhost:43320",
          ENCRYPTION_KEY: world.encryptionKey.toString("base64"),
          PORT: "0",
        };
        const api = startChild(
          ["src/pen-test/probes/d2-log-capture.ts"],
          environment,
        );
        let worker: RunningChild | undefined;
        try {
          await waitFor(
            () => /listening at http:\/\/127\.0\.0\.1:\d+/.test(api.output()),
            30_000,
            "the api to listen",
          );
          const base =
            /listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(
              api.output(),
            )?.[1] ?? "";
          const cookie = `session=${await world.signIn("victim")}`;
          const search = await fetch(
            `${base}/app/messages?${new URLSearchParams({ search: searchTerm }).toString()}`,
            { headers: { cookie } },
          );
          searchStatus = search.status;
          const failed = await fetch(
            `${base}/app/messages?${new URLSearchParams({ search: `${failedQueryTerm}\u0000` }).toString()}`,
            { headers: { cookie } },
          );
          failedQueryStatus = failed.status;
          const settings = await fetch(`${base}/app/settings`, {
            method: "PUT",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify({
              smtpHost: rejecting.getHost(),
              smtpPort: rejecting.getMappedPort(1025),
              // A change of host asks for the saved password again (#185); this Mailpit needs none.
              smtpPassword: null,
            }),
          });
          expect(settings.status).toBe(200);
          const reset = resetBuiltIn();
          for (const [target, recipient] of [
            [refused, refusedRecipient],
            [sent, sentRecipient],
          ] as const) {
            const { variables, links } = variablesWithLinks(reset, recipient);
            const response = await fetch(`${base}/v1/messages`, {
              method: "POST",
              headers: {
                ...world.asKey("wizzaroo"),
                "content-type": "application/json",
              },
              body: JSON.stringify({
                templateSlug: reset.slug,
                to: [recipient],
                variables,
              }),
            });
            expect(response.status).toBe(202);
            const body: unknown = await response.json();
            target.id = readString(body, "id");
            target.token =
              new URL(links[0] ?? "http://x").searchParams.get("token") ?? "";
          }
          worker = startChild(["src/index.ts", "worker"], {
            ...environment,
            DATABASE_URL: world.databaseUrls.worker,
          });
          await waitFor(
            async () =>
              (await readRow(refused.id)).status !== "queued" &&
              (await readRow(sent.id)).status !== "queued" &&
              (workerLog = worker?.output() ?? "").includes(sent.id) &&
              workerLog.includes(refused.id),
            60_000,
            "the worker to send both Messages",
          );
        } finally {
          await worker?.stop();
          await api.stop();
          apiLog = api.output();
          workerLog = worker?.output() ?? "";
        }
        const logs = spawnSync("docker", ["logs", world.postgres.getId()], {
          encoding: "utf8",
        });
        postgresLog = `${logs.stdout}${logs.stderr}`;
        await world.reloadFixtures();
      }, 180_000);

      afterAll(async () => {
        await rejecting.stop();
      });

      it("ran the search, the failed query and both sends as production would", async () => {
        expect(searchStatus).toBe(200);
        expect(failedQueryStatus).toBe(500);
        expect((await readRow(refused.id)).status).toBe("failed");
        expect((await readRow(sent.id)).status).toBe("sent");
      });

      it("(regression) the api log keeps a search's path but not its query string (#126)", () => {
        expect(apiLog).toContain('"url":"/app/messages?[redacted]"');
        expect(apiLog).not.toContain("search=");
      });

      it("(regression) the api log keeps a failed query's error code but not its SQL or parameters (#126)", () => {
        const failedLine = apiLog
          .split("\n")
          .find((line) => line.includes("api.request.failed"));
        expect(failedLine).toBeDefined();
        const logged: unknown = JSON.parse(failedLine ?? "{}");
        expect(logged).toMatchObject({
          err: {
            type: "DrizzleQueryError",
            message: "Failed query",
            // invalid byte sequence for encoding "UTF8"
            cause: { type: "DatabaseError", code: "22021" },
          },
        });
        expect(failedLine).not.toContain("Failed query:");
        expect(failedLine).not.toContain("ilike");
        expect(failedLine).not.toContain("params");
        expect(failedLine).not.toContain(failedQueryTerm);
      });

      it("keeps no recipient, link token or body of a send in the api, worker or postgres log", () => {
        for (const needle of [
          refusedRecipient,
          sentRecipient,
          refused.token,
          sent.token,
        ]) {
          expect(apiLog).not.toContain(needle);
          expect(workerLog).not.toContain(needle);
          expect(postgresLog).not.toContain(needle);
        }
        expect(workerLog).toContain(
          JSON.stringify({ messageId: refused.id, outcome: "failed" }).slice(
            1,
            -1,
          ),
        );
        expect(workerLog).toContain(
          JSON.stringify({ messageId: sent.id, outcome: "sent" }).slice(1, -1),
        );
      });

      it("today_ the postgres log keeps the failed statement but not its parameters", () => {
        expect(postgresLog).toContain("invalid byte sequence");
        expect(postgresLog).not.toContain(failedQueryTerm);
        expect(postgresLog).not.toContain(searchTerm);
      });

      it("keeps no searched address or SQL parameter in any container log", () => {
        for (const log of [apiLog, workerLog, postgresLog]) {
          expect(log).not.toContain(encodeURIComponent(searchTerm));
          expect(log).not.toContain(failedQueryTerm);
        }
      });

      it("(regression) keeps a sent Message's recipients, and a refused one's, only in messages.to, no link token of either anywhere, and only their ids in the job queue, in the database", async () => {
        const places = {
          sentRecipient: await findCopies(sentRecipient),
          sentToken: await findCopies(sent.token),
          refusedRecipient: await findCopies(refusedRecipient),
          refusedToken: await findCopies(refused.token),
          sentId: await findCopies(sent.id),
        };
        const refusedRow = await readRow(refused.id);
        expect(places).toEqual({
          sentRecipient: ["public.messages.to"],
          sentToken: [],
          refusedRecipient: ["public.messages.to"],
          refusedToken: [],
          sentId: [
            "pgboss.job.data",
            "pgboss.job_common.data",
            "public.messages.id",
          ],
        });
        // The refusal's class and codes only, never the provider's reply (#173).
        expect(refusedRow.error).toBe(
          "The SMTP provider refused it with reply 550 5.1.0 (permanent)",
        );
      });

      it("keeps no copy of a sent Message's body once it is sent", async () => {
        expect(await findCopies(sent.token)).toEqual([]);
        expect(await readRow(sent.id)).toMatchObject({
          status: "sent",
          html: null,
          text: null,
        });
      });
    });
  },
);
