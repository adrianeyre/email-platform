import { and, asc, eq, gt, lt, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../lib/database.js";
import { RejectedRequestError, type SignedInUser } from "../lib/http.js";
import { sessions, users, type UserRow } from "../lib/schema.js";
import {
  generateSecret,
  hashPassword,
  hashSecret,
  isPasswordHashOutdated,
  isPasswordMatch,
} from "../lib/secrets.js";

/** The longest a session lasts, however often it is used. */
export const sessionDays = 30;
/**
 * A session left unused this long is refused, within its 30 days (pen test A1, #143). Seven days is a decision the
 * owner may change: long enough that a weekly User stays signed in, short enough that a cookie in a forgotten browser
 * profile or backup stops working within a week.
 */
export const sessionIdleDays = 7;
/** A session's last use is written at most this often, so each request isn't a write on its row. */
const sessionTouchMs = 5 * 60_000;
export const minimumPasswordLength = 12;
/**
 * The longest password taken anywhere (pen test A1, #141): far beyond any real one, short enough that refusing a long
 * one costs nothing, and refused before it is hashed.
 */
export const maxPasswordLength = 1024;
const dayMs = 86_400_000;

export class UserRefusedError extends RejectedRequestError {
  override name = "UserRefusedError";

  constructor(message: string) {
    super(422, "validation_failed", message);
  }
}

export const normaliseEmail = (email: string): string =>
  email.trim().toLowerCase();

const assertPasswordStrength = (password: string): void => {
  if (password.length < minimumPasswordLength) {
    throw new UserRefusedError(
      `The password must be at least ${String(minimumPasswordLength)} characters`,
    );
  }
  if (password.length > maxPasswordLength) {
    throw new UserRefusedError(
      `The password must be at most ${String(maxPasswordLength)} characters`,
    );
  }
};

export interface UserSummary {
  id: string;
  email: string;
  createdAt: Date;
  /** The User who added this one: null when the CLI made it or it is older than the record (pen test A2, #125). */
  createdByUserId: string | null;
  /** That User's email, while they exist. */
  createdByEmail: string | null;
}

const summariseUser = (
  user: UserRow,
  createdByEmail: string | null,
): UserSummary => ({
  id: user.id,
  email: user.email,
  createdAt: user.createdAt,
  createdByUserId: user.createdByUserId,
  createdByEmail,
});

/** Adds a User. `createdBy` is the signed-in User adding them; the CLI gives none. */
export const createUser = async (
  database: Database,
  email: string,
  password: string,
  createdBy?: { userId: string; email: string },
): Promise<UserSummary> => {
  const normalised = normaliseEmail(email);
  if (!/^[^\s@]+@[^\s@]+$/.test(normalised)) {
    throw new UserRefusedError(`"${email}" is not an email address`);
  }
  assertPasswordStrength(password);
  const [existing] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalised));
  if (existing !== undefined) {
    throw new UserRefusedError(`A user with the email ${normalised} exists`);
  }
  const [user] = await database
    .insert(users)
    .values({
      email: normalised,
      passwordHash: await hashPassword(password),
      createdByUserId: createdBy?.userId ?? null,
    })
    .returning();
  if (user === undefined) {
    throw new Error("The user was not created");
  }
  return summariseUser(user, createdBy?.email ?? null);
};

const creators = alias(users, "creators");

export const listUsers = async (database: Database): Promise<UserSummary[]> =>
  (
    await database
      .select({ user: users, createdByEmail: creators.email })
      .from(users)
      .leftJoin(creators, eq(creators.id, users.createdByUserId))
      .orderBy(asc(users.email))
  ).map((row) => summariseUser(row.user, row.createdByEmail));

