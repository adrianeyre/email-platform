import { configDefaults, defineConfig } from "vitest/config";

const domTests = ["src/ui/**/*.test.{ts,tsx}"];

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify("test") },
  test: {
    env: {
      DATABASE_URL: "postgres://email_platform@localhost:54321/email_platform",
      APP_URL: "http://localhost:4320",
      ENCRYPTION_KEY: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
    },
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}"],
      thresholds: process.env.CI
        ? { statements: 88, branches: 70, functions: 80, lines: 88 }
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
