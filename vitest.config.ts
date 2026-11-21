import { configDefaults, defineConfig } from "vitest/config";

const domTests = ["src/ui/**/*.test.{ts,tsx}"];

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify("test") },
  test: {
    env: {
      DATABASE_URL: "postgres://email_platform@localhost:54321/email_platform",
      APP_URL: "http://localhost:4320",
      // The tests' own key, never a deployment's. `.env.example` has none, so nothing starts with a key from the
      // repository by accident (#165).
      ENCRYPTION_KEY: "u/6gNyElaXyJFT8JxzvbOO+BrNBW3HIajntRKpjGntk=",
    },
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}"],
      // Applied when CI is set, as it is in .github/workflows/checks.yml.
      // The floor of the coverage when pull requests were first checked
      // (21 Nov 2026: 81.9% statements, 76.7% branches, 76.5% functions,
      // 81.7% lines); raise it as coverage rises, never lower it.
      thresholds: process.env.CI
        ? { statements: 81, branches: 76, functions: 76, lines: 81 }
        : undefined,
    },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: [
            "src/**/*.test.{ts,tsx}",
            "release/**/*.test.ts",
            "site/**/*.test.ts",
          ],
          exclude: [...configDefaults.exclude, ...domTests],
          environment: "node",
          testTimeout: 30_000,
          hookTimeout: 300_000,
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          include: domTests,
          environment: "happy-dom",
          environmentOptions: {
            happyDOM: {
              // Template previews link Google Fonts; the tests never fetch them.
              settings: { handleDisabledFileLoadingAsSuccess: true },
            },
          },
        },
      },
    ],
  },
});
