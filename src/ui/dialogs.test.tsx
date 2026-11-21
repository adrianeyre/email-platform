import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.js";
import { generatePassword } from "./password-field.js";

const responses: Record<string, unknown> = {
  "/app/me": { userId: "u1", email: "me@example.com" },
  "/app/templates": { templates: [] },
  "/app/templates/t1": {
    id: "t1",
    name: "Welcome",
    slug: "welcome",
    subject: "Hi {{name}}",
    html: "<p>Hi {{name}}</p>",
    text: null,
    variables: ["name"],
    sampleVariables: { name: "Ada" },
    configurationId: "c1",
    updatedAt: "2026-11-17T10:00:00Z",
  },
  "/app/templates/preview": { subject: "Hi", html: "<p>Hi</p>", text: "Hi" },
  "/app/headers": { headers: [] },
  "/app/footers": { footers: [] },
  "/app/footers/f1": {
    id: "f1",
    name: "Wizzaroo",
    html: "<p>Bye</p>",
    sampleVariables: {},
    usedBy: [
      { id: "t1", name: "Welcome" },
      { id: "t2", name: "Reset your password" },
    ],
  },
  "/app/configurations": {
    configurations: [
      {
        id: "c1",
        name: "Wizzaroo",
        fromEmail: "no-reply@wizzaroo.adrianeyre.co.uk",
        fromName: "Wizzaroo",
      },
    ],
  },
  "/app/configurations/c1": {
    id: "c1",
    name: "Wizzaroo",
    fromEmail: "no-reply@wizzaroo.adrianeyre.co.uk",
    fromName: "Wizzaroo",
    usedBy: [{ id: "t1", name: "Welcome" }],
  },
  "/app/api-keys": {
    apiKeys: [
      {
        id: "k1",
        name: "Shop",
        prefix: "ek_ab12",
        applicationId: "a1",
        applicationName: "Shop app",
        createdAt: "2026-11-01T09:00:00Z",
        lastUsedAt: null,
      },
    ],
  },
  "/app/applications": {
    applications: [
      {
        id: "a1",
        name: "Shop app",
        apiKeys: 1,
        createdAt: "2026-11-01T09:00:00Z",
      },
    ],
  },
  "/app/users": {
    users: [
      { id: "u1", email: "me@example.com", createdAt: "2026-11-01T09:00:00Z" },
      { id: "u2", email: "sam@example.com", createdAt: "2026-11-02T09:00:00Z" },
    ],
  },
};

let root: Root;
let host: HTMLDivElement;
let requests: { url: string; method: string; body: unknown }[];

const settle = async (ms = 30) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};

