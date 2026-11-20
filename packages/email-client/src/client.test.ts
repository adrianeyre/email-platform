import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  builtInEmailNames,
  builtInEmailSlugs,
  createEmailClient,
  EmailApiError,
  EmailNetworkError,
  EmailTimeoutError,
  type BuiltInEmailName,
  type Message,
} from "./index.js";

const message: Message = {
  id: "0b6a3d4e-1f5c-4f6a-9d2e-7c1b8a9e0f12",
  createdAt: "2026-11-20T10:48:00.000Z",
  templateId: null,
  from: "noreply@example.com",
  to: ["ada@example.com"],
  cc: [],
  bcc: [],
  replyTo: null,
  subject: "Reset your password",
  status: "queued",
  providerMessageId: null,
  error: null,
  attempts: 0,
  sentAt: null,
};

const template = {
  id: "970c7d86-bcd6-4f7e-9e5a-896b774b622b",
  name: "Wizzaroo - Reset your password",
  slug: "wizzaroo-reset-your-password",
  subject: "Reset your password",
  html: "<p>{{resetUrl}}</p>",
  text: null,
  variables: ["email", "resetUrl", "linkLifetime"],
  sampleVariables: {},
  design: null,
  createdAt: "2026-11-20T10:48:00.000Z",
  updatedAt: "2026-11-20T10:48:00.000Z",
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const setUp = (response: Response = jsonResponse(202, message)) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
  const client = createEmailClient({
    baseUrl: "https://mail.example.com/",
    apiKey: "ek_test",
    fetch,
  });
  const sent = () => {
    const [url, init] = fetch.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    const body: unknown =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    return { url, method: init?.method, headers, body };
  };
  return { fetch, client, sent };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("createEmailClient", () => {
  it("refuses a missing API key", () => {
    expect(() =>
      createEmailClient({ baseUrl: "https://mail.example.com", apiKey: "" }),
    ).toThrow(TypeError);
    expect(() =>
      createEmailClient({
        baseUrl: "https://mail.example.com",
        apiKey: undefined,
      }),
    ).toThrow("API key");
  });
});

describe("send", () => {
  it("sends a template by name with the API key and variables", async () => {
    const { client, sent } = setUp();

    const result = await client.send({
      template: "Order shipped",
      to: "ada@example.com",
      variables: { orderId: "1042" },
    });

    expect(result).toEqual(message);
    const { url, method, headers, body } = sent();
    expect(url).toBe("https://mail.example.com/v1/messages");
    expect(method).toBe("POST");
    expect(headers.get("authorization")).toBe("Bearer ek_test");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.has("idempotency-key")).toBe(false);
    expect(body).toEqual({
      to: ["ada@example.com"],
      templateName: "Order shipped",
      variables: { orderId: "1042" },
    });
  });

  it("sends a template by ID when given a UUID", async () => {
    const { client, sent } = setUp();

    await client.send({
      template: "970C7D86-bcd6-4f7e-9e5a-896b774b622b",
      to: ["ada@example.com", "grace@example.com"],
    });

    expect(sent().body).toEqual({
      to: ["ada@example.com", "grace@example.com"],
      templateId: "970C7D86-bcd6-4f7e-9e5a-896b774b622b",
      variables: {},
    });
  });

  it("sends the Idempotency-Key header and every optional field", async () => {
    const { client, sent } = setUp(jsonResponse(200, message));

    await client.send({
      template: "Order shipped",
      to: "ada@example.com",
      cc: "boss@example.com",
      bcc: ["audit@example.com"],
      from: "Shop <shop@example.com>",
      replyTo: "help@example.com",
      idempotencyKey: "order-1042-shipped",
      attachments: [
        {
          filename: "hello.txt",
          contentType: "text/plain",
          content: new TextEncoder().encode("Hello, world"),
        },
        { filename: "buffer.bin", content: Buffer.from([0, 1, 254, 255]) },
        { filename: "already.txt", content: "SGk=" },
      ],
    });

    const { headers, body } = sent();
    expect(headers.get("idempotency-key")).toBe("order-1042-shipped");
    expect(body).toEqual({
      from: "Shop <shop@example.com>",
      to: ["ada@example.com"],
      cc: ["boss@example.com"],
      bcc: ["audit@example.com"],
      replyTo: "help@example.com",
      templateName: "Order shipped",
      variables: {},
      attachments: [
        {
          filename: "hello.txt",
          contentType: "text/plain",
          content: "SGVsbG8sIHdvcmxk",
        },
        { filename: "buffer.bin", content: "AAH+/w==" },
        { filename: "already.txt", content: "SGk=" },
      ],
    });
  });

  it("encodes a large attachment in chunks", async () => {
    const { client, sent } = setUp();
    const bytes = new Uint8Array(100_000).map((_, index) => index % 256);

    await client.send({
      template: "Order shipped",
      to: "ada@example.com",
      attachments: [{ filename: "big.bin", content: bytes }],
    });

    expect(sent().body).toMatchObject({
      attachments: [
        {
          filename: "big.bin",
          content: Buffer.from(bytes).toString("base64"),
        },
      ],
    });
  });

  it("uses defaultFrom unless a send gives its own", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => Promise.resolve(jsonResponse(202, message)));
    const client = createEmailClient({
      baseUrl: "https://mail.example.com",
      apiKey: "ek_test",
      fetch,
      defaultFrom: "noreply@example.com",
    });

    await client.send({ template: "A", to: "ada@example.com" });
    await client.send({
      template: "A",
      to: "ada@example.com",
      from: "other@example.com",
    });

    const bodies = fetch.mock.calls.map(([, init]): unknown =>
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    );
    expect(bodies).toMatchObject([
      { from: "noreply@example.com" },
      { from: "other@example.com" },
    ]);
  });

  it("checks built-in templates' variables at compile time", () => {
    const { client } = setUp();
    type SendOptions = Parameters<
      typeof client.send<"Wizzaroo - Reset your password">
    >[0];
    expectTypeOf<SendOptions["variables"]>().toEqualTypeOf<{
      email: string;
      resetUrl: string;
      linkLifetime: string;
    }>();
    if (Math.random() > 2) {
      void client.send({
        template: "Wizzaroo - Reset your password",
        to: "ada@example.com",
        // @ts-expect-error: resetUrl is missing
        variables: { email: "ada@example.com", linkLifetime: "1 hour" },
      });
      // @ts-expect-error: a built-in template needs its variables
      void client.send({
        template: "Wizzaroo - Password changed",
        to: "a@b.c",
      });
    }
  });
});