/** Deletes a User, and answers their email, or undefined when there is no such User. */
export const deleteUser = async (
  database: Database,
  userId: string,
  signedInUserId: string,
): Promise<string | undefined> => {
  // Postgres reads a uuid in any case, so the ids are compared as it compares them (pen test A2, #145).
  if (userId.toLowerCase() === signedInUserId.toLowerCase()) {
    throw new RejectedRequestError(
      409,
      "cannot_delete_self",
      "You cannot delete the user you are signed in as",
    );
  }
  const [deleted] = await database
    .delete(users)
    .where(eq(users.id, userId))
    .returning({ email: users.email });
  return deleted?.email;
};

/** Refused when a step-up's current password is wrong, so a route can count the failure. */
export class CurrentPasswordWrongError extends UserRefusedError {
  override name = "CurrentPasswordWrongError";

  constructor() {
    super("The current password is wrong");
  }
}

/**
 * Step-up: checks the signed-in User's password again before a change a stolen session must not make on its own:
 * adding a User, minting an API Key, deleting a User and changing the password.
 */
export const assertCurrentPassword = async (
  database: Database,
  userId: string,
  currentPassword: string,
): Promise<void> => {
  const [user] = await database
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId));
  if (
    user === undefined ||
    !(await isPasswordMatch(currentPassword, user.passwordHash))
  ) {
    throw new CurrentPasswordWrongError();
  }
};

/**
 * Sets a new password and ends every other session of the User, keeping only the one that asked. Check the current
 * password first, with `assertCurrentPassword`.
 */
export const changePassword = async (
  database: Database,
  userId: string,
  newPassword: string,
  keptSessionToken: string,
): Promise<void> => {
  assertPasswordStrength(newPassword);
  const passwordHash = await hashPassword(newPassword);
  await database.transaction(async (transaction) => {
    await transaction
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, userId));
    await transaction
      .delete(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          ne(sessions.tokenHash, hashSecret(keptSessionToken)),
        ),
      );
  });
};

export const verifyCredentials = async (
  database: Database,
  email: string,
  password: string,
): Promise<UserRow | undefined> => {
  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.email, normaliseEmail(email)));
  if (user === undefined) {
    await hashPassword(password);
    return undefined;
  }
  if (!(await isPasswordMatch(password, user.passwordHash))) {
    return undefined;
  }
  // A hash made at an older, cheaper cost is made again now the password is at hand (pen test A1, #140).
  if (isPasswordHashOutdated(user.passwordHash)) {
    await database
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(
        and(eq(users.id, user.id), eq(users.passwordHash, user.passwordHash)),
      );
  }
  return user;
};

const idleSince = (now: Date): Date =>
  new Date(now.getTime() - sessionIdleDays * dayMs);

export const createSession = async (
  database: Database,
  userId: string,
  now = new Date(),
): Promise<string> => {
  const token = generateSecret(32);
  await database
    .delete(sessions)
    .where(
      or(lt(sessions.expiresAt, now), lt(sessions.lastUsedAt, idleSince(now))),
    );
  await database.insert(sessions).values({
    tokenHash: hashSecret(token),
    userId,
    expiresAt: new Date(now.getTime() + sessionDays * dayMs),
  });
  return token;
};

export const deleteSession = async (
  database: Database,
  token: string,
): Promise<void> => {
  await database
    .delete(sessions)
    .where(eq(sessions.tokenHash, hashSecret(token)));
};

export const loadSignedInUser = async (
  database: Database,
  token: string | undefined,
): Promise<SignedInUser | null> => {
  if (token === undefined || token === "") {
    return null;
  }
  const now = new Date();
  const tokenHash = hashSecret(token);
  const [row] = await database
    .select({
      userId: users.id,
      email: users.email,
      lastUsedAt: sessions.lastUsedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        gt(sessions.expiresAt, now),
        gt(sessions.lastUsedAt, idleSince(now)),
      ),
    );
  if (row === undefined) {
    return null;
  }
  if (now.getTime() - row.lastUsedAt.getTime() > sessionTouchMs) {
    await database
      .update(sessions)
      .set({ lastUsedAt: now })
      .where(eq(sessions.tokenHash, tokenHash));
  }
  return { userId: row.userId, email: row.email };
};
