/**
 * Pen test S1 (#96): Message input, from and headers (H8). Each probe sends through `POST /v1/messages` as a fixture
 * API Key, runs the send worker once through Mailpit and reads what Mailpit received, raw headers included.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  maxAttachments,
  maxMessageBytes,
} from "../../sending/accept-message.js";
import type { ApiKeyHandle } from "../fixtures/fixture-plan.js";
import {
  hasContainerRuntime,
  startProbeWorld,
  warnIfSkipped,
  type MailpitSummary,
  type ProbeWorld,
} from "./probe-world.js";

warnIfSkipped("src/pen-test/probes/s1.test.ts");

const recipient = "reader@s1.pen-test.invalid";
const raw = { to: [recipient], subject: "S1 probe", text: "S1 probe body" };
const secondAppTemplateVariables = {
  orderNumber: "SA-S1",
  trackingUrl: "https://second-app.pen-test.invalid/track/SA-S1",
};

interface Summary {
  id: string;
  from: string;
  to: string[];
  subject: string;
  status: string;
  error: string | null;
}

const isSummary = (value: unknown): value is Summary =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "id") === "string" &&
  Array.isArray(Reflect.get(value, "to"));

/** The header block of a raw email: everything before the first blank line. */
const topHeaders = (rawMail: string): string =>
  rawMail.split("\r\n\r\n")[0] ?? "";

/** Lines that start a header named `X-Injected` or `Bcc`, anywhere in the text given. */
const injectedLines = (text: string): string[] =>
  text.match(/^(X-Injected|Bcc):.*$/gimu) ?? [];

const addressesOf = (mail: MailpitSummary): string[] =>
  [...mail.To, ...(mail.Cc ?? []), ...(mail.Bcc ?? [])].map(
    (address) => address.Address,
  );