describe("sendBySlug", () => {
  it("sends a template by its slug", async () => {
    const { client, sent } = setUp();

    await client.sendBySlug({
      slug: "order-shipped",
      to: "ada@example.com",
      variables: { orderId: "1042" },
    });

    expect(sent().body).toEqual({
      to: ["ada@example.com"],
      templateSlug: "order-shipped",
      variables: { orderId: "1042" },
    });
  });

  it("checks built-in templates' variables by slug at compile time", () => {
    const { client } = setUp();
    type SendOptions = Parameters<
      typeof client.sendBySlug<"wizzaroo-reset-your-password">
    >[0];
    expectTypeOf<SendOptions["variables"]>().toEqualTypeOf<{
      email: string;
      resetUrl: string;
      linkLifetime: string;
    }>();
    if (Math.random() > 2) {
      void client.sendBySlug({
        slug: "wizzaroo-reset-your-password",
        to: "ada@example.com",
        // @ts-expect-error: resetUrl is missing
        variables: { email: "ada@example.com", linkLifetime: "1 hour" },
      });
    }
  });
});

describe("sendContent", () => {
  it("sends a subject with HTML and text", async () => {
    const { client, sent } = setUp();

    await client.sendContent({
      to: "ada@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    });

    expect(sent().body).toEqual({
      to: ["ada@example.com"],
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    });
  });
});

describe("builtIn", () => {
  it("sends the built-in template by its slug", async () => {
    const { client, sent } = setUp();

    await client.builtIn.resetYourPassword({
      to: "ada@example.com",
      variables: {
        email: "ada@example.com",
        resetUrl: "https://app.example.com/reset?token=abc",
        linkLifetime: "1 hour",
      },
      idempotencyKey: "reset-abc",
    });

    const { headers, body } = sent();
    expect(headers.get("idempotency-key")).toBe("reset-abc");
    expect(body).toEqual({
      to: ["ada@example.com"],
      templateSlug: "wizzaroo-reset-your-password",
      variables: {
        email: "ada@example.com",
        resetUrl: "https://app.example.com/reset?token=abc",
        linkLifetime: "1 hour",
      },
    });
  });

  it("has a helper for every built-in email", () => {
    const { client } = setUp();
    expect(Object.keys(client.builtIn).sort()).toEqual(
      Object.keys(builtInEmailNames).sort(),
    );
    expect(new Set(Object.values(builtInEmailNames)).size).toBe(15);
    expect(Object.keys(builtInEmailSlugs).sort()).toEqual(
      Object.keys(builtInEmailNames).sort(),
    );
    expect(new Set(Object.values(builtInEmailSlugs)).size).toBe(15);
    for (const slug of Object.values(builtInEmailSlugs)) {
      expect(slug).toMatch(/^[a-z0-9-]+$/u);
    }
    expectTypeOf<
      (typeof builtInEmailNames)[keyof typeof builtInEmailNames]
    >().toEqualTypeOf<BuiltInEmailName>();
  });
});

describe("reading", () => {
  it("reads a message", async () => {
    const { client, sent } = setUp(jsonResponse(200, message));

    expect(await client.getMessage(message.id)).toEqual(message);
    const { url, method, headers } = sent();
    expect(url).toBe(`https://mail.example.com/v1/messages/${message.id}`);
    expect(method).toBe("GET");
    expect(headers.has("content-type")).toBe(false);
  });

  it("lists templates and reads one", async () => {
    const list = setUp(jsonResponse(200, { templates: [template] }));
    expect(await list.client.listTemplates()).toEqual([template]);
    expect(list.sent().url).toBe("https://mail.example.com/v1/templates");

    const one = setUp(jsonResponse(200, template));
    expect(await one.client.getTemplate(template.id)).toEqual(template);
    expect(one.sent().url).toBe(
      `https://mail.example.com/v1/templates/${template.id}`,
    );
  });

  it("refuses an answer of the wrong shape", async () => {
    const { client } = setUp(jsonResponse(200, { templates: "nope" }));
    await expect(client.listTemplates()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});

describe("errors", () => {
  it("maps the app's error body to EmailApiError", async () => {
    const { client } = setUp(
      jsonResponse(422, {
        error: "validation_failed",
        message: "resetUrl is required",
        errors: [
          { field: "variables.resetUrl", message: "resetUrl is required" },
        ],
      }),
    );

    const error: unknown = await client
      .send({ template: "Anything", to: "ada@example.com" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EmailApiError);
    expect(error).toMatchObject({
      status: 422,
      code: "validation_failed",
      message: "resetUrl is required",
      fieldErrors: [
        { field: "variables.resetUrl", message: "resetUrl is required" },
      ],
    });
  });

  it("maps an answer that isn't JSON", async () => {
    const { client } = setUp(new Response("Bad gateway", { status: 502 }));

    await expect(client.getMessage("x")).rejects.toMatchObject({
      name: "EmailApiError",
      status: 502,
      code: "http_502",
      message: "The email app answered 502: Bad gateway",
      fieldErrors: [],
    });
  });

  it("wraps a network failure", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));
    const client = createEmailClient({
      baseUrl: "https://mail.example.com",
      apiKey: "ek_test",
      fetch,
    });

    const error: unknown = await client
      .getMessage("x")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EmailNetworkError);
    expect(error).not.toBeInstanceOf(EmailTimeoutError);
  });

  it("times out a slow answer and aborts the request", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((_, init) => {
        signal = init?.signal ?? undefined;
        return new Promise<never>(() => undefined);
      });
    const client = createEmailClient({
      baseUrl: "https://mail.example.com",
      apiKey: "ek_test",
      fetch,
      timeoutMs: 500,
    });

    const sending = client
      .send({ template: "A", to: "ada@example.com" })
      .catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(500);

    const error = await sending;
    expect(error).toBeInstanceOf(EmailTimeoutError);
    expect(error).toMatchObject({ timeoutMs: 500 });
    expect(signal?.aborted).toBe(true);
  });
});
