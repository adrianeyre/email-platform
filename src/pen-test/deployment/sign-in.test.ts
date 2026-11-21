import { execFile } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  fixtureUsers,
  liveApiKeyHandles,
  userHandles,
} from "../fixtures/fixture-plan.js";
import {
  hasContainerRuntime,
  startProbeWorld,
  warnIfSkipped,
  type ProbeWorld,
} from "../probes/probe-world.js";
import {
  credentialVariableName,
  HarnessRefusedError,
  readHandle,
  signInAs,
} from "./sign-in.js";
import { renderCredentialsPackage } from "./pen-test-deployment.js";

const secretLookingValue = "hunter2-a-password-on-the-command-line";

/** Runs the harness as a command, asynchronously, so the API it calls in this same process can answer. */
const runHarness = (
  args: string[],
  environment: NodeJS.ProcessEnv = {},
): Promise<{ status: number; stdout: string; stderr: string }> =>
  new Promise((resolveRun) => {
    execFile(
      "node_modules/.bin/tsx",
      ["src/pen-test/deployment/sign-in.ts", ...args],
      { encoding: "utf8", env: { PATH: process.env.PATH, ...environment } },
      (error, stdout, stderr) => {
        const code: unknown = error === null ? 0 : Reflect.get(error, "code");
        resolveRun({
          status: typeof code === "number" ? code : 1,
          stdout,
          stderr,
        });
      },
    );
  });

describe("the sign-in harness's arguments (E4, #90)", () => {
  it.each([
    [["--password", secretLookingValue]],
    [["victim", "--password", secretLookingValue]],
    [[`--password=${secretLookingValue}`]],
    [["victim", secretLookingValue]],
    [["-p", secretLookingValue]],
    [[]],
    [["someone-else"]],
  ])("refuses %j without repeating it", (args) => {
    let refusal: unknown;
    try {
      readHandle(args);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(HarnessRefusedError);
    expect(String(refusal)).not.toContain(secretLookingValue);
  });

  it("takes exactly one fixture handle", () => {
    expect(readHandle(["victim"])).toBe("victim");
    expect(readHandle(["secondApp"])).toBe("secondApp");
  });

  it("refuses a credential passed as a flag when run, without echoing it", async () => {
    const run = await runHarness(["victim", "--password", secretLookingValue]);
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("never from the command line");
    expect(run.stderr).not.toContain(secretLookingValue);
  });

  it("refuses to sign in when the credential isn't in the environment", async () => {
    await expect(
      signInAs("victim", { environment: {}, baseUrl: "http://127.0.0.1:9" }),
    ).rejects.toThrow("PEN_TEST_PASSWORD_VICTIM is not set");
    await expect(signInAs("wizzaroo", { environment: {} })).rejects.toThrow(
      "PEN_TEST_API_KEY_WIZZAROO is not set",
    );
  });

  it("names every credential in the package the way the harness reads it", () => {
    const content = renderCredentialsPackage(
      "a synthetic seed of at least thirty-two characters",
    );
    for (const handle of userHandles) {
      expect(content).toContain(`${credentialVariableName("user", handle)}=`);
    }
    for (const handle of [...liveApiKeyHandles, "deleted"]) {
      expect(content).toContain(`${credentialVariableName("key", handle)}=`);
    }
    expect(content).toContain("PEN_TEST_URL=http://localhost:43320");
  });
});

warnIfSkipped("src/pen-test/deployment/sign-in.test.ts");

describe.skipIf(!hasContainerRuntime)(
  "the sign-in harness against a real API and Postgres (E4, #90)",
  () => {
    let world: ProbeWorld;
    let baseUrl: string;
    let environment: NodeJS.ProcessEnv;

    beforeAll(async () => {
      world = await startProbeWorld({ hasMailpit: false });
      await world.server.listen({ host: "127.0.0.1", port: 0 });
      const address = world.server.server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      baseUrl = `http://127.0.0.1:${String(port)}`;
      environment = Object.fromEntries(
        renderCredentialsPackage(world.seed)
          .split("\n")
          .filter((line) => /^[A-Z_]+=/u.test(line))
          .map((line) => {
            const at = line.indexOf("=");
            return [line.slice(0, at), line.slice(at + 1)];
          }),
      );
      environment.PEN_TEST_URL = baseUrl;
    }, 300_000);

    afterAll(async () => {
      await world.stop();
    });

    it.each(userHandles)("signs in as the fixture User %s", async (handle) => {
      const header = await signInAs(handle, { environment });
      const [name, value] = header.split(": ");
      const me = await fetch(`${baseUrl}/app/me`, {
        headers: { [name ?? ""]: value ?? "" },
      });
      expect(header).toMatch(/^Cookie: session=/u);
      expect(await me.json()).toEqual({
        userId: fixtureUsers[handle].id,
        email: fixtureUsers[handle].email,
      });
    });

    it.each(liveApiKeyHandles)(
      "authenticates with the live fixture key %s",
      async (handle) => {
        const header = await signInAs(handle, { environment });
        const [name, value] = header.split(": ");
        const response = await fetch(`${baseUrl}/v1/templates`, {
          headers: { [name ?? ""]: value ?? "" },
        });
        expect(header).toMatch(/^Authorization: Bearer ek_7e5700000000000/u);
        expect(response.status).toBe(200);
      },
    );

    it("hands over the deleted key, which the API refuses", async () => {
      const header = await signInAs("deleted", { environment });
      const [name, value] = header.split(": ");
      const response = await fetch(`${baseUrl}/v1/templates`, {
        headers: { [name ?? ""]: value ?? "" },
      });
      expect(response.status).toBe(401);
    });

    it("signs in when run as a command, with the credentials in its environment", async () => {
      const run = await runHarness(["colleague"], environment);
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toMatch(/^Cookie: session=[\w-]+\n$/u);
    });
  },
);
