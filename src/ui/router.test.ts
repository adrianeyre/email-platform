import { describe, expect, it } from "vitest";
import { findHandlebarsTokens } from "./handlebars-highlight.js";
import { buildQueryString } from "./query-string.js";
import { matchRoute } from "./router.js";

const templateId = "6d1f2c1e-2f7a-4f7e-9d2a-0c1d2e3f4a5b";

describe("matchRoute", () => {
  it.each([
    ["/", "templates", {}],
    ["/templates", "templates", {}],
    ["/templates/new", "newTemplate", {}],
    [`/templates/${templateId}`, "template", { templateId }],
    ["/configurations", "configurations", {}],
    ["/configurations/new", "newConfiguration", {}],
    [
      `/configurations/${templateId}`,
      "configuration",
      { configurationId: templateId },
    ],
    ["/logs", "logs", {}],
    ["/logs/abc", "message", { messageId: "abc" }],
    ["/api-keys", "apiKeys", {}],
    ["/users", "users", {}],
    ["/settings", "settings", {}],
  ])("matches %s to the %s page", (pathname, name, params) => {
    expect(matchRoute(pathname)).toEqual({ name, params });
  });

  it("decodes encoded segments", () => {
    expect(matchRoute("/logs/a%20b").params.messageId).toBe("a b");
  });

  it("reports unknown paths as not found", () => {
    expect(matchRoute("/workspaces/1/sandbox").name).toBe("notFound");
  });
});

describe("buildQueryString", () => {
  it("leaves out empty values and keeps the rest", () => {
    expect(
      buildQueryString({
        search: " a@example.com ",
        status: "",
        page: 2,
        before: undefined,
      }),
    ).toBe("?search=a%40example.com&page=2");
  });

  it("is empty when nothing is set", () => {
    expect(buildQueryString({ search: "" })).toBe("");
  });
});

describe("findHandlebarsTokens", () => {
  it("finds variables and blocks", () => {
    expect(
      findHandlebarsTokens("<p>{{name}}</p>{{#if vip}}VIP{{/if}}{{{raw}}}"),
    ).toEqual(["{{name}}", "{{#if vip}}", "{{/if}}", "{{{raw}}}"]);
  });
});