describe.skipIf(!hasContainerRuntime)(
  "pen test S1 (#96): Message input, from and headers",
  () => {
    let world: ProbeWorld;

    beforeAll(async () => {
      world = await startProbeWorld();
    }, 300_000);
    afterAll(async () => world.stop());
    // These probes send more than a key may in a minute; the send limit is K1's (#133).
    beforeEach(async () => world.forgetSendWindows());

    const send = async (
      payload: Record<string, unknown>,
      key: ApiKeyHandle = "secondApp",
    ) =>
      world.request({ key }, { method: "POST", url: "/v1/messages", payload });

    const accept = async (
      payload: Record<string, unknown>,
      key: ApiKeyHandle = "secondApp",
    ): Promise<Summary> => {
      const response = await send(payload, key);
      expect(response.statusCode).toBe(202);
      const body: unknown = response.json();
      if (!isSummary(body)) {
        throw new Error(`Not a Message summary: ${response.body}`);
      }
      return body;
    };

    const readMessage = async (id: string): Promise<Summary> => {
      const body: unknown = (
        await world.request(
          { key: "secondApp" },
          { method: "GET", url: `/v1/messages/${id}` },
        )
      ).json();
      if (!isSummary(body)) {
        throw new Error("Not a Message summary");
      }
      return body;
    };

    /** Runs the worker once for the Message and returns what Mailpit received for it. */
    const deliver = async (id: string) => {
      await world.clearMail();
      const outcome = await world.deliver(id);
      const mail = await world.listMail();
      const raws = await Promise.all(
        mail.map(async (item) => world.readRawMail(item.ID)),
      );
      return { outcome, mail, raws, message: await readMessage(id) };
    };

    /* ---------- Probe 1: CR and LF in subject, from, a Configuration's from name and a filename ---------- */

    it("folds CR and LF in a raw subject into spaces, so no header is injected", async () => {
      const message = await accept({
        ...raw,
        subject:
          "Hello\r\nX-Injected: subject\r\nBcc: evil@evil.pen-test.invalid",
      });
      const { outcome, mail, raws } = await deliver(message.id);
      expect(outcome).toBe("sent");
      expect(mail.map(addressesOf)).toEqual([[recipient]]);
      expect(mail[0]?.Subject).toBe(
        "Hello X-Injected: subject Bcc: evil@evil.pen-test.invalid",
      );
      expect(injectedLines(topHeaders(raws[0] ?? ""))).toEqual([]);
    });

    it("folds CR and LF in a template variable that reaches the subject, so no header is injected", async () => {
      const message = await accept({
        to: [recipient],
        templateSlug: "second-app-order-shipped",
        variables: {
          ...secondAppTemplateVariables,
          orderNumber: "SA-1\r\nX-Injected: variable",
        },
      });
      const { outcome, mail, raws } = await deliver(message.id);
      expect(outcome).toBe("sent");
      expect(mail[0]?.Subject).toBe(
        "Your order SA-1 X-Injected: variable has shipped",
      );
      expect(injectedLines(topHeaders(raws[0] ?? ""))).toEqual([]);
    });

    it("injects no header from CR and LF in from or replyTo; Nodemailer reads the rest as an address group", async () => {
      const message = await accept({
        ...raw,
        // An address the second app may send from (K1, #117), so the send gets as far as Nodemailer.
        from: "Evil\r\nX-Injected: from <orders@second-app.pen-test.invalid>",
        replyTo: "reply@s1.pen-test.invalid\r\nX-Injected: replyTo",
      });
      const { outcome, mail, raws } = await deliver(message.id);
      expect(outcome).toBe("sent");
      expect(mail.map(addressesOf)).toEqual([[recipient]]);
      const headers = topHeaders(raws[0] ?? "");
      expect(injectedLines(headers)).toEqual([]);
      expect(headers).toContain(
        'From: "Evil X-Injected":from <orders@second-app.pen-test.invalid>;',
      );
      expect(headers).toContain(
        'Reply-To: "reply@s1.pen-test.invalid X-Injected":;',
      );
    });

    it("keeps CR and LF in a Configuration's from name but folds them when sending, so no header is injected", async () => {
      try {
        const put = await world.request(
          { user: "victim" },
          {
            method: "PUT",
            url: `/app/configurations/${world.ids.configurations.secondApp}`,
            payload: {
              name: "Second app",
              fromEmail: "orders@second-app.pen-test.invalid",
              fromName:
                "Second\r\nX-Injected: fromName\r\nBcc: evil@evil.pen-test.invalid",
            },
          },
        );
        expect(put.statusCode).toBe(200);
        expect(put.json<{ fromName: string }>().fromName).toContain("\r\n");
        const badEmail = await world.request(
          { user: "victim" },
          {
            method: "PUT",
            url: `/app/configurations/${world.ids.configurations.secondApp}`,
            payload: {
              name: "Second app",
              fromEmail:
                "orders@second-app.pen-test.invalid\r\nX-Injected: fromEmail",
            },
          },
        );
        expect(badEmail.statusCode).toBe(422);

        const message = await accept({
          to: [recipient],
          templateSlug: "second-app-order-shipped",
          variables: secondAppTemplateVariables,
        });
        expect(message.from).toBe(
          '"Second X-Injected: fromName Bcc: evil@evil.pen-test.invalid" <orders@second-app.pen-test.invalid>',
        );
        const { outcome, mail, raws } = await deliver(message.id);
        expect(outcome).toBe("sent");
        expect(mail.map(addressesOf)).toEqual([[recipient]]);
        expect(injectedLines(topHeaders(raws[0] ?? ""))).toEqual([]);
      } finally {
        await world.reloadFixtures();
      }
    });

    it("encodes CR and LF in an attachment filename, so no part header is injected", async () => {
      const message = await accept({
        ...raw,
        attachments: [
          { filename: "a.txt\r\nX-Injected: filename", content: "aGk=" },
        ],
      });
      const { outcome, raws } = await deliver(message.id);
      expect(outcome).toBe("sent");
      const rawMail = raws[0] ?? "";
      expect(injectedLines(rawMail)).toEqual([]);
      expect(rawMail).toContain("a.txt%0D%0AX-Injected%3A%20filename");
    });

    it("injects no header from CR and LF in a to entry, refused with 422 since #134, or a contentType, refused with 422 since #150", async () => {
      await world.clearMail();
      const inTo = await send({
        ...raw,
        to: [`${recipient}\r\nX-Injected: to`],
      });
      expect(inTo.statusCode).toBe(422);

      const inType = await send({
        ...raw,
        attachments: [
          {
            filename: "a.txt",
            contentType: "text/plain\r\nX-Injected: contentType",
            content: "aGk=",
          },
        ],
      });
      expect(inType.statusCode).toBe(422);
      expect(await world.listMail()).toEqual([]);
    });

    /* ---------- Probe 2: several addresses in one entry, and the 50-recipient cap ---------- */

    const listEntry =
      "a@s1.pen-test.invalid, b@s1.pen-test.invalid, c@s1.pen-test.invalid";
    const groupEntry = "Team: d@s1.pen-test.invalid, e@s1.pen-test.invalid;";
    const fiftyPairs = Array.from(
      { length: 50 },
      (_, index) =>
        `a${String(index)}@s1.pen-test.invalid, b${String(index)}@s1.pen-test.invalid`,
    );

    it("(regression) refuses a to, cc or bcc entry holding three addresses, or a group of two, with 422 naming the entry, and stores and sends nothing (#134)", async () => {
      const subject = "S1 one entry, many addresses (regression)";
      const responses = await Promise.all([
        send({ ...raw, subject, to: [listEntry] }),
        send({ ...raw, subject, to: [groupEntry] }),
        send({ ...raw, subject, cc: [listEntry] }),
        send({ ...raw, subject, bcc: [recipient, groupEntry] }),
      ]);
      expect(responses.map((response) => response.statusCode)).toEqual([
        422, 422, 422, 422,
      ]);
      expect(
        responses.map(
          (response) =>
            response.json<{ errors: { field: string }[] }>().errors[0]?.field,
        ),
      ).toEqual(["to.0", "to.0", "cc.0", "bcc.1"]);
      const stored = await world.request(
        { user: "victim" },
        {
          method: "GET",
          url: `/app/messages?search=${encodeURIComponent(subject)}`,
        },
      );
      expect(stored.json<{ total: number }>().total).toBe(0);
    });

    it("refuses a to entry that holds more than one address", async () => {
      const response = await send({ ...raw, to: [listEntry] });
      expect(response.statusCode).toBe(422);
    });

    it("(regression) refuses 50 to entries of two addresses each with 422, so one request never reaches 100 To recipients (#134)", async () => {
      await world.clearMail();
      const response = await send({ ...raw, to: fiftyPairs });
      expect(response.statusCode).toBe(422);
      expect(
        response.json<{ errors: { field: string }[] }>().errors,
      ).toHaveLength(50);
      expect(await world.listMail()).toEqual([]);
    });

    it("sends to no more than 50 To recipients from one request", async () => {
      const response = await send({ ...raw, to: fiftyPairs });
      if (response.statusCode === 202) {
        const { mail } = await deliver(response.json<{ id: string }>().id);
        expect(mail[0]?.To.length ?? 0).toBeLessThanOrEqual(50);
      } else {
        expect(response.statusCode).toBe(422);
      }
    });

    it("sends a quoted display name holding a comma to its one address", async () => {
      const entry = '"Doe, Jane" <jane@s1.pen-test.invalid>';
      const message = await accept({ ...raw, to: [entry] });
      const { mail } = await deliver(message.id);
      expect(mail.map((item) => item.To)).toEqual([
        [{ Name: "Doe, Jane", Address: "jane@s1.pen-test.invalid" }],
      ]);
    });

    /* ---------- Probe 3: a from no Configuration names (K1 owns "any from") ---------- */

    const wizzarooFrom = () => {
      const configuration = world.plan.configurations.find(
        (item) => item.id === world.ids.configurations.wizzaroo,
      );
      if (configuration === undefined) {
        throw new Error("The plan has no Wizzaroo Configuration");
      }
      return configuration;
    };

    it("(regression) refuses second-app's email from Wizzaroo's address, which no second-app Configuration names, and sends nothing (K1, #117)", async () => {
      await world.clearMail();
      const { fromName, fromEmail } = wizzarooFrom();
      const response = await send({
        ...raw,
        from: `${fromName} <${fromEmail}>`,
      });
      expect(response.statusCode).toBe(422);
      // Nodemailer would read every address in a group or list, so each must be one the Application may use.
      const smuggled = await send({
        ...raw,
        from: `Second app <orders@second-app.pen-test.invalid>, ${fromEmail}`,
      });
      expect(smuggled.statusCode).toBe(422);
      expect(await world.listMail()).toEqual([]);
      // Only the address is bound to the Application; the display name is free text (S1).
      const message = await accept({
        ...raw,
        from: `${fromName} <orders@second-app.pen-test.invalid>`,
      });
      const { outcome, mail } = await deliver(message.id);
      expect(outcome).toBe("sent");
      expect(mail[0]?.From).toEqual({
        Name: fromName,
        Address: "orders@second-app.pen-test.invalid",
      });
    });

    it("refuses a from that no Configuration names", async () => {
      const { fromName, fromEmail } = wizzarooFrom();
      const response = await send({
        ...raw,
        from: `${fromName} <${fromEmail}>`,
      });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.statusCode).toBeLessThan(500);
    });

    /* ---------- Probe 4: attachments ---------- */

    it("(regression) refuses an attachment whose contentType is not one MIME type, or whose filename or contentType is over 255 characters, with 422 naming the field, and still sends any one MIME type (#150)", async () => {
      const subject = "S1 odd attachments (regression)";
      const refusedTypes = [
        "multipart/mixed; boundary=zzz",
        "",
        "text/plain\r\nX-Injected: contentType",
        "text/plain\nX-Injected: contentType",
        "text plain",
        "text/plain, text/html",
        "text/plain; charset",
        "c".repeat(100_000),
        `text/${"c".repeat(251)}`,
      ];
      const refused = await Promise.all([
        ...refusedTypes.map(async (contentType) =>
          send({
            ...raw,
            subject,
            attachments: [{ filename: "a.txt", contentType, content: "aGk=" }],
          }),
        ),
        send({
          ...raw,
          subject,
          attachments: [{ filename: "f".repeat(256), content: "aGk=" }],
        }),
        send({
          ...raw,
          subject,
          attachments: [{ filename: "f".repeat(100_000), content: "aGk=" }],
        }),
      ]);
      expect(refused.map((response) => response.statusCode)).toEqual(
        Array.from({ length: refusedTypes.length + 2 }, () => 422),
      );
      expect(
        refused.map(
          (response) =>
            response.json<{ errors: { field: string }[] }>().errors[0]?.field,
        ),
      ).toEqual([
        ...refusedTypes.map(() => "attachments.0.contentType"),
        "attachments.0.filename",
        "attachments.0.filename",
      ]);
      const stored = await world.request(
        { user: "victim" },
        {
          method: "GET",
          url: `/app/messages?search=${encodeURIComponent(subject)}`,
        },
      );
      expect(stored.json<{ total: number }>().total).toBe(0);

      const odd = await accept({
        ...raw,
        attachments: [
          {
            filename: "setup.exe",
            contentType: "application/x-msdownload",
            content: "aGk=",
          },
          {
            filename: "../../etc/passwd",
            contentType: 'text/plain; charset="utf-8"',
            content: "aGk=",
          },
          { filename: "page.html", content: "" },
          {
            filename: "f".repeat(255),
            contentType: `text/${"c".repeat(250)}`,
            content: "aGk=",
          },
        ],
      });
      const oddResult = await deliver(odd.id);
      expect(oddResult.outcome).toBe("sent");
      const rawMail = oddResult.raws[0] ?? "";
      expect(rawMail).toContain(
        "Content-Type: application/x-msdownload; name=setup.exe",
      );
      expect(rawMail).toContain(
        "Content-Type: application/octet-stream; name=page.html",
      );
      expect(injectedLines(rawMail)).toEqual([]);
    });

    it("refuses an attachment whose contentType is not one MIME type, or whose filename or contentType is longer than 255 characters", async () => {
      const responses = await Promise.all([
        send({
          ...raw,
          attachments: [
            {
              filename: "a.txt",
              contentType: "text/plain\r\nX-Injected: contentType",
              content: "aGk=",
            },
          ],
        }),
        send({
          ...raw,
          attachments: [{ filename: "f".repeat(256), content: "aGk=" }],
        }),
        send({
          ...raw,
          attachments: [
            { filename: "f", contentType: "c".repeat(256), content: "aGk=" },
          ],
        }),
      ]);
      expect(responses.map((response) => response.statusCode)).toEqual([
        422, 422, 422,
      ]);
    });

    const tinyAttachments = (count: number) =>
      Array.from({ length: count }, () => ({ filename: "a", content: "" }));

    it("(regression) refuses 101 attachments, and 16,384, with 422 before the database, and accepts and sends 100 (#150)", async () => {
      const hundred = await accept({
        ...raw,
        attachments: tinyAttachments(maxAttachments),
      });
      const result = await deliver(hundred.id);
      expect(result.outcome).toBe("sent");

      for (const count of [maxAttachments + 1, 16_384]) {
        const over = await send({
          ...raw,
          attachments: tinyAttachments(count),
        });
        expect(over.statusCode).toBe(422);
        expect(over.json()).toMatchObject({
          error: "validation_failed",
          errors: [{ field: "attachments" }],
        });
      }
    }, 120_000);

    it("refuses too many attachments with a 4xx of its own", async () => {
      const response = await send({
        ...raw,
        attachments: tinyAttachments(16_384),
      });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.statusCode).toBeLessThan(500);
    }, 120_000);

    it("refuses a message one byte over 25 MB with 413 before storing it", async () => {
      const content = Buffer.alloc(maxMessageBytes + 1).toString("base64");
      const response = await send({
        ...raw,
        attachments: [{ filename: "big.bin", content }],
      });
      expect(response.statusCode).toBe(413);
      expect(response.json()).toEqual({
        error: "message_too_large",
        message: "The message is larger than the 25 MB limit",
      });
    }, 120_000);

    /* ---------- Probe 5: odd input on every field ---------- */

    const nul = "a\u0000b";
    const nulPayloads: Record<string, Record<string, unknown>> = {
      subject: { ...raw, subject: nul },
      html: { to: [recipient], subject: "s", html: nul },
      text: { ...raw, text: nul },
      // In an address the second app may send from (K1, #117), so it is not refused for that first.
      from: { ...raw, from: "ord\u0000ers@second-app.pen-test.invalid" },
      to: { ...raw, to: [`${nul}@s1.pen-test.invalid`] },
      cc: { ...raw, cc: [`${nul}@s1.pen-test.invalid`] },
      bcc: { ...raw, bcc: [`${nul}@s1.pen-test.invalid`] },
      replyTo: { ...raw, replyTo: `${nul}@s1.pen-test.invalid` },
      templateSlug: { to: [recipient], templateSlug: nul },
      templateName: { to: [recipient], templateName: nul },
      variables: {
        to: [recipient],
        templateSlug: "second-app-order-shipped",
        variables: { ...secondAppTemplateVariables, orderNumber: nul },
      },
      filename: {
        ...raw,
        attachments: [{ filename: nul, content: "aGk=" }],
      },
      contentType: {
        ...raw,
        attachments: [{ filename: "a", contentType: nul, content: "aGk=" }],
      },
    };

    const sendEachNul = async (): Promise<Record<string, number>> =>
      Object.fromEntries(
        await Promise.all(
          Object.entries(nulPayloads).map(
            async ([field, payload]) =>
              [field, (await send(payload)).statusCode] as const,
          ),
        ),
      );

    it("(regression) answers a NUL byte in every string field with 422 validation_failed naming the field, before any query (#151)", async () => {
      const statuses = await sendEachNul();
      expect(statuses).toEqual(
        Object.fromEntries(
          Object.keys(nulPayloads).map((field) => [field, 422] as const),
        ),
      );
      const response = await send({ ...raw, subject: nul });
      expect(response.json()).toEqual({
        error: "validation_failed",
        message: "body.subject must not contain a NUL byte",
        errors: [
          {
            field: "body.subject",
            message: "body.subject must not contain a NUL byte",
          },
        ],
      });
    });

    it("refuses a NUL byte in every string field with a 4xx", async () => {
      const statuses = await sendEachNul();
      for (const status of Object.values(statuses)) {
        expect(status).toBeGreaterThanOrEqual(400);
        expect(status).toBeLessThan(500);
      }
    });

    it("keeps 0x10, 1e3, 1.5 and Infinity written as strings as text, and refuses numbers where a string belongs", async () => {
      const message = await accept({
        ...raw,
        subject: "0x10 1e3 1.5 Infinity",
      });
      expect(message.subject).toBe("0x10 1e3 1.5 Infinity");
      const refused = await Promise.all([
        send({ ...raw, to: [1e3] }),
        send({ ...raw, subject: 16 }),
        send({ ...raw, from: 1.5 }),
        send({ to: [recipient], templateId: "0x10" }),
      ]);
      expect(refused.map((response) => response.statusCode)).toEqual([
        422, 422, 422, 422,
      ]);
      const read = await world.request(
        { key: "secondApp" },
        { method: "GET", url: "/v1/messages/0x10" },
      );
      expect(read.statusCode).toBe(422);
    });

    it("refuses over-long subject, addresses, template slug and template name, and a 51st to entry, with 422", async () => {
      const long = (length: number) => "x".repeat(length);
      const responses = await Promise.all([
        send({ ...raw, subject: long(999) }),
        send({ ...raw, from: long(321) }),
        send({ ...raw, to: [long(321)] }),
        send({ ...raw, cc: [long(321)] }),
        send({ ...raw, bcc: [long(321)] }),
        send({ ...raw, replyTo: long(321) }),
        send({ to: [recipient], templateSlug: long(101) }),
        send({ to: [recipient], templateName: long(201) }),
        send({ ...raw, to: Array.from({ length: 51 }, () => recipient) }),
      ]);
      expect(responses.map((response) => response.statusCode)).toEqual(
        Array.from({ length: 9 }, () => 422),
      );
    });

    it("(regression) refuses a template whose subject renders past 998 characters with 422 on the template field, storing nothing, and sends one of 998 (#152)", async () => {
      const orderNumber = `S1-152-${"o".repeat(100_000)}`;
      const response = await send({
        to: [recipient],
        templateSlug: "second-app-order-shipped",
        variables: { ...secondAppTemplateVariables, orderNumber },
      });
      expect(response.statusCode).toBe(422);
      const body = response.json<{
        error: string;
        errors: { field: string; message: string }[];
      }>();
      expect(body.error).toBe("validation_failed");
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0]?.field).toBe("templateSlug");
      expect(body.errors[0]?.message).toMatch(
        /^The rendered subject is [\d,]+ characters, longer than the 998 it may have$/u,
      );
      const stored = await world.request(
        { user: "victim" },
        {
          method: "GET",
          url: `/app/messages?search=${encodeURIComponent("S1-152-")}`,
        },
      );
      expect(stored.json<{ total: number }>().total).toBe(0);

      // The fixture's subject around the variable, worked out from a short render, leaves room for the rest.
      const short = await accept({
        to: [recipient],
        templateSlug: "second-app-order-shipped",
        variables: { ...secondAppTemplateVariables, orderNumber: "x" },
      });
      const room = 998 - (short.subject.length - 1);
      const longest = await accept({
        to: [recipient],
        templateSlug: "second-app-order-shipped",
        variables: {
          ...secondAppTemplateVariables,
          orderNumber: "o".repeat(room),
        },
      });
      expect(longest.subject).toHaveLength(998);
    });

    it("refuses a template whose rendered subject is longer than 998 characters", async () => {
      const response = await send({
        to: [recipient],
        templateSlug: "second-app-order-shipped",
        variables: {
          ...secondAppTemplateVariables,
          orderNumber: "o".repeat(100_000),
        },
      });
      expect(response.statusCode).toBe(422);
    });
  },
);
