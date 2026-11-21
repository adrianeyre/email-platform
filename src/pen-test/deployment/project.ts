/** The pen-test deployment's names and addresses (pen test E1, #87), in one place for its scripts, tests and harness. */
export const penTestProjectName = "email-platform-pen-test";

/** The folder, at the root of the repo, holding the deployment's own secrets. Git ignores it; teardown deletes it. */
export const penTestStateDirectory = ".pen-test-deployment";

/** Published on 127.0.0.1 only. Production's is 4320, so the two never collide. */
export const penTestAppPort = 43320;
export const penTestMailPort = 43325;

export const penTestAppUrl = `http://localhost:${String(penTestAppPort)}`;
export const penTestMailUrl = `http://localhost:${String(penTestMailPort)}`;
