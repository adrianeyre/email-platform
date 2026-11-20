import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { builtInEmails } from "../templates/built-in-emails.js";
import { App } from "./app.js";

const designed = builtInEmails[0];

const responses: Record<string, { status: number; body: unknown }> = {
  "/app/me": { status: 200, body: { userId: "u1", email: "me@example.com" } },
  "/app/templates": {
    status: 200,
    body: {
      templates: [
        {
          id: "t1",
          name: "Welcome",
          slug: "welcome",
          subject: "Hi",
          updatedAt: "2026-11-17T10:00:00Z",
        },
      ],
    },
  },
  "/app/templates/t1": {
    status: 200,
    body: {
      id: "t1",
      name: "Welcome",
      slug: "welcome",
      subject: "Hi {{name}}",
      html: "<p>Hi {{name}}</p>",
      text: null,
      variables: ["name"],
      sampleVariables: { name: "Ada" },
      configurationId: "c1",
    },
  },
  "/app/templates/t2": {
    status: 200,
    body: {
      id: "t2",
      name: designed?.name,
      slug: designed?.slug,
      subject: designed?.subject,
      html: "<p>made by the designer</p>",
      text: null,
      variables: designed?.variables,
      sampleVariables: designed?.sampleVariables,
      design: designed?.design,
    },
  },
  "/app/configurations": {
    status: 200,
    body: {
      configurations: [
        {
          id: "c1",
          name: "Wizzaroo",
          fromEmail: "no-reply@wizzaroo.adrianeyre.co.uk",
          fromName: "Wizzaroo",
          updatedAt: "2026-11-17T10:00:00Z",
        },
      ],
    },
  },
  "/app/configurations/c1": {
    status: 200,
    body: {
      id: "c1",
      name: "Wizzaroo",
      fromEmail: "no-reply@wizzaroo.adrianeyre.co.uk",
      fromName: "Wizzaroo",
      usedBy: [{ id: "t1", name: "Welcome" }],
    },
  },
  "/app/templates/preview": {
    status: 200,
    body: { subject: "Hi Ada", html: "<p>Hi Ada</p>", text: "Hi Ada" },
  },
  "/app/messages": {
    status: 200,
    body: {
      messages: [
        {
          id: "m1",
          createdAt: "2026-11-17T10:00:00Z",
          to: ["ada@example.com"],
          subject: "Hi Ada",
          status: "failed",
        },
      ],
      page: 1,
      pageSize: 50,
      total: 1,
    },
  },
  "/app/messages/m1": {
    status: 200,
    body: {
      id: "m1",
      subject: "Hi Ada",
      status: "failed",
      error: "connect ECONNREFUSED",
      to: ["ada@example.com"],
      html: "<p>Hi Ada</p>",
      text: "Hi Ada",
    },
  },
  "/app/api-keys": { status: 200, body: { apiKeys: [] } },
  "/app/headers": {
    status: 200,
    body: {
      headers: [
        { id: "h1", name: "Wizzaroo", updatedAt: "2026-11-20T10:00:00Z" },
      ],
    },
  },
  "/app/footers": { status: 200, body: { footers: [] } },
  "/app/users": {
    status: 200,
    body: { users: [{ id: "u1", email: "me@example.com" }] },
  },
  "/app/settings": {
    status: 200,
    body: {
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpSecure: false,
      smtpUsername: "user",
      hasSmtpPassword: true,
      defaultFrom: "App <app@example.com>",
      logRetentionDays: 90,
    },
  },
};

let root: Root;
let host: HTMLDivElement;

const renderAt = async (path: string) => {
  window.history.pushState(null, "", path);
  await act(async () => {
    root.render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return host.textContent;
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      const response = responses[input] ?? { status: 404, body: {} };
      return Promise.resolve(
        new Response(JSON.stringify(response.body), {
          status: response.status,
        }),
      );
    }),
  );
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
});

