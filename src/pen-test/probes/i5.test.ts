/**
 * Pen test I5 (#107): the SMTP provider settings. Answers H6. The findings note is `docs/pen-test/findings/I5.md`. A
 * confirmed gap is an `it.fails` for the property that should hold beside a `today_…` test pinning what happens now;
 * a refuted probe is a plain passing test.
 *
 * The probe world is a real Postgres with the E2 fixtures loaded and the API built as production builds it, with
 * production's `sendEmailOverSmtp`. The servers the SMTP host is pointed at are ones the tester controls: a small SMTP
 * server and a non-SMTP listener in this file, the probe world's own Postgres, and two Mailpits with a self-signed
 * certificate (one offering STARTTLS, one speaking TLS from the start). The relay in the middle is a TCP proxy in
 * this file that removes `STARTTLS` from the server's EHLO answer and records every byte the client sends.
 *
 * No credential is printed: the stored SMTP password is read from the database and only ever compared.
 */
import { createServer, connect, type Server, type Socket } from "node:net";
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  readSettings,
  readSmtpSettings,
} from "../../settings/settings-store.js";
import {
  hasContainerRuntime,
  mailpitImage,
  startProbeWorld,
  warnIfSkipped,
  type ProbeWorld,
} from "./probe-world.js";

warnIfSkipped("src/pen-test/probes/i5.test.ts");

const loopback = "127.0.0.1";

interface Listener {
  port: number;
  /** Every byte a client sent, as latin1 text. */
  received: () => string;
  close: () => Promise<void>;
}