const renderAt = async (path: string) => {
  window.history.pushState(null, "", path);
  await act(async () => {
    root.render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
};

const button = (name: string): HTMLButtonElement => {
  const found = [...host.querySelectorAll("button")].find(
    (item) =>
      item.textContent.trim() === name ||
      item.getAttribute("aria-label") === name,
  );
  if (found === undefined) {
    throw new Error(`No button "${name}"`);
  }
  return found;
};

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
  await settle();
};

const dialog = (): HTMLDialogElement => {
  const open = host.querySelector<HTMLDialogElement>("dialog[open]");
  if (open === null) {
    throw new Error("No dialog is open");
  }
  return open;
};

/** Types into a React-controlled input the way a person would. */
const typeInto = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Reflect.set(HTMLInputElement.prototype, "value", value, input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
};

const inputLabelled = (text: string): HTMLInputElement => {
  const label = [...dialog().querySelectorAll("label")].find((item) =>
    item.textContent.startsWith(text),
  );
  const forId = label?.htmlFor ?? "";
  const input =
    label?.querySelector("input") ??
    (forId === ""
      ? null
      : dialog().querySelector<HTMLInputElement>(`[id="${forId}"]`));
  if (input === null) {
    throw new Error(`No input labelled ${text}`);
  }
  return input;
};

const deletes = () => requests.filter((request) => request.method === "DELETE");

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({
        url,
        method,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      const body = method === "GET" ? (responses[url] ?? {}) : {};
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: method === "POST" ? 201 : 200,
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

describe("delete dialogs", () => {
  it("show a template's details and what deleting it changes, and delete only when confirmed", async () => {
    await renderAt("/templates/t1");
    await click(button("Delete"));
    const text = dialog().textContent;
    expect(text).toContain("Delete this template?");
    expect(text).toContain("welcome");
    expect(text).toContain("t1");
    expect(text).toContain("Hi {{name}}");
    expect(text).toContain("Wizzaroo");
    expect(text).toContain("404 not found");
    expect(text).toContain("can't be undone");

    await click(button("Cancel"));
    expect(host.querySelector("dialog[open]")).toBeNull();
    expect(deletes()).toHaveLength(0);

    await click(button("Delete"));
    await click(button("Delete template"));
    expect(deletes().map((request) => request.url)).toEqual([
      "/app/templates/t1",
    ]);
  });

  it("list the templates a footer or configuration is used by", async () => {
    await renderAt("/footers/f1");
    await click(button("Delete"));
    expect(dialog().textContent).toContain("Delete this footer?");
    expect(dialog().textContent).toContain("2 templates");
    expect(
      [...dialog().querySelectorAll("li li")].map((item) => item.textContent),
    ).toEqual(["Welcome", "Reset your password"]);
    await click(button("Cancel"));

    await renderAt("/configurations/c1");
    await click(button("Delete"));
    expect(dialog().textContent).toContain(
      "Wizzaroo <no-reply@wizzaroo.adrianeyre.co.uk>",
    );
    expect(dialog().textContent).toContain("default from address in Delivery");
    await click(button("Delete configuration"));
    expect(deletes().map((request) => request.url)).toEqual([
      "/app/configurations/c1",
    ]);
  });

  it("say an API key's applications are refused, and delete that key", async () => {
    await renderAt("/api-keys");
    await click(button("Delete Shop"));
    expect(dialog().textContent).toContain("ek_ab12");
    expect(dialog().textContent).toContain("Never");
    expect(dialog().textContent).toContain("401 Unauthorized");
    await click(button("Delete API key"));
    expect(deletes().map((request) => request.url)).toEqual([
      "/app/api-keys/k1",
    ]);
  });

  it("make an API key for the application named, and rename an application in a dialog (ADR 0009)", async () => {
    await renderAt("/api-keys");
    expect(host.querySelector("tbody")?.textContent).toContain("Shop app");
    const pageInput = (text: string) => {
      const label = [...host.querySelectorAll("label")].find((item) =>
        item.textContent.startsWith(text),
      );
      const input =
        label?.querySelector("input") ??
        host.querySelector<HTMLInputElement>(`[id="${label?.htmlFor ?? ""}"]`);
      if (input === null) {
        throw new Error(`No input labelled ${text}`);
      }
      return input;
    };
    await typeInto(pageInput("Name"), "Till");
    await typeInto(pageInput("Application"), "Shop app");
    await typeInto(pageInput("Your current password"), "my-own-password");
    await click(button("Create API key"));
    expect(
      requests.find(
        (request) =>
          request.method === "POST" && request.url === "/app/api-keys",
      )?.body,
    ).toEqual({
      name: "Till",
      application: "Shop app",
      currentPassword: "my-own-password",
    });

    await click(button("Rename Shop app"));
    await typeInto(inputLabelled("Name"), "Shop");
    const rename = [...dialog().querySelectorAll("button")].find(
      (item) => item.textContent.trim() === "Rename",
    );
    if (rename === undefined) {
      throw new Error("No Rename button in the dialog");
    }
    await click(rename);
    expect(requests.find((request) => request.method === "PUT")?.body).toEqual({
      name: "Shop",
    });
    expect(requests.find((request) => request.method === "PUT")?.url).toBe(
      "/app/applications/a1",
    );

    await click(button("Delete Shop app"));
    expect(dialog().textContent).toContain("delete its keys first");
  });
});

describe("the API keys page", () => {
  it("creates a key only once your current password is given, and sends it", async () => {
    await renderAt("/api-keys");
    const field = (text: string): HTMLInputElement => {
      const label = [...host.querySelectorAll("label")].find((item) =>
        item.textContent.startsWith(text),
      );
      const input =
        label?.querySelector("input") ??
        host.querySelector<HTMLInputElement>(`[id="${label?.htmlFor ?? ""}"]`);
      if (input === null) {
        throw new Error(`No input labelled ${text}`);
      }
      return input;
    };
    await typeInto(field("Name"), "Shop 2");
    await typeInto(field("Application"), "Shop app");
    expect(button("Create API key").disabled).toBe(true);
    await typeInto(field("Your current password"), "my-own-password");
    expect(field("Your current password").type).toBe("password");
    expect(button("Create API key").disabled).toBe(false);
    await click(button("Create API key"));
    expect(requests.find((request) => request.method === "POST")).toEqual({
      url: "/app/api-keys",
      method: "POST",
      body: {
        name: "Shop 2",
        application: "Shop app",
        currentPassword: "my-own-password",
      },
    });
    expect(field("Your current password").value).toBe("");
  });
});

describe("the Users page", () => {
  it("removes another user from a dialog, never yourself", async () => {
    await renderAt("/users");
    expect(host.textContent).toContain("You");
    expect(() => button("Remove me@example.com")).toThrow();
    await click(button("Remove sam@example.com"));
    expect(dialog().textContent).toContain("signed out everywhere");
    expect(button("Remove user").disabled).toBe(true);
    await typeInto(inputLabelled("Your current password"), "my-own-password");
    expect(button("Remove user").disabled).toBe(false);
    await click(button("Remove user"));
    expect(deletes()).toEqual([
      {
        url: "/app/users/u2",
        method: "DELETE",
        body: { currentPassword: "my-own-password" },
      },
    ]);
    expect(host.textContent).toContain("sam@example.com was removed.");
  });

  it("adds a user only once the email and password are valid and your current password is given", async () => {
    await renderAt("/users");
    await click(button("Add user"));
    const add = () =>
      [...dialog().querySelectorAll("button")].find(
        (item) => item.textContent.trim() === "Add user",
      );
    expect(add()?.disabled).toBe(true);
    expect(document.activeElement).toBe(inputLabelled("Email"));

    await typeInto(inputLabelled("Email"), "kim@example.com");
    await typeInto(inputLabelled("Password"), "short");
    expect(add()?.disabled).toBe(true);
    expect(dialog().textContent).toContain("At least 12 characters, not yet");

    await click(button("Generate a strong password"));
    const password = inputLabelled("Password").value;
    expect(password).toHaveLength(20);
    expect(add()?.disabled).toBe(true);
    await typeInto(inputLabelled("Your current password"), "my-own-password");
    expect(inputLabelled("Your current password").autocomplete).toBe(
      "current-password",
    );
    expect(add()?.disabled).toBe(false);
    expect(inputLabelled("Password").type).toBe("password");
    await click(button("Show password"));
    expect(inputLabelled("Password").type).toBe("text");

    await act(async () => {
      add()?.click();
      await Promise.resolve();
    });
    await settle();
    expect(requests.find((request) => request.method === "POST")).toEqual({
      url: "/app/users",
      method: "POST",
      body: {
        email: "kim@example.com",
        password,
        currentPassword: "my-own-password",
      },
    });
    expect(host.querySelector("dialog[open]")).toBeNull();
    expect(host.textContent).toContain("kim@example.com was added");
  });

  it("changes your password once the new one is long enough, new and repeated", async () => {
    await renderAt("/users");
    await click(button("Change your password"));
    const change = () =>
      [...dialog().querySelectorAll("button")].find(
        (item) => item.textContent.trim() === "Change password",
      );
    await typeInto(inputLabelled("Current password"), "old-password-123");
    await typeInto(inputLabelled("New password"), "old-password-123");
    await typeInto(
      inputLabelled("Repeat the new password"),
      "old-password-123",
    );
    expect(dialog().textContent).toContain(
      "Different from your current password, not yet",
    );
    expect(change()?.disabled).toBe(true);

    await typeInto(inputLabelled("New password"), "brand-new-password-456");
    await typeInto(
      inputLabelled("Repeat the new password"),
      "brand-new-password-45",
    );
    expect(change()?.disabled).toBe(true);
    await typeInto(
      inputLabelled("Repeat the new password"),
      "brand-new-password-456",
    );
    expect(change()?.disabled).toBe(false);

    await act(async () => {
      change()?.click();
      await Promise.resolve();
    });
    await settle();
    expect(requests.find((request) => request.method === "PUT")).toEqual({
      url: "/app/me/password",
      method: "PUT",
      body: {
        currentPassword: "old-password-123",
        newPassword: "brand-new-password-456",
      },
    });
    expect(host.textContent).toContain("Your password was changed.");
  });
});

describe("generatePassword", () => {
  it("makes long passwords from letters and digits that can't be confused", () => {
    const passwords = Array.from({ length: 50 }, () => generatePassword());
    for (const password of passwords) {
      expect(password).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{20}$/u);
    }
    expect(new Set(passwords).size).toBe(50);
  });
});

describe("the Credits", () => {
  it("credit the creator first, then every library by group with its licence", async () => {
    await renderAt("/templates");
    await click(button("Credits"));
    const text = dialog().textContent;
    expect(text).toContain("Adrian Eyre");
    expect(text).toContain("Source code on GitHub");
    for (const name of ["React", "Simple Icons", "PostgreSQL", "Stageshow"]) {
      expect(text).toContain(name);
    }
    expect(text).toContain("CC0-1.0");
    expect(dialog().textContent).not.toContain("Read aloud");
    expect(
      dialog()
        .querySelector<HTMLAnchorElement>(".credits-creator a")
        ?.getAttribute("href"),
    ).toBe("https://github.com/adrianeyre/email-template");
  });
});
