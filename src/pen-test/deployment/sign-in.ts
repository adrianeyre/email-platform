/**
 * The sign-in harness (pen test E4, #90): `pnpm --silent pen-test:sign-in <handle>` signs in as a named fixture User,
 * or picks a named fixture API Key, and writes the header a request needs, `Cookie: session=…` or
 * `Authorization: Bearer ek_…`, for `curl -H @file`.
 *
 * It takes every credential from the environment (the credentials package), never from the command line, where shell
 * history and `ps` keep it. It is given one thing, the handle, and refuses anything else, a flag such as `--password`
 * included, without repeating what it was given. It refuses to write to a terminal, because what it writes is a
 * credential.
 */
import { resolve } from "node:path";
import {
  apiKeyHandles,
  fixtureUsers,
  userHandles,
  type ApiKeyHandle,
  type UserHandle,
} from "../fixtures/fixture-plan.js";

export type CredentialKind = "user" | "key";

const screamingSnake = (handle: string) =>
  handle.replace(/([a-z])([A-Z])/gu, "$1_$2").toUpperCase();

/** `PEN_TEST_PASSWORD_VICTIM`, `PEN_TEST_API_KEY_SECOND_APP` and the like. */
export const credentialVariableName = (
  kind: CredentialKind,
  handle: string,
): string =>
  kind === "user"
    ? `PEN_TEST_PASSWORD_${screamingSnake(handle)}`
    : `PEN_TEST_API_KEY_${screamingSnake(handle)}`;

export class HarnessRefusedError extends Error {
  override name = "HarnessRefusedError";
}

const isUserHandle = (value: string): value is UserHandle =>
  userHandles.some((handle) => handle === value);

const isApiKeyHandle = (value: string): value is ApiKeyHandle =>
  apiKeyHandles.some((handle) => handle === value);

const usage = `Give one fixture handle, and nothing else: ${[...userHandles, ...apiKeyHandles].join(", ")}. Credentials come from the environment (the credentials package), never from the command line.`;

/** The one handle in the arguments. Anything else, a flag above all, is refused without being repeated. */
export const readHandle = (
  args: readonly string[],
): UserHandle | ApiKeyHandle => {
  const [handle, ...rest] = args;
  if (
    handle === undefined ||
    rest.length > 0 ||
    handle.startsWith("-") ||
    !(isUserHandle(handle) || isApiKeyHandle(handle))
  ) {
    throw new HarnessRefusedError(usage);
  }
  return handle;
};

const readCredential = (
  environment: NodeJS.ProcessEnv,
  kind: CredentialKind,
  handle: string,
): string => {
  const name = credentialVariableName(kind, handle);
  const value = environment[name];
  if (value === undefined || value === "") {
    throw new HarnessRefusedError(
      `${name} is not set: load the credentials package into the environment first`,
    );
  }
  return value;
};

export interface SignInOptions {
  environment: NodeJS.ProcessEnv;
  /** The deployment's origin; PEN_TEST_URL in the credentials package. */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

/** The header that makes a request as the named fixture: a session cookie for a User, a bearer token for a key. */
export const signInAs = async (
  handle: UserHandle | ApiKeyHandle,
  { environment, baseUrl, fetch = globalThis.fetch }: SignInOptions,
): Promise<string> => {
  if (isApiKeyHandle(handle)) {
    return `Authorization: Bearer ${readCredential(environment, "key", handle)}`;
  }
  const origin = baseUrl ?? environment.PEN_TEST_URL;
  if (origin === undefined || origin === "") {
    throw new HarnessRefusedError(
      "PEN_TEST_URL is not set: load the credentials package into the environment first",
    );
  }
  const response = await fetch(new URL("/auth/sign-in", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: fixtureUsers[handle].email,
      password: readCredential(environment, "user", handle),
    }),
  });
  const session = response.headers
    .getSetCookie()
    .map((cookie) => /^session=([^;]+)/u.exec(cookie)?.[1])
    .find((token) => token !== undefined);
  if (!response.ok || session === undefined) {
    throw new HarnessRefusedError(
      `Signing in as ${handle} was refused with ${String(response.status)}`,
    );
  }
  return `Cookie: session=${session}`;
};

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(import.meta.filename);

if (isMain) {
  try {
    const handle = readHandle(process.argv.slice(2));
    if (process.stdout.isTTY) {
      throw new HarnessRefusedError(
        "Refused to write a credential to a terminal: redirect it to a file only you can read",
      );
    }
    process.stdout.write(
      `${await signInAs(handle, { environment: process.env })}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof HarnessRefusedError ? error.message : "Signing in failed"}\n`,
    );
    process.exitCode = 1;
  }
}