const listen = async (
  onConnection: (socket: Socket, record: (chunk: Buffer) => void) => void,
): Promise<Listener> => {
  let received = "";
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    onConnection(socket, (chunk) => {
      received += chunk.toString("latin1");
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, loopback, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The listener has no port");
  }
  return {
    port: address.port,
    received: () => received,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
};

/** A minimal SMTP server the tester controls: it accepts any AUTH and mail, and answers RCPT with `rcptReply`. */
const startTesterSmtp = (rcptReply = "250 2.1.5 OK") =>
  listen((socket, record) => {
    socket.write("220 tester.pen-test.invalid ESMTP\r\n");
    let buffer = "";
    let isInData = false;
    socket.on("data", (chunk: Buffer) => {
      record(chunk);
      buffer += chunk.toString("latin1");
      for (
        let end = buffer.indexOf("\r\n");
        end !== -1;
        end = buffer.indexOf("\r\n")
      ) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (isInData) {
          if (line === ".") {
            isInData = false;
            socket.write("250 2.0.0 queued as i5\r\n");
          }
          continue;
        }
        const verb = (line.split(" ")[0] ?? "").toUpperCase();
        const answer: Record<string, string> = {
          EHLO: "250-tester.pen-test.invalid\r\n250 AUTH PLAIN",
          HELO: "250 tester.pen-test.invalid",
          AUTH: "235 2.7.0 Authentication successful",
          MAIL: "250 2.1.0 OK",
          RCPT: rcptReply,
          DATA: "354 End data with <CR><LF>.<CR><LF>",
          RSET: "250 2.0.0 OK",
          NOOP: "250 2.0.0 OK",
          QUIT: "221 2.0.0 Bye",
        };
        socket.write(`${answer[verb] ?? "500 5.5.2 What?"}\r\n`);
        if (verb === "DATA") {
          isInData = true;
        }
        if (verb === "QUIT") {
          socket.end();
        }
      }
    });
  });

/** A listener that isn't SMTP: it sends a banner, as another internal service would, and nothing else. */
const startBannerService = (banner: string) =>
  listen((socket, record) => {
    socket.on("data", record);
    socket.write(banner);
  });

/**
 * A relay between the client and an SMTP server. With `isStripping`, it removes `STARTTLS` from the server's EHLO
 * answer, as a network in the middle can; without it, it only relays. Either way it records every byte the client
 * sends.
 */
const startMiddle = (
  upstream: { host: string; port: number },
  isStripping: boolean,
) =>
  listen((client, record) => {
    const server = connect(upstream.port, upstream.host);
    server.on("error", () => client.destroy());
    client.on("data", (chunk: Buffer) => {
      record(chunk);
      server.write(chunk);
    });
    server.on("data", (chunk: Buffer) => {
      client.write(
        isStripping
          ? Buffer.from(
              chunk.toString("latin1").replace(/^250-STARTTLS\r\n/gmu, ""),
              "latin1",
            )
          : chunk,
      );
    });
    client.on("close", () => server.destroy());
    server.on("close", () => client.destroy());
  });

/** Whether any line the client sent carries `secret`, in the clear or as the base64 of an AUTH exchange. */
const carries = (clientBytes: string, secret: string): boolean =>
  clientBytes.includes(secret) ||
  clientBytes.split("\r\n").some((line) => {
    const token = line.split(" ").at(-1) ?? "";
    return Buffer.from(token, "base64").toString("utf8").includes(secret);
  });

const freePort = async (): Promise<number> => {
  const listener = await listen(() => undefined);
  await listener.close();
  return listener.port;
};

const readJson = (body: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(body);
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
};

describe.skipIf(!hasContainerRuntime)(
  "pen test I5 (#107): the SMTP provider settings",
  () => {
    let world: ProbeWorld;
    // A Mailpit with a self-signed certificate for `localhost`, so it offers STARTTLS and accepts AUTH without TLS
    // (MP_SMTP_AUTH_ALLOW_INSECURE). Reached over its mapped port on 127.0.0.1, its certificate verifies against
    // neither a trusted chain nor the name, which is what probes 3 and 4 need.
    let starttlsMailpit: StartedTestContainer;

    beforeAll(async () => {
      [world, starttlsMailpit] = await Promise.all([
        startProbeWorld({ hasMailpit: false }),
        new GenericContainer(mailpitImage)
          .withEnvironment({
            MP_SMTP_TLS_CERT: "sans:localhost",
            MP_SMTP_TLS_KEY: "sans:localhost",
            MP_SMTP_AUTH_ACCEPT_ANY: "true",
            MP_SMTP_AUTH_ALLOW_INSECURE: "true",
          })
          .withExposedPorts(1025)
          .withWaitStrategy(Wait.forListeningPorts())
          .start(),
      ]);
    }, 300_000);

    afterAll(async () => {
      await Promise.all([world.stop(), starttlsMailpit.stop()]);
    });

    const starttlsUpstream = () => ({
      host: starttlsMailpit.getHost(),
      port: starttlsMailpit.getFirstMappedPort(),
    });

    /** The username the probes that need AUTH set: the fixtures keep none, as their Mailpit has no TLS (#186). */
    const probeUsername = "pen-test-i5";

    /** The stored SMTP password, decrypted as the worker decrypts it. Never printed. */
    const storedPassword = async () => {
      const smtp = readSmtpSettings(
        await readSettings(world.database),
        world.encryptionKey,
      );
      if (smtp?.password === undefined) {
        throw new Error("The fixtures store no SMTP password");
      }
      return smtp.password;
    };

    /** A `PUT /app/settings` as `victim`, changing only what is given. */
    const putSettings = (change: Record<string, unknown>) =>
      world.request(
        { user: "victim" },
        { method: "PUT", url: "/app/settings", payload: change },
      );

    /**
     * Points the SMTP provider somewhere as `victim`, re-entering the saved password, as a change of host or port
     * now asks (#185): what a User who knows the password can do.
     */
    const pointSmtpAt = async (change: Record<string, unknown>) => {
      const response = await putSettings({
        ...change,
        smtpPassword: world.credentials.smtpPassword,
      });
      expect(response.statusCode).toBe(200);
      return readJson(response.body);
    };

    const testSend = async () => {
      // These probes are about where a test send goes, not how many a User may make an hour (#164).
      await world.forgetRequestLimits();
      const started = Date.now();
      const response = await world.request(
        { user: "victim" },
        {
          method: "POST",
          url: "/app/settings/test",
          payload: { to: "probe@platform.pen-test.invalid" },
        },
      );
      return {
        status: response.statusCode,
        body: readJson(response.body),
        seconds: (Date.now() - started) / 1000,
      };
    };

    /** Queues a Message with the Wizzaroo key, as an Application would, and runs the worker on it once. */
    const queueAndDeliver = async (subject: string) => {
      const response = await world.request(
        { key: "wizzaroo" },
        {
          method: "POST",
          url: "/v1/messages",
          payload: {
            to: ["parent1@families.pen-test.invalid"],
            subject,
            text: "Sent by the I5 probe",
          },
        },
      );
      expect(response.statusCode).toBe(202);
      const id = String(readJson(response.body).id);
      return { id, outcome: await world.deliver(id) };
    };

    const readStoredMessage = async (id: string) => {
      const { rows } = await world.database.$client.query<{
        status: string;
        error: string | null;
      }>("select status, error from messages where id = $1", [id]);
      const [row] = rows;
      if (row === undefined) {
        throw new Error(`No Message ${id}`);
      }
      return row;
    };

    /** The one answer every failure before an SMTP session gets: no host, address, port or banner (#173, #184). */
    const unreachableAnswer = {
      error: "smtp_failed",
      message:
        "The test email was not sent: The SMTP provider could not be reached, or the connection to it failed (a name, network, TLS or timeout failure)",
    };

    /* Probe 1: the test send as a port scanner and banner grabber */

    it("(regression) the test send answers a closed port, a name that will not resolve and a service that is not SMTP alike, naming none of them (#184)", async () => {
      const closed = await freePort();
      const banner = "NOT-SMTP-i5-probe-banner ready\r\n";
      const service = await startBannerService(banner);
      try {
        const answers = [];
        for (const [smtpHost, smtpPort] of [
          [loopback, closed],
          ["no-such-host.pen-test.invalid", 25],
          [loopback, service.port],
        ] as const) {
          await pointSmtpAt({ smtpHost, smtpPort });
          const answer = await testSend();
          expect(answer.status).toBe(502);
          expect(answer.body).toEqual(unreachableAnswer);
          answers.push(JSON.stringify(answer.body));
        }
        expect(answers.join("\n")).not.toMatch(
          /127\.0\.0\.1|ECONN|ENOTFOUND|EAI_AGAIN|getaddrinfo|no-such-host|NOT-SMTP/u,
        );
        expect(answers.join("\n")).not.toContain(String(closed));
      } finally {
        await service.close();
      }
    });

    it("(regression) the test send no longer hands back the banner of a service that is not SMTP (#184)", async () => {
      const banner = "NOT-SMTP-i5-probe-banner ready\r\n";
      const service = await startBannerService(banner);
      try {
        await pointSmtpAt({ smtpHost: loopback, smtpPort: service.port });
        const probed = await testSend();
        expect(probed.status).toBe(502);
        expect(JSON.stringify(probed.body)).not.toContain("NOT-SMTP");
        // Nor does the test send's record in the Logs, which every User reads (#164).
        const { rows } = await world.database.$client.query<{
          error: string | null;
        }>(
          "select error from messages where application_id is null and subject = 'Test email' order by created_at desc limit 1",
        );
        expect(rows[0]?.error).toBe(
          unreachableAnswer.message.replace(
            "The test email was not sent: ",
            "",
          ),
        );
      } finally {
        await service.close();
      }
    });

    it("the test send does not report whether an arbitrary host and port answered, so it is not a port scanner", async () => {
      const closed = await freePort();
      const service = await startBannerService("NOT-SMTP-open-i5\r\n");
      try {
        await pointSmtpAt({ smtpHost: loopback, smtpPort: closed });
        const refused = await testSend();
        await pointSmtpAt({ smtpHost: loopback, smtpPort: service.port });
        const open = await testSend();
        // A test that only checked the platform's own SMTP settings would answer
        // the same for a closed port and for an unrelated open one.
        expect(open.body.message).toEqual(refused.body.message);
      } finally {
        await service.close();
      }
    });

    /* Probe 2: AUTH credentials reach a server the tester controls */

    it("(regression) pointing the provider at the tester's own server without re-entering the password is refused with 422, and the stored password never reaches it (#185)", async () => {
      const smtp = await startTesterSmtp();
      try {
        // A username, so a send would AUTH; the host it is saved for is left as it is.
        const named = await putSettings({ smtpUsername: probeUsername });
        expect(named.statusCode).toBe(200);
        const before = readJson(named.body);
        expect(before.hasSmtpPassword).toBe(true);

        const repointed = await putSettings({
          smtpHost: loopback,
          smtpPort: smtp.port,
        });
        expect(repointed.statusCode).toBe(422);
        expect(readJson(repointed.body)).toMatchObject({
          error: "validation_failed",
          errors: [{ field: "smtpPassword" }],
        });
        const after = await world.request(
          { user: "victim" },
          { method: "GET", url: "/app/settings" },
        );
        expect(readJson(after.body)).toMatchObject({
          smtpHost: before.smtpHost,
          smtpPort: before.smtpPort,
          hasSmtpPassword: true,
        });

        await testSend();
        expect(smtp.received()).toBe("");
        expect(carries(smtp.received(), await storedPassword())).toBe(false);
      } finally {
        await putSettings({ smtpUsername: null });
        await smtp.close();
      }
    });

    it("the stored SMTP password is not sent to a host a User points the provider at without re-entering it", async () => {
      const smtp = await startTesterSmtp();
      try {
        await putSettings({ smtpUsername: probeUsername });
        // The host is changed; the password is never given again. The change is refused (422), so whatever it
        // answers, the test send that follows goes nowhere near the tester's server.
        await putSettings({ smtpHost: loopback, smtpPort: smtp.port });
        await testSend();
        const password = await storedPassword();
        expect(carries(smtp.received(), password)).toBe(false);
      } finally {
        await putSettings({ smtpUsername: null });
        await smtp.close();
      }
    });

    /* Probe 3: STARTTLS stripped with smtpSecure false on 587 */

    it("(regression) with smtpSecure false and a username, a relay that removes STARTTLS still sees STARTTLS sent, and never AUTH in the clear (#186)", async () => {
      const middle = await startMiddle(starttlsUpstream(), true);
      try {
        await pointSmtpAt({
          smtpHost: loopback,
          smtpPort: middle.port,
          smtpSecure: false,
          smtpUsername: probeUsername,
        });
        const sent = await testSend();
        // STARTTLS is required, so the client asks for it although the relay hid it, and the upgrade fails on
        // Mailpit's self-signed certificate: the send is refused rather than going on in plaintext.
        expect(sent.status).toBe(502);
        expect(middle.received()).toContain("STARTTLS");
        expect(carries(middle.received(), probeUsername)).toBe(false);
        expect(carries(middle.received(), await storedPassword())).toBe(false);
      } finally {
        await middle.close();
        await putSettings({ smtpUsername: null });
      }
    });

    it("a relay that leaves STARTTLS in place does not see AUTH in the clear (control)", async () => {
      const middle = await startMiddle(starttlsUpstream(), false);
      try {
        await pointSmtpAt({
          smtpHost: loopback,
          smtpPort: middle.port,
          smtpSecure: false,
          smtpUsername: probeUsername,
        });
        await testSend();
        const password = await storedPassword();
        // The client issued STARTTLS and moved to TLS (or refused to go on), so the password never
        // crossed the relay in the clear.
        expect(middle.received()).toContain("STARTTLS");
        expect(carries(middle.received(), password)).toBe(false);
      } finally {
        await middle.close();
        await putSettings({ smtpUsername: null });
      }
    });

    it("with smtpSecure false the worker will not fall back to plaintext AUTH when STARTTLS is removed", async () => {
      const middle = await startMiddle(starttlsUpstream(), true);
      try {
        await pointSmtpAt({
          smtpHost: loopback,
          smtpPort: middle.port,
          smtpSecure: false,
          smtpUsername: probeUsername,
        });
        await testSend();
        const password = await storedPassword();
        expect(carries(middle.received(), password)).toBe(false);
      } finally {
        await middle.close();
        await putSettings({ smtpUsername: null });
      }
    });

    /* Probe 4: the certificate is verified when the worker does reach TLS (refuted as a weakness) */

    it("the worker verifies the server certificate on the STARTTLS upgrade: a self-signed one is refused (refuted)", async () => {
      // Pointed straight at the self-signed Mailpit, with smtpSecure false so STARTTLS is offered and
      // attempted. nodemailer passes no rejectUnauthorized, so Node verifies the certificate: the
      // upgrade fails and the send is refused, rather than trusting it blindly. Mailpit takes any mail,
      // so the certificate is the only refusal there is; since #184 the test send tells it only by its
      // class, which names TLS among the causes.
      await pointSmtpAt({
        smtpHost: loopback,
        smtpPort: starttlsMailpit.getFirstMappedPort(),
        smtpSecure: false,
      });
      const sent = await testSend();
      expect(sent.status).toBe(502);
      expect(sent.body).toEqual(unreachableAnswer);
    });

    /* Probe 5: what an SMTP reply puts into messages.error, and who reads it */

    it("(regression) an SMTP refusal is stored in messages.error by its reply and status code only, which the Message's sender and every User read (#173)", async () => {
      const smtp = await startTesterSmtp(
        "550 5.1.1 i5-probe recipient unknown in this host's table",
      );
      try {
        await pointSmtpAt({ smtpHost: loopback, smtpPort: smtp.port });
        const { id, outcome } = await queueAndDeliver("I5 refusal probe");
        expect(outcome).toBe("failed");
        const refusal =
          "The SMTP provider refused it with reply 550 5.1.1 (permanent)";
        expect(await readStoredMessage(id)).toEqual({
          status: "failed",
          error: refusal,
        });

        // The Wizzaroo key reads its own Message's error back over the API (summariseMessage.error).
        const summary = await world.request(
          { key: "wizzaroo" },
          { method: "GET", url: `/v1/messages/${id}` },
        );
        expect(summary.statusCode).toBe(200);
        expect(readJson(summary.body).error).toBe(refusal);
        expect(summary.body).not.toContain("i5-probe");
      } finally {
        await smtp.close();
      }
    });

    it.fails(
      "the test send does not let a User reach and tell apart hosts only the api container can talk to",
      async () => {
        // The api container sits on the internal `database` network as well as `default`; a User on
        // the published port cannot. The test send lets the User reach either, and tells them apart.
        const smtp = await startTesterSmtp();
        try {
          const closed = await freePort();
          await pointSmtpAt({ smtpHost: loopback, smtpPort: closed });
          const refused = await testSend();
          await pointSmtpAt({ smtpHost: loopback, smtpPort: smtp.port });
          const reachable = await testSend();
          expect(reachable.status).toBe(refused.status);
          expect(reachable.body.message).toEqual(refused.body.message);
        } finally {
          await smtp.close();
        }
      },
    );

    it("today_ the test send still tells an SMTP server that takes the test email from anything else: 200 against the one 502 every other host and port gets", async () => {
      // A test send that works has to say so; since #184 that is all it tells apart. Whether a host
      // answers SMTP at all stays visible this way, and by how long a held port takes to time out.
      const smtp = await startTesterSmtp();
      try {
        const closed = await freePort();
        await pointSmtpAt({ smtpHost: loopback, smtpPort: closed });
        const refused = await testSend();
        await pointSmtpAt({ smtpHost: loopback, smtpPort: smtp.port });
        const reachable = await testSend();
        expect(refused).toMatchObject({ status: 502, body: unreachableAnswer });
        expect(reachable.status).toBe(200);
      } finally {
        await smtp.close();
      }
    });
  },
);
