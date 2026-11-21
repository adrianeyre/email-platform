/**
 * Pen test S2 (#97): the Idempotency-Key (H7). `messages.idempotency_key` was unique across the whole table; since
 * ADR 0009 it is unique within the sending Application. It is looked up before anything else in `acceptMessage`, so
 * these probes send one key as `wizzaroo` and as `secondApp`, with different bodies, after Retention, and twice at once.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { messages } from "../../lib/schema.js";
import { applyRetention } from "../../sending/retention.js";
import { builtInEmails } from "../../templates/built-in-emails.js";
import {
  wizzarooLinkOrigin,
  type ApiKeyHandle,
} from "../fixtures/fixture-plan.js";
import {
  hasContainerRuntime,
  startProbeWorld,
  warnIfSkipped,
  type ProbeWorld,
} from "./probe-world.js";

warnIfSkipped("src/pen-test/probes/s2.test.ts");

const resetSlug = "wizzaroo-reset-your-password";
const parent = "parent-s2@families.pen-test.invalid";
const customer = "customer-s2@customers.pen-test.invalid";

/** Wizzaroo's reset email to `parent`, with a synthetic link on Wizzaroo's fixture origin. */
const wizzarooReset = () => {
  const email = builtInEmails.find((item) => item.slug === resetSlug);
  if (email === undefined) {
    throw new Error(`There is no Built-in email ${resetSlug}`);
  }
  const variables = Object.fromEntries(
    Object.entries(email.sampleVariables).map(([name, value]) => [
      name,
      name === "email"
        ? parent
        : name.endsWith("Url")
          ? `${wizzarooLinkOrigin}/reset?token=pen-test-s2-not-a-real-token`
          : value,
    ]),
  );
  return { to: [parent], templateSlug: resetSlug, variables };
};

const secondAppOrder = (orderNumber = "SA-S2") => ({
  to: [customer],
  templateSlug: "second-app-order-shipped",
  variables: {
    orderNumber,
    trackingUrl: `https://second-app.pen-test.invalid/track/${orderNumber}`,
  },
});

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

const freshKey = (label: string) => `s2-${label}-${randomUUID()}`;

