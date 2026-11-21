/**
 * Pen test A2 (#93): User management, and what one stolen session can make that outlives the victim changing their
 * password. Answers H5. The findings note is `docs/pen-test/findings/A2.md`. A confirmed gap is an `it.fails` for the
 * property that should hold beside a `today_…` test pinning what happens now; a refuted probe is a plain passing test.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  arrayContains,
  count,
  eq,
  inArray,
  notInArray,
  sql,
} from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCliCommand } from "../../access/cli.js";
import { apiKeys, messages, settings, users } from "../../lib/schema.js";
import { fixtureDomain, fixtureUsers } from "../fixtures/fixture-plan.js";
import {
  hasContainerRuntime,
  startProbeWorld,
  warnIfSkipped,
  type ProbeWorld,
} from "./probe-world.js";

warnIfSkipped("src/pen-test/probes/a2.test.ts");

const adr0005Path = resolve(
  "docs/architectural-decision-record/0005-templates-and-sending-only.md",
);
const adr0011Path = resolve(
  "docs/architectural-decision-record/0011-every-user-has-full-rights-until-the-second-school.md",
);

describe("pen test A2 (#93): ADR 0005, without a container", () => {
  it("(regression) still decides that every User has full rights, and names when that ends, before a second School or a second Application's API Key, and a review date (#146)", async () => {
    const adr = await readFile(adr0005Path, "utf8");
    expect(adr).toContain("Every user has full rights.");
    expect(adr).toMatch(
      /stops being true before Wizzaroo adds a second School/u,
    );
    expect(adr).toMatch(/another Application is given an API Key/u);
    expect(adr).toMatch(/review on \d{4}-\d{2}-\d{2}/u);
    expect(adr).toContain(
      "0011-every-user-has-full-rights-until-the-second-school.md",
    );
    const decision = await readFile(adr0011Path, "utf8");
    expect(decision).toMatch(/second School/u);
    expect(decision).toMatch(/Review on \d{4}-\d{2}-\d{2}/u);
  });

  it('records when ADR 0005\'s "every User has full rights" has to stop being true', async () => {
    const adr = await readFile(adr0005Path, "utf8");
    expect(adr).toMatch(/\breview|revisit|expir|stops? being true|sunset/i);
  });
});

describe.skipIf(!hasContainerRuntime)(
  "pen test A2 (#93): User management",
  () => {
    let world: ProbeWorld;

    const fixtureUserIds = () => Object.values(world.ids.users);
    const fixtureKeyIds = () => Object.values(world.ids.apiKeys);

    /** Puts the fixtures back, and removes any User or API Key a probe made. */
    const resetWorld = async () => {
      await world.database
        .delete(users)
        .where(notInArray(users.id, fixtureUserIds()));
      await world.database
        .delete(apiKeys)
        .where(notInArray(apiKeys.id, fixtureKeyIds()));
      await world.reloadFixtures();
    };

    beforeAll(async () => {
      world = await startProbeWorld();
    }, 300_000);

    afterAll(async () => {
      await world.stop();
    });

    beforeEach(async () => {
      await resetWorld();
      await world.clearMail();
    });

    const asSession = (token: string) => ({ cookie: `session=${token}` });
    const attackerEmail = `attacker@users.${fixtureDomain}`;
    const attackerPassword = "an-attackers-own-password-01";
    /** The step-up a signed-in User gives: their own current password. */
    const stepUp = (handle: "victim" | "colleague") => ({
      currentPassword: world.credentials.passwords[handle],
    });
    /** What a stolen session has instead of the victim's password: a guess. */
    const guessedStepUp = { currentPassword: "a-guess-at-the-password-1" };

    /**
     * What a stolen session of the victim's does, without the victim's password: a User, an API Key, a deleted
     * colleague and a longer Retention.
     */
    const takeOver = async (stolen: string) => {
      const addUser = await world.server.inject({
        method: "POST",
        url: "/app/users",
        headers: asSession(stolen),
        payload: {
          email: attackerEmail,
          password: attackerPassword,
          ...guessedStepUp,
        },
      });
      const mintKey = await world.server.inject({
        method: "POST",
        url: "/app/api-keys",
        headers: asSession(stolen),
        payload: { name: "Backups", ...guessedStepUp },
      });
      const deleteColleague = await world.server.inject({
        method: "DELETE",
        url: `/app/users/${world.ids.users.colleague}`,
        headers: asSession(stolen),
        payload: guessedStepUp,
      });
      const changeRetention = await world.server.inject({
        method: "PUT",
        url: "/app/settings",
        headers: asSession(stolen),
        payload: { logRetentionDays: 3650 },
      });
      return { addUser, mintKey, deleteColleague, changeRetention };
    };

    const readSecret = (body: unknown): string => {
      const secret: unknown =
        typeof body === "object" && body !== null
          ? Reflect.get(body, "secret")
          : undefined;
      if (typeof secret !== "string") {
        throw new Error("Minting an API Key returned no secret");
      }
      return secret;
    };

    it("(regression) refuses a stolen session without the password a new User, a new API Key and the colleague's deletion, and ends it when the victim changes their password; Retention still changes (#115)", async () => {
      const stolen = await world.signIn("victim");
      const own = await world.signIn("victim");
      const made = await takeOver(stolen);
      const wrongPasswordRefusal = {
        error: "validation_failed",
        message: "The current password is wrong",
      };
      for (const refused of [
        made.addUser,
        made.mintKey,
        made.deleteColleague,
      ]) {
        expect(refused.statusCode).toBe(422);
        expect(refused.json()).toEqual(wrongPasswordRefusal);
      }
      // Settings ask for no step-up; Retention is outside this finding.
      expect(made.changeRetention.statusCode).toBe(200);
      const [keysLeft] = await world.database
        .select({ count: count() })
        .from(apiKeys)
        .where(notInArray(apiKeys.id, fixtureKeyIds()));
      expect(keysLeft?.count).toBe(0);

      const change = await world.server.inject({
        method: "PUT",
        url: "/app/me/password",
        headers: asSession(own),
        payload: {
          currentPassword: world.credentials.passwords.victim,
          newPassword: "the-victims-new-password-1",
        },
      });
      expect(change.statusCode).toBe(200);

      // The stolen session itself ends (A1's finding, #124), and the victim's own stays.
      const stolenMe = await world.server.inject({
        method: "GET",
        url: "/app/me",
        headers: asSession(stolen),
      });
      expect(stolenMe.statusCode).toBe(401);
      const ownMe = await world.server.inject({
        method: "GET",
        url: "/app/me",
        headers: asSession(own),
      });
      expect(ownMe.statusCode).toBe(200);
      // No User was added for the attacker to sign in as.
      const attackerSignIn = await world.server.inject({
        method: "POST",
        url: "/auth/sign-in",
        payload: { email: attackerEmail, password: attackerPassword },
      });
      expect(attackerSignIn.statusCode).toBe(401);
      // The colleague was not deleted; Retention stays at ten years.
      const colleagueSignIn = await world.server.inject({
        method: "POST",
        url: "/auth/sign-in",
        payload: {
          email: fixtureUsers.colleague.email,
          password: world.credentials.passwords.colleague,
        },
      });
      expect(colleagueSignIn.statusCode).toBe(200);
      const [row] = await world.database
        .select({ logRetentionDays: settings.logRetentionDays })
        .from(settings);
      expect(row?.logRetentionDays).toBe(3650);
    });

    it("asks for the current password before a session adds a User or mints an API Key", async () => {
      const stolen = await world.signIn("victim");
      const made = await takeOver(stolen);
      expect([401, 403, 422]).toContain(made.addUser.statusCode);
      expect([401, 403, 422]).toContain(made.mintKey.statusCode);
    });

    it("adds a User and mints an API Key once the session gives its User's current password", async () => {
      const victim = await world.signIn("victim");
      const addUser = await world.server.inject({
        method: "POST",
        url: "/app/users",
        headers: asSession(victim),
        payload: {
          email: attackerEmail,
          password: attackerPassword,
          ...stepUp("victim"),
        },
      });
      expect(addUser.statusCode).toBe(201);
      const mintKey = await world.server.inject({
        method: "POST",
        url: "/app/api-keys",
        headers: asSession(victim),
        payload: { name: "Backups", ...stepUp("victim") },
      });
      expect(mintKey.statusCode).toBe(201);
      const withMintedKey = await world.server.inject({
        method: "GET",
        url: "/v1/templates",
        headers: { authorization: `Bearer ${readSecret(mintKey.json())}` },
      });
      expect(withMintedKey.statusCode).toBe(200);
    });

    /* ---------- What is recorded, and who is told ---------- */

    const columnsOf = async (table: string): Promise<string[]> =>
      (
        await world.database.execute<{ column_name: string }>(
          sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table} order by ordinal_position`,
        )
      ).rows.map((row) => row.column_name);

    it("(regression) records which User made a User or an API Key, shows it in /app, and records none for the CLI's (#125)", async () => {
      expect(await columnsOf("users")).toEqual([
        "id",
        "email",
        "password_hash",
        "created_at",
        "created_by_user_id",
        // The User's request limits (I2a, #162, #164): counts, not a record of what they did.
        "request_tokens",
        "request_tokens_at",
        "test_send_window_started_at",
        "test_send_window_count",
      ]);
      expect(await columnsOf("api_keys")).toContain("created_by_user_id");
      const victim = await world.signIn("victim");
      const added = await world.server.inject({
        method: "POST",
        url: "/app/users",
        headers: asSession(victim),
        payload: {
          email: attackerEmail,
          password: attackerPassword,
          ...stepUp("victim"),
        },
      });
      const minted = await world.server.inject({
        method: "POST",
        url: "/app/api-keys",
        headers: asSession(victim),
        payload: { name: "Backups", ...stepUp("victim") },
      });
      const byVictim = {
        createdByUserId: world.ids.users.victim,
        createdByEmail: fixtureUsers.victim.email,
      };
      expect(added.json()).toMatchObject(byVictim);
      expect(minted.json()).toMatchObject({ apiKey: byVictim });
      const listedUsers = await world.server.inject({
        method: "GET",
        url: "/app/users",
        headers: asSession(victim),
      });
      expect(
        listedUsers
          .json<{ users: { email: string }[] }>()
          .users.find((user) => user.email === attackerEmail),
      ).toMatchObject(byVictim);
      const listedKeys = await world.server.inject({
        method: "GET",
        url: "/app/api-keys",
        headers: asSession(victim),
      });
      expect(
        listedKeys
          .json<{ apiKeys: { name: string }[] }>()
          .apiKeys.find((key) => key.name === "Backups"),
      ).toMatchObject(byVictim);
      // The CLI runs as an operator with no User, so it records none.
      await runCliCommand(
        world.database,
        ["user:create", `operator@users.${fixtureDomain}`],
        () => Promise.resolve("the-operators-password-01"),
      );
      const [operator] = await world.database
        .select({ createdByUserId: users.createdByUserId })
        .from(users)
        .where(eq(users.email, `operator@users.${fixtureDomain}`));
      expect(operator?.createdByUserId).toBeNull();
      // The record outlives the User it names: deleting the victim keeps the id on what they made.
      await world.database
        .delete(users)
        .where(eq(users.id, world.ids.users.victim));
      const [attacker] = await world.database
        .select({ createdByUserId: users.createdByUserId })
        .from(users)
        .where(eq(users.email, attackerEmail));
      expect(attacker?.createdByUserId).toBe(world.ids.users.victim);
    });

    it("records which User made each User and API Key", async () => {
      const creator = /created_by|creator|made_by/;
      expect(
        (await columnsOf("users")).some((name) => creator.test(name)),
      ).toBe(true);
      expect(
        (await columnsOf("api_keys")).some((name) => creator.test(name)),
      ).toBe(true);
    });

    const noticesToColleague = async () => {
      const [queued] = await world.database
        .select({ count: count() })
        .from(messages)
        .where(arrayContains(messages.to, [fixtureUsers.colleague.email]));
      const mailed = (await world.listMail()).filter((mail) =>
        mail.To.some(
          (address) => address.Address === fixtureUsers.colleague.email,
        ),
      );
      return (queued?.count ?? 0) + mailed.length;
    };

    it("(regression) emails the other Users, and not the one who acted, when a User is added or deleted or an API Key minted; the notices have no Application (#125)", async () => {
      const noticeSubjects = [
        "A User was added to the email platform",
        "An API key was minted on the email platform",
        "A User was deleted from the email platform",
      ];
      // Messages outlive a reset, so this probe's notices are the ones not there before it.
      const earlier = new Set(
        (await world.database.select({ id: messages.id }).from(messages)).map(
          (row) => row.id,
        ),
      );
      const victim = await world.signIn("victim");
      const added = await world.server.inject({
        method: "POST",
        url: "/app/users",
        headers: asSession(victim),
        payload: {
          email: attackerEmail,
          password: attackerPassword,
          ...stepUp("victim"),
        },
      });
      const minted = await world.server.inject({
        method: "POST",
        url: "/app/api-keys",
        headers: asSession(victim),
        payload: { name: "Backups", ...stepUp("victim") },
      });
      const addedId = String(Reflect.get(added.json(), "id"));
      const deleted = await world.server.inject({
        method: "DELETE",
        url: `/app/users/${addedId}`,
        headers: asSession(victim),
        payload: stepUp("victim"),
      });
      expect([added.statusCode, minted.statusCode, deleted.statusCode]).toEqual(
        [201, 201, 200],
      );
      const notices = (
        await world.database
          .select()
          .from(messages)
          .where(inArray(messages.subject, noticeSubjects))
      ).filter((notice) => !earlier.has(notice.id));
      // Never the victim, who acted, nor the User just added; the added User is told of the key minted after it.
      const [addedSubject, mintedSubject, deletedSubject] = noticeSubjects;
      expect(
        notices.map((notice) => [notice.subject, ...notice.to]).sort(),
      ).toEqual(
        [
          [addedSubject, fixtureUsers.colleague.email],
          [mintedSubject, fixtureUsers.colleague.email],
          [mintedSubject, attackerEmail],
          [deletedSubject, fixtureUsers.colleague.email],
        ].sort(),
      );
      for (const notice of notices) {
        // Shown in the Logs to Users, and to no API Key.
        expect(notice.applicationId).toBeNull();
        expect(notice.apiKeyId).toBeNull();
        expect(notice.text).toContain(fixtureUsers.victim.email);
        expect(await world.deliver(notice.id)).toBe("sent");
      }
      const mailed = (await world.listMail()).filter((mail) =>
        mail.To.some(
          (address) => address.Address === fixtureUsers.colleague.email,
        ),
      );
      expect(mailed).toHaveLength(3);
    });

    it("tells the other Users when a User is added or an API Key minted", async () => {
      const stolen = await world.signIn("victim");
      await world.server.inject({
        method: "POST",
        url: "/app/users",
        headers: asSession(stolen),
        payload: {
          email: attackerEmail,
          password: attackerPassword,
          ...stepUp("victim"),
        },
      });
      await world.server.inject({
        method: "POST",
        url: "/app/api-keys",
        headers: asSession(stolen),
        payload: { name: "Backups", ...stepUp("victim") },
      });
      expect(await noticesToColleague()).toBeGreaterThan(0);
    });

    /* ---------- Which emails have accounts ---------- */

    it("names an email that has an account when a User adds it again, which GET /app/users already lists to the same User", async () => {
      const added = await world.request(
        { user: "victim" },
        {
          method: "POST",
          url: "/app/users",
          payload: {
            email: fixtureUsers.colleague.email.toUpperCase(),
            password: attackerPassword,
            ...stepUp("victim"),
          },
        },
      );
      expect(added.statusCode).toBe(422);
      expect(added.json()).toEqual({
        error: "validation_failed",
        message: `A user with the email ${fixtureUsers.colleague.email} exists`,
      });
      const listed = await world.request(
        { user: "victim" },
        { method: "GET", url: "/app/users" },
      );
      expect(listed.statusCode).toBe(200);
      expect(listed.body).toContain(fixtureUsers.colleague.email);
    });

    it("answers a POST /app/users without a session, and with an API Key, the same whether the email has an account or not", async () => {
      for (const as of ["anonymous", { key: "wizzaroo" }] as const) {
        const [withAccount, withoutAccount] = await Promise.all(
          [fixtureUsers.colleague.email, `nobody@users.${fixtureDomain}`].map(
            (email) =>
              world.request(as, {
                method: "POST",
                url: "/app/users",
                payload: { email, password: attackerPassword },
              }),
          ),
        );
        expect(withAccount?.statusCode).toBe(401);
        expect(withoutAccount?.statusCode).toBe(401);
        expect(withoutAccount?.body).toBe(withAccount?.body);
      }
    });

    /* ---------- Deleting oneself, and the last User ---------- */

    it("refuses a User deleting themselves by their id", async () => {
      const response = await world.request(
        { user: "victim" },
        {
          method: "DELETE",
          url: `/app/users/${world.ids.users.victim}`,
          payload: stepUp("victim"),
        },
      );
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        error: "cannot_delete_self",
        message: "You cannot delete the user you are signed in as",
      });
    });

    it("(regression) refuses a User deleting themselves by their id in upper case with 409 cannot_delete_self, so the last User stays (#145)", async () => {
      const victim = await world.signIn("victim");
      const deleteColleague = await world.server.inject({
        method: "DELETE",
        url: `/app/users/${world.ids.users.colleague}`,
        headers: asSession(victim),
        payload: stepUp("victim"),
      });
      expect(deleteColleague.statusCode).toBe(200);
      const deleteSelf = await world.server.inject({
        method: "DELETE",
        url: `/app/users/${world.ids.users.victim.toUpperCase()}`,
        headers: asSession(victim),
        payload: stepUp("victim"),
      });
      expect(deleteSelf.statusCode).toBe(409);
      expect(deleteSelf.json()).toEqual({
        error: "cannot_delete_self",
        message: "You cannot delete the user you are signed in as",
      });
      const [left] = await world.database
        .select({ count: count() })
        .from(users);
      expect(left?.count).toBe(1);
    });

    it("refuses a User deleting themselves whatever the case of their id", async () => {
      const response = await world.request(
        { user: "victim" },
        {
          method: "DELETE",
          url: `/app/users/${world.ids.users.victim.toUpperCase()}`,
          payload: stepUp("victim"),
        },
      );
      expect(response.statusCode).toBe(409);
    });

    it("keeps API Keys working, refuses every sign-in, and lets the CLI add a User, when the last User is deleted in the database", async () => {
      await world.database
        .delete(users)
        .where(inArray(users.id, fixtureUserIds()));
      const [left] = await world.database
        .select({ count: count() })
        .from(users);
      expect(left?.count).toBe(0);
      const victimSignIn = await world.server.inject({
        method: "POST",
        url: "/auth/sign-in",
        payload: {
          email: fixtureUsers.victim.email,
          password: world.credentials.passwords.victim,
        },
      });
      expect(victimSignIn.statusCode).toBe(401);
      const withKey = await world.request(
        { key: "wizzaroo" },
        { method: "GET", url: "/v1/templates" },
      );
      expect(withKey.statusCode).toBe(200);
      // There is no CLI command to delete a User; the CLI is how an operator gets back in.
      await expect(
        runCliCommand(world.database, ["user:delete", attackerEmail], () =>
          Promise.resolve(attackerPassword),
        ),
      ).rejects.toThrow(/Commands:/);
      const created = await runCliCommand(
        world.database,
        ["user:create", `operator@users.${fixtureDomain}`],
        () => Promise.resolve("the-operators-password-01"),
      );
      expect(created).toBe(`Created user operator@users.${fixtureDomain}`);
    });

    /* ---------- ADR 0005: every User has full rights ---------- */

    it("today_ lets any User change Settings, mint an API Key, delete an API Key and delete another User, as ADR 0005 decides", async () => {
      const colleague = await world.asUser("colleague");
      const changes = await Promise.all([
        world.server.inject({
          method: "PUT",
          url: "/app/settings",
          headers: colleague,
          payload: { logRetentionDays: 1 },
        }),
        world.server.inject({
          method: "POST",
          url: "/app/api-keys",
          headers: colleague,
          payload: { name: "Colleague's key", ...stepUp("colleague") },
        }),
        world.server.inject({
          method: "DELETE",
          url: `/app/api-keys/${world.ids.apiKeys.wizzaroo}`,
          headers: colleague,
        }),
      ]);
      expect(changes.map((response) => response.statusCode)).toEqual([
        200, 201, 200,
      ]);
      const deleteVictim = await world.server.inject({
        method: "DELETE",
        url: `/app/users/${world.ids.users.victim}`,
        headers: colleague,
        payload: stepUp("colleague"),
      });
      expect(deleteVictim.statusCode).toBe(200);
    });

    /* ---------- Odd input ---------- */

    it("(regression) refuses adding a User whose email holds a NUL byte, or is 10,000 characters long (a longer one is past the 16 KiB body limit, #172), with 422 naming the email, and stores neither (#144)", async () => {
      const emails = [
        `nul\u0000@users.${fixtureDomain}`,
        `${"a".repeat(10_000)}@users.${fixtureDomain}`,
      ];
      for (const email of emails) {
        const response = await world.request(
          { user: "victim" },
          {
            method: "POST",
            url: "/app/users",
            payload: { email, password: attackerPassword, ...stepUp("victim") },
          },
        );
        expect(response.statusCode).toBe(422);
        expect(
          response.json<{ errors: { field: string }[] }>().errors[0]?.field,
        ).toMatch(/email$/);
      }
      const users = await world.request(
        { user: "victim" },
        { method: "GET", url: "/app/users" },
      );
      expect(users.body).not.toContain("aaaaaaaaaa@");
    });

    it("refuses adding a User whose email holds a NUL byte or runs past 254 characters, with 422", async () => {
      const statuses = await Promise.all(
        [
          `nul\u0000@users.${fixtureDomain}`,
          `${"a".repeat(10_000)}@users.${fixtureDomain}`,
        ].map(async (email) => {
          const response = await world.request(
            { user: "victim" },
            {
              method: "POST",
              url: "/app/users",
              payload: {
                email,
                password: attackerPassword,
                ...stepUp("victim"),
              },
            },
          );
          return response.statusCode;
        }),
      );
      expect(statuses).toEqual([422, 422]);
    });
  },
);