describe("the app", () => {
  it("asks for a sign-in when there is no session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ message: "Sign in first" }), {
            status: 401,
          }),
        ),
      ),
    );
    expect(await renderAt("/")).toContain("Sign in");
  });

  it.each([
    ["/", "Welcome"],
    ["/templates", "welcome"],
    ["/templates/t1", "Required variables"],
    ["/templates/new", "Start from a built-in email"],
    ["/headers", "Wizzaroo"],
    ["/footers", "No footers yet."],
    ["/footers/new", "Write HTML by hand"],
    ["/configurations", "Wizzaroo <no-reply@wizzaroo.adrianeyre.co.uk>"],
    ["/configurations/c1", "Used by"],
    ["/configurations/new", "From email address"],
    ["/templates/t2", "Add blocks"],
    ["/logs", "ada@example.com"],
    ["/logs/m1", "connect ECONNREFUSED"],
    ["/api-keys", "No API keys yet."],
    ["/users", "Change your password"],
    ["/delivery", "A password is saved"],
    ["/settings", "Every theme meets WCAG 2.2 AA contrast"],
    ["/nowhere", "This page does not exist."],
  ])("renders %s", async (path, expected) => {
    const text = await renderAt(path);
    expect(text).toContain("me@example.com");
    expect(text).toContain(expected);
  });

  it.each([
    ["/logs", "Email Template - Logs"],
    ["/templates", "Email Template - Templates"],
  ])(
    "titles the browser tab for %s with the prefix first",
    async (path, title) => {
      await renderAt(path);
      expect(document.title).toBe(title);
    },
  );

  it("titles the sign-in page with the prefix first", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ message: "Sign in first" }), {
            status: 401,
          }),
        ),
      ),
    );
    await renderAt("/");
    expect(document.title).toBe("Email Template - Sign in");
  });

  it("previews a template in light by default, and in dark on request", async () => {
    await renderAt("/templates/t1");
    const button = (name: string) =>
      [...host.querySelectorAll("button")].find(
        (item) => item.textContent.trim() === name,
      );
    await act(async () => {
      button("Preview")?.click();
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    const frame = () =>
      host.querySelector<HTMLIFrameElement>("iframe.preview-frame");
    expect(button("Light")?.getAttribute("aria-checked")).toBe("true");
    expect(frame()?.getAttribute("srcdoc")).toBe("<p>Hi Ada</p>");

    await act(async () => {
      button("Dark")?.click();
      await Promise.resolve();
    });
    expect(button("Dark")?.getAttribute("aria-checked")).toBe("true");
    expect(frame()?.className).toContain("preview-dark");
    expect(frame()?.getAttribute("srcdoc")).toContain(
      "<style data-preview-scheme>",
    );
    expect(frame()?.getAttribute("srcdoc")).toContain("<p>Hi Ada</p>");
  });

  it("shows a template's slug, and explains one that breaks the rule", async () => {
    const text = await renderAt("/templates/t1");
    expect(text).toContain("Applications can send by this as templateSlug.");
    const slug = [...host.querySelectorAll("label")]
      .find((label) => label.textContent.startsWith("Slug"))
      ?.querySelector("input");
    if (slug === null || slug === undefined) {
      throw new Error("missing the Slug field");
    }
    expect(slug.value).toBe("welcome");
    expect(slug.getAttribute("aria-invalid")).toBeNull();

    await act(async () => {
      Reflect.set(HTMLInputElement.prototype, "value", "Hello World", slug);
      slug.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    expect(slug.value).toBe("hello world");
    expect(slug.getAttribute("aria-invalid")).toBe("true");
    const errorId = slug.getAttribute("aria-describedby")?.split(" ").at(-1);
    expect(
      host.querySelector(`[id="${errorId ?? ""}"]`)?.textContent,
    ).toContain("lowercase letters, numbers and hyphens");
  });

  it("links Configuration in the side menu, and shows a template's configuration with its from address", async () => {
    const text = await renderAt("/templates/t1");
    const link = [...host.querySelectorAll("nav a")].find(
      (item) => item.textContent === "Configuration",
    );
    expect(link?.getAttribute("href")).toBe("/configurations");
    const select = [...host.querySelectorAll("label")]
      .find((label) => label.textContent.startsWith("Configuration"))
      ?.querySelector("select");
    expect(select?.value).toBe("c1");
    expect(text).toContain(
      "Sends from Wizzaroo <no-reply@wizzaroo.adrianeyre.co.uk> unless the request gives a from address.",
    );
  });
});
