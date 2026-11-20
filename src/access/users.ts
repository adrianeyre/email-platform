import { and, asc, eq, gt, lt } from "drizzle-orm";
import type { Database } from "../lib/database.js";
import { RejectedRequestError, type SignedInUser } from "../lib/http.js";
import { sessions, users, type UserRow } from "../lib/schema.js";
import {
  generateSecret,
  hashPassword,
  hashSecret,
  isPasswordMatch,
} from "../lib/secrets.js";

export const sessionDays = 30;
export const minimumPasswordLength = 12;
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
};

export interface UserSummary {
  id: string;
  email: string;
  createdAt: Date;
}

const summariseUser = (user: UserRow): UserSummary => ({
  id: user.id,
  email: user.email,
  createdAt: user.createdAt,
});

export const createUser = async (
  database: Database,
  email: string,
  password: string,
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
    .values({ email: normalised, passwordHash: await hashPassword(password) })
    .returning();
  if (user === undefined) {
    throw new Error("The user was not created");
  }
  return summariseUser(user);
};

export const listUsers = async (database: Database): Promise<UserSummary[]> =>
  (await database.select().from(users).orderBy(asc(users.email))).map(
    summariseUser,
  );

export const deleteUser = async (
  database: Database,
  userId: string,
  signedInUserId: string,
): Promise<boolean> => {
  if (userId === signedInUserId) {
    throw new RejectedRequestError(
      409,
      "cannot_delete_self",
      "You cannot delete the user you are signed in as",
    );
  }
  const deleted = await database
    .delete(users)
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  return deleted.length > 0;
};

export const changePassword = async (
  database: Database,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> => {
  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.id, userId));
  if (
    user === undefined ||
    !(await isPasswordMatch(currentPassword, user.passwordHash))
  ) {
    throw new UserRefusedError("The current password is wrong");
  }
  assertPasswordStrength(newPassword);
  await database
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, userId));
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
  return (await isPasswordMatch(password, user.passwordHash))
    ? user
    : undefined;
};

export const createSession = async (
  database: Database,
  userId: string,
  now = new Date(),
): Promise<string> => {
  const token = generateSecret(32);
  await database.delete(sessions).where(lt(sessions.expiresAt, now));
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
  const [row] = await database
    .select({ userId: users.id, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashSecret(token)),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  return row ?? null;
};