describe.skipIf(!hasContainerRuntime)(
  "pen test S2 (#97): the Idempotency-Key",
  () => {
    let world: ProbeWorld;

    beforeAll(async () => {
      world = await startProbeWorld();
    }, 300_000);
    afterAll(async () => world.stop());
    // These probes send more than a key may in a minute; the send limit is K1's (#133).
    beforeEach(async () => world.forgetSendWindows());

    const send = async (
      key: ApiKeyHandle | "anonymous",
      payload: Record<string, unknown>,
      idempotencyKey: string,
    ) =>
      world.request(key === "anonymous" ? "anonymous" : { key }, {
        method: "POST",
        url: "/v1/messages",
        payload,
        headers: { "idempotency-key": idempotencyKey },
      });

    const summaryOf = (body: unknown): Summary => {
      if (!isSummary(body)) {
        throw new Error("Not a Message summary");
      }
      return body;
    };

    const messagesTo = async (address: string) =>
      world.database
        .select({ id: messages.id })
        .from(messages)
        .where(sql`${address} = any(${messages.to})`);

    const messagesWithKey = async (idempotencyKey: string) =>
      world.database
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.idempotencyKey, idempotencyKey));

    /** A fixture Wizzaroo Message that failed and carries a key, so its summary holds an SMTP error. */
    const failedWizzarooFixture = () => {
      const message = world.plan.messages.find(
        (item) =>
          item.application === "wizzaroo" &&
          item.status === "failed" &&
          item.idempotencyKey !== null,
      );
      if (message?.idempotencyKey == null) {
        throw new Error("The plan has no failed Wizzaroo Message with a key");
      }
      return { ...message, idempotencyKey: message.idempotencyKey };
    };

    /* ---------- Probe 1: wizzaroo's key, repeated by second-app ---------- */

    it("(regression) answers second-app's repeat of wizzaroo's key with 202 and a Message of its own, so nothing of Wizzaroo's Message is read (K1, ADR 0009)", async () => {
      const key = freshKey("read");
      const first = await send("wizzaroo", wizzarooReset(), key);
      expect(first.statusCode).toBe(202);
      const wizzarooMessage = summaryOf(first.json());

      const repeat = await send("secondApp", secondAppOrder(), key);
      expect(repeat.statusCode).toBe(202);
      expect(summaryOf(repeat.json()).id).not.toBe(wizzarooMessage.id);
      expect(summaryOf(repeat.json()).to).toEqual([customer]);
      expect(repeat.body).not.toContain(parent);
      expect(await messagesWithKey(key)).toHaveLength(2);

      // A fixture key in Wizzaroo's pattern is second-app's own key too: a new Message, none of the fixture's.
      const fixture = failedWizzarooFixture();
      const guessed = await send(
        "secondApp",
        secondAppOrder(),
        fixture.idempotencyKey,
      );
      expect(guessed.statusCode).toBe(202);
      const read = summaryOf(guessed.json());
      expect(read.id).not.toBe(fixture.id);
      expect(read.to).not.toEqual(fixture.to);
      expect(read.error).toBeNull();
      expect(JSON.stringify(read)).not.toContain(wizzarooLinkOrigin);
      // Wizzaroo's own repeat still finds Wizzaroo's Message.
      const wizzarooRepeat = await send("wizzaroo", wizzarooReset(), key);
      expect(wizzarooRepeat.statusCode).toBe(200);
      expect(summaryOf(wizzarooRepeat.json()).id).toBe(wizzarooMessage.id);
      await world.reloadFixtures();
    });

    it("never answers second-app's request with Wizzaroo's Message when it repeats wizzaroo's key", async () => {
      const key = freshKey("read-property");
      const first = await send("wizzaroo", wizzarooReset(), key);
      const wizzarooId = summaryOf(first.json()).id;
      const repeat = await send("secondApp", secondAppOrder(), key);
      const body: unknown = repeat.json();
      expect(isSummary(body) ? body.id : undefined).not.toBe(wizzarooId);
      expect(isSummary(body) ? body.to : []).not.toContain(parent);
    });

    /* ---------- Probe 2: second-app takes the key first, so Wizzaroo's email is never sent ---------- */

    it("(regression) answers wizzaroo's reset with 202 and a Message of its own when second-app used its key first, and Wizzaroo's email is sent (K1, ADR 0009)", async () => {
      const key = freshKey("preempt");
      const parentMessagesBefore = (await messagesTo(parent)).length;
      const first = await send("secondApp", secondAppOrder(), key);
      expect(first.statusCode).toBe(202);
      const secondAppMessage = summaryOf(first.json());

      const reset = await send("wizzaroo", wizzarooReset(), key);
      expect(reset.statusCode).toBe(202);
      const resetMessage = summaryOf(reset.json());
      expect(resetMessage.id).not.toBe(secondAppMessage.id);
      expect(await messagesTo(parent)).toHaveLength(parentMessagesBefore + 1);

      await world.clearMail();
      expect(await world.deliver(resetMessage.id)).toBe("sent");
      const mail = await world.listMail();
      expect(mail.flatMap((item) => item.To.map((to) => to.Address))).toEqual([
        parent,
      ]);
    });

    it("sends wizzaroo's reset, with a Message of its own, when second-app used its key first", async () => {
      const key = freshKey("preempt-property");
      const parentMessagesBefore = (await messagesTo(parent)).length;
      await send("secondApp", secondAppOrder(), key);
      const reset = await send("wizzaroo", wizzarooReset(), key);
      expect(reset.statusCode).toBe(202);
      expect(await messagesTo(parent)).toHaveLength(parentMessagesBefore + 1);
    });

    /* ---------- Probe 3: a different body, and the same body after Retention ---------- */

    it("(regression) refuses the same key with a different body, or a body that would be refused, with 409, stores nothing new, and still replays the same body with 200 (#135)", async () => {
      const key = freshKey("body");
      const first = await send("secondApp", secondAppOrder("SA-FIRST"), key);
      expect(first.statusCode).toBe(202);
      const other = await send(
        "secondApp",
        {
          ...secondAppOrder("SA-OTHER"),
          to: ["someone-else@customers.pen-test.invalid"],
        },
        key,
      );
      expect(other.statusCode).toBe(409);
      expect(other.json()).toEqual({
        error: "idempotency_key_reused",
        message:
          "This Idempotency-Key was sent before with a different request. Send a new key for a different message",
      });
      expect(
        await messagesTo("someone-else@customers.pen-test.invalid"),
      ).toEqual([]);
      const invalid = await send(
        "secondApp",
        { to: [customer], templateSlug: "no-such-template" },
        key,
      );
      expect(invalid.statusCode).toBe(409);
      expect(await messagesWithKey(key)).toHaveLength(1);
      // The same request, its keys in another order, is a retry and gets the first Message.
      const { variables, ...rest } = secondAppOrder("SA-FIRST");
      const again = await send(
        "secondApp",
        {
          variables: Object.fromEntries(Object.entries(variables).toReversed()),
          ...rest,
        },
        key,
      );
      expect(again.statusCode).toBe(200);
      expect(summaryOf(again.json())).toEqual(summaryOf(first.json()));
    });

    it("refuses the same key with a different body", async () => {
      const key = freshKey("body-property");
      await send("secondApp", secondAppOrder("SA-FIRST"), key);
      const other = await send("secondApp", secondAppOrder("SA-OTHER"), key);
      expect(other.statusCode).toBe(409);
    });

    it("forgets a key with its Message: the same body after Retention deleted the first is a new Message", async () => {
      try {
        const key = freshKey("retention");
        const first = await send("secondApp", secondAppOrder(), key);
        expect(first.statusCode).toBe(202);
        const firstId = summaryOf(first.json()).id;
        await world.database
          .update(messages)
          .set({ createdAt: new Date(Date.now() - 91 * 86_400_000) })
          .where(eq(messages.id, firstId));
        const { deletedMessages } = await applyRetention(
          world.database,
          new Date(),
        );
        expect(deletedMessages).toBeGreaterThanOrEqual(1);
        expect(await messagesWithKey(key)).toEqual([]);

        const again = await send("secondApp", secondAppOrder(), key);
        expect(again.statusCode).toBe(202);
        expect(summaryOf(again.json()).id).not.toBe(firstId);
      } finally {
        await world.reloadFixtures();
      }
    });

    /* ---------- Probe 4: two requests with one key at once ---------- */

    it("answers two requests with one key at the same moment with one 202 and one 200 for one Message, three times over", async () => {
      for (let round = 0; round < 3; round += 1) {
        const key = freshKey(`race-${String(round)}`);
        const responses = await Promise.all([
          send("secondApp", secondAppOrder(), key),
          send("secondApp", secondAppOrder(), key),
        ]);
        expect(
          responses.map((response) => response.statusCode).toSorted(),
        ).toEqual([200, 202]);
        const ids = responses.map((response) => summaryOf(response.json()).id);
        expect(new Set(ids).size).toBe(1);
        expect(await messagesWithKey(key)).toHaveLength(1);
      }
    });

    /* ---------- Checks every scope issue carries ---------- */

    it("gives a caller with no key, or a deleted key, the same 401 whether the Idempotency-Key exists or not", async () => {
      const fixture = failedWizzarooFixture();
      for (const as of ["anonymous", "deleted"] as const) {
        const [existing, unknown] = await Promise.all(
          [fixture.idempotencyKey, freshKey("unknown")].map(async (key) =>
            send(as, secondAppOrder(), key),
          ),
        );
        expect(existing?.statusCode).toBe(401);
        expect(unknown?.statusCode).toBe(401);
        expect(existing?.body).toBe(unknown?.body);
      }
    });

    it("refuses an Idempotency-Key longer than 255 characters with 422", async () => {
      const response = await send(
        "secondApp",
        secondAppOrder(),
        "k".repeat(256),
      );
      expect(response.statusCode).toBe(422);
    });

    it("(regression) answers an Idempotency-Key holding a NUL byte with 422 naming the header (#151)", async () => {
      const response = await send("secondApp", secondAppOrder(), "k\u0000k");
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: "validation_failed",
        errors: [{ field: "headers.idempotency-key" }],
      });
    });

    it("refuses an Idempotency-Key holding a NUL byte with a 4xx", async () => {
      const response = await send("secondApp", secondAppOrder(), "k\u0000k");
      expect(response.statusCode).toBeLessThan(500);
    });
  },
);
