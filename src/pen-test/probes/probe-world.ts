/**
 * The world every pen-test probe runs in, in the gated run: a real Postgres and a real Mailpit, started with
 * Testcontainers, migrated, with the pen-test fixtures (E2) loaded and the API built as production builds it. The PRD
 * asks for probes against a real Postgres, not a mock ("Checks every scope issue carries").
 *
 * Each probe file starts its own world in `beforeAll`, and skips, saying so, when there is no container runtime.
 */
import { randomBytes } from "node:crypto";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { PgBoss } from "pg-boss";
import {
  GenericContainer,
  getContainerRuntimeClient,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { buildHttpServer } from "../../api/http-server.js";
import { openDatabase, type Database } from "../../lib/database.js";
import {
  provisionDatabase,
  roleUrl,
  type DatabaseRolePasswords,
  type LoginRole,
} from "../../lib/database-roles.js";
import type { Server } from "../../lib/http.js";
import { apiKeys, throttleKeys, users } from "../../lib/schema.js";
import {
  buildJobQueue,
  createJobBoss,
  sendMessageRetryLimit,
} from "../../lib/jobs.js";
import { migrateEverything } from "../../lib/migrate.js";
import { sendEmailOverSmtp } from "../../sending/delivery.js";
import {
  sendQueuedMessage,
  type SendOutcome,
} from "../../sending/send-worker.js";
import {
  deriveFixtureCredentials,
  fixtureUsers,
  penTestFixtureIds,
  type ApiKeyHandle,
  type FixtureCredentials,
  type FixturePlan,
  type UserHandle,
} from "../fixtures/fixture-plan.js";
import { loadPenTestFixtures } from "../fixtures/load-fixtures.js";

export const hasContainerRuntime = await getContainerRuntimeClient().then(
  () => true,
  () => false,
);

/** Say so when a probe file is skipped, so a run without Docker can't pass for a run of the probes. */
export const warnIfSkipped = (file: string): void => {
  if (!hasContainerRuntime) {
    console.warn(
      `SKIPPED ${file}: no container runtime, so the pen-test probes did not run`,
    );
  }
};

/**
 * Production's Postgres image and bootstrap superuser. The world provisions the roles and migrates as production's
 * `provision` and `migrate` do, and the API runs as `email_platform_api`, so the app's connection has production's
 * privileges (H4, #121).
 */
export const postgresImage = "postgres:18-alpine";
export const postgresUser = "email_platform";
export const mailpitImage = "axllent/mailpit:v1.33.1";

/** The origin the API is built with, as in the pen-test deployment. */
export const probeAppUrl = new URL("http://localhost:43320");

export interface MailpitAddress {
  Name: string;
  Address: string;
}

export interface MailpitSummary {
  ID: string;
  Subject: string;
  From: MailpitAddress;
  To: MailpitAddress[];
  Cc: MailpitAddress[] | null;
  Bcc: MailpitAddress[] | null;
}

export interface ProbeWorldOptions {
  /** Start Mailpit too, and point Settings at it. On by default. */
  hasMailpit?: boolean;
  /** Build the API with Fastify's request log on, as production does. Off by default. */
  isLogging?: boolean;
}

export interface ProbeWorld {
  postgres: StartedPostgreSqlContainer;
  mailpit: StartedTestContainer | undefined;
  /** Each login's connection string, and the bootstrap superuser's, as Compose gives them to each container. */
  databaseUrls: Record<LoginRole | "superuser", string>;
  /** The API's connection, as `email_platform_api`. */
  database: Database;
  boss: PgBoss;
  server: Server;
  encryptionKey: Buffer;
  seed: string;
  plan: FixturePlan;
  credentials: FixtureCredentials;
  ids: typeof penTestFixtureIds;
  /** The headers that make a request as a fixture User (signing in afresh) or with a fixture API Key. */
  signIn: (handle: UserHandle) => Promise<string>;
  asUser: (handle: UserHandle) => Promise<Record<string, string>>;
  asKey: (handle: ApiKeyHandle) => Record<string, string>;
  /** `server.inject`, as a fixture User or API Key, or as no one. */
  request: (
    as: { user: UserHandle } | { key: ApiKeyHandle } | "anonymous",
    options: InjectOptions,
  ) => Promise<LightMyRequestResponse>;
  /** Puts every fixture back as the plan has it. */
  reloadFixtures: () => Promise<void>;
  /**
   * Starts every API Key's send window afresh (K1, #133), so a probe that sends more than a key may in a minute, and
   * isn't about the send limit, still has the key's whole minute.
   */
  forgetSendWindows: () => Promise<void>;
  /**
   * Empties the sign-in and step-up throttles, which every api process shares through Postgres (A1, #142), so a probe
   * that counts tries starts from none, as a fresh `api` process did when the throttles lived in its memory.
   */
  forgetSignInThrottle: () => Promise<void>;
  /**
   * Gives every API Key and User their whole request limits back (I2a, #162, #164): the requests, previews and test
   * sends counted on their rows. A probe that makes more requests than a minute allows, and isn't about the limits,
   * calls it first.
   */
  forgetRequestLimits: () => Promise<void>;
  /** Runs the send worker once for a Message, as the worker would, through Mailpit. */
  deliver: (messageId: string) => Promise<SendOutcome>;
  /** Mailpit's API, such as `/api/v1/messages`. */
  mailpitApi: string | undefined;
  listMail: () => Promise<MailpitSummary[]>;
  readRawMail: (id: string) => Promise<string>;
  clearMail: () => Promise<void>;
  stop: () => Promise<void>;
}

const isSummaryList = (
  value: unknown,
): value is { messages: MailpitSummary[] } =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray(Reflect.get(value, "messages"));

export const startProbeWorld = async ({
  hasMailpit = true,
  isLogging = false,
}: ProbeWorldOptions = {}): Promise<ProbeWorld> => {
  const [postgres, mailpit] = await Promise.all([
    new PostgreSqlContainer(postgresImage)
      .withUsername(postgresUser)
      .withDatabase(postgresUser)
      .start(),
    hasMailpit
      ? new GenericContainer(mailpitImage)
          .withEnvironment({
            MP_SMTP_AUTH_ACCEPT_ANY: "true",
            MP_SMTP_AUTH_ALLOW_INSECURE: "true",
          })
          .withExposedPorts(1025, 8025)
          .withWaitStrategy(Wait.forListeningPorts())
          .start()
      : Promise.resolve(undefined),
  ]);
  const encryptionKey = randomBytes(32);
  const seed = randomBytes(32).toString("base64url");
  const superuser = postgres.getConnectionUri();
  const newPassword = () => randomBytes(24).toString("base64url");
  const passwords: DatabaseRolePasswords = {
    migrate: newPassword(),
    api: newPassword(),
    worker: newPassword(),
    backup: newPassword(),
  };
  await provisionDatabase({ superuserUrl: superuser, passwords });
  const databaseUrls = {
    superuser,
    migrate: roleUrl(superuser, "migrate", passwords.migrate),
    api: roleUrl(superuser, "api", passwords.api),
    worker: roleUrl(superuser, "worker", passwords.worker),
    backup: roleUrl(superuser, "backup", passwords.backup),
  };
  await migrateEverything(databaseUrls.migrate, (error) => {
    console.error(error);
  });
  const database = openDatabase(databaseUrls.api);
  const boss = createJobBoss(databaseUrls.api);
  await boss.start();

  const smtp =
    mailpit === undefined
      ? undefined
      : { host: mailpit.getHost(), port: mailpit.getMappedPort(1025) };
  const load = () =>
    loadPenTestFixtures(database, {
      seed,
      encryptionKey,
      ...(smtp === undefined ? {} : { smtp }),
    });
  const { plan } = await load();
  const credentials = deriveFixtureCredentials(seed);

  const server = await buildHttpServer({
    database,
    jobs: buildJobQueue(boss),
    appUrl: probeAppUrl,
    encryptionKey,
    sendEmail: sendEmailOverSmtp,
    uiDirectory: undefined,
    isLogging,
  });

  // The world signs in as a fixture many times a file, so each sign-in comes from a socket of its own (RFC 3849's
  // documentation prefix): the per-address sign-in limit (#122) then bounds the probes that test it, not the setup.
  let signIns = 0;
  const signIn = async (handle: UserHandle): Promise<string> => {
    signIns += 1;
    const response = await server.inject({
      method: "POST",
      url: "/auth/sign-in",
      remoteAddress: `2001:db8::${signIns.toString(16)}`,
      payload: {
        email: fixtureUsers[handle].email,
        password: credentials.passwords[handle],
      },
    });
    const token = response.cookies.find(
      (cookie) => cookie.name === "session",
    )?.value;
    if (token === undefined) {
      throw new Error(
        `Signing in as ${handle} was refused with ${String(response.statusCode)}: ${response.body}`,
      );
    }
    return token;
  };
  const asUser = async (handle: UserHandle) => ({
    cookie: `session=${await signIn(handle)}`,
  });
  const asKey = (handle: ApiKeyHandle) => ({
    authorization: `Bearer ${credentials.apiKeys[handle]}`,
  });
  const mailpitApi =
    mailpit === undefined
      ? undefined
      : `http://${mailpit.getHost()}:${String(mailpit.getMappedPort(8025))}`;

  return {
    postgres,
    mailpit,
    databaseUrls,
    database,
    boss,
    server,
    encryptionKey,
    seed,
    plan,
    credentials,
    ids: penTestFixtureIds,
    signIn,
    asUser,
    asKey,
    request: async (as, options) => {
      const identity =
        as === "anonymous"
          ? {}
          : "user" in as
            ? await asUser(as.user)
            : asKey(as.key);
      return server.inject({
        ...options,
        headers: { ...identity, ...options.headers },
      });
    },
    reloadFixtures: async () => {
      await load();
    },
    forgetSendWindows: async () => {
      await database
        .update(apiKeys)
        .set({ sendWindowStartedAt: null, sendWindowRecipients: 0 });
    },
    forgetSignInThrottle: async () => {
      await database.delete(throttleKeys);
    },
    forgetRequestLimits: async () => {
      await database.update(apiKeys).set({
        requestTokens: null,
        requestTokensAt: null,
        previewWindowStartedAt: null,
        previewWindowCount: 0,
      });
      await database.update(users).set({
        requestTokens: null,
        requestTokensAt: null,
        testSendWindowStartedAt: null,
        testSendWindowCount: 0,
      });
    },
    deliver: (messageId) =>
      sendQueuedMessage(
        { database, encryptionKey, sendEmail: sendEmailOverSmtp },
        messageId,
        {
          retryCount: sendMessageRetryLimit,
          retryLimit: sendMessageRetryLimit,
        },
      ),
    mailpitApi,
    listMail: async () => {
      if (mailpitApi === undefined) {
        throw new Error("This probe world has no Mailpit");
      }
      const body: unknown = await (
        await fetch(`${mailpitApi}/api/v1/messages?limit=500`)
      ).json();
      return isSummaryList(body) ? body.messages : [];
    },
    readRawMail: async (id) => {
      if (mailpitApi === undefined) {
        throw new Error("This probe world has no Mailpit");
      }
      return (await fetch(`${mailpitApi}/api/v1/message/${id}/raw`)).text();
    },
    clearMail: async () => {
      if (mailpitApi !== undefined) {
        await fetch(`${mailpitApi}/api/v1/messages`, { method: "DELETE" });
      }
    },
    stop: async () => {
      await server.close();
      await boss.stop({ graceful: false });
      await database.$client.end();
      await Promise.all([postgres.stop(), mailpit?.stop()]);
    },
  };
};
