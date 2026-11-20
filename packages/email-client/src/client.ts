import {
  builtInEmailNames,
  builtInEmailSlugs,
  type BuiltInEmailName,
  type BuiltInEmails,
  type BuiltInEmailsBySlug,
  type BuiltInEmailSlug,
} from "./built-in-emails.js";
import {
  EmailApiError,
  EmailNetworkError,
  EmailTimeoutError,
  type FieldError,
} from "./errors.js";

export interface EmailClientOptions {
  /** Where the email app runs, such as `https://mail.example.com`. */
  baseUrl: string;
  /** An API key from the app's **API keys** page, starting `ek_`. */
  apiKey: string | undefined;
  /** Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** How long each request may take before it fails with `EmailTimeoutError`. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Used when a send gives no `from`. Without either, the app uses the default from address in its Settings. */
  defaultFrom?: string;
}

/** One address or a list of them. */
export type Recipients = string | readonly string[];

export interface Attachment {
  filename: string;
  /** The bytes, or a string that is already base64. */
  content: Uint8Array | string;
  contentType?: string;
}

export interface CommonSendOptions {
  to: Recipients;
  cc?: Recipients;
  bcc?: Recipients;
  from?: string;
  replyTo?: string;
  attachments?: readonly Attachment[];
  /** A repeated key returns the first message instead of sending again, such as `order-1042-shipped`. */
  idempotencyKey?: string;
}

/** A built-in template's variables, checked at compile time, or any object for other templates. */
export type TemplateVariables<Template extends string> =
  Template extends BuiltInEmailName
    ? { variables: BuiltInEmails[Template] }
    : { variables?: Record<string, unknown> };

/** `template` is a template's exact name or its ID. */
export type SendTemplateOptions<Template extends string = string> =
  CommonSendOptions & { template: Template } & TemplateVariables<Template>;

/** A built-in template's variables by its slug, checked at compile time, or any object for other templates. */
export type SlugVariables<Slug extends string> = Slug extends BuiltInEmailSlug
  ? { variables: BuiltInEmailsBySlug[Slug] }
  : { variables?: Record<string, unknown> };

/** `slug` is a template's slug, such as `order-shipped`, sent as `templateSlug`. */
export type SendSlugOptions<Slug extends string = string> =
  CommonSendOptions & {
    slug: Slug;
  } & SlugVariables<Slug>;

export type SendContentOptions = CommonSendOptions & { subject: string } & (
    { html: string; text?: string } | { html?: string; text: string }
  );

export type BuiltInSendOptions<Name extends BuiltInEmailName> =
  CommonSendOptions & { variables: BuiltInEmails[Name] };

export type MessageStatus = "queued" | "sent" | "failed";

export interface Message {
  id: string;
  createdAt: string;
  templateId: string | null;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string | null;
  subject: string;
  status: MessageStatus;
  providerMessageId: string | null;
  error: string | null;
  attempts: number;
  sentAt: string | null;
}

export interface Template {
  id: string;
  name: string;
  /** What applications send it by as `templateSlug`, such as `order-shipped`. */
  slug: string;
  subject: string;
  html: string;
  text: string | null;
  variables: string[];
  sampleVariables: Record<string, unknown>;
  design: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export type BuiltInEmailSenders = {
  [Helper in keyof typeof builtInEmailSlugs]: (
    options: BuiltInSendOptions<(typeof builtInEmailNames)[Helper]>,
  ) => Promise<Message>;
};

export interface EmailClient {
  /** Sends a template by its exact name or its ID. Built-in templates' variables are checked at compile time. */
  send: <Template extends string>(
    options: SendTemplateOptions<Template>,
  ) => Promise<Message>;
  /** Sends a template by its slug, which stays the same when the template is renamed. Built-in templates' variables are checked at compile time. */
  sendBySlug: <Slug extends string>(
    options: SendSlugOptions<Slug>,
  ) => Promise<Message>;
  /** Sends a subject with HTML, text or both, without a template. */
  sendContent: (options: SendContentOptions) => Promise<Message>;
  /** One helper per built-in email, such as `builtIn.resetYourPassword({ to, variables })`. Each sends by the template's slug. */
  builtIn: BuiltInEmailSenders;
  getMessage: (id: string) => Promise<Message>;
  listTemplates: () => Promise<Template[]>;
  getTemplate: (id: string) => Promise<Template>;
}

const defaultTimeoutMs = 10_000;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isMessage = (value: unknown): value is Message =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.status === "string" &&
  Array.isArray(value.to);

const isTemplate = (value: unknown): value is Template =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.name === "string" &&
  typeof value.html === "string";

const isFieldError = (value: unknown): value is FieldError =>
  isRecord(value) &&
  typeof value.field === "string" &&
  typeof value.message === "string";

const toList = (recipients: Recipients | undefined): string[] | undefined =>
  recipients === undefined
    ? undefined
    : typeof recipients === "string"
      ? [recipients]
      : [...recipients];

const chunkSize = 0x8000;

const toBase64 = (content: Uint8Array | string): string => {
  if (typeof content === "string") {
    return content;
  }
  let binary = "";
  for (let start = 0; start < content.length; start += chunkSize) {
    binary += String.fromCharCode(
      ...content.subarray(start, start + chunkSize),
    );
  }
  return btoa(binary);
};

const readErrorBody = (status: number, text: string): EmailApiError => {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const fallback = `The email app answered ${String(status)}`;
  if (!isRecord(body)) {
    return new EmailApiError(
      status,
      `http_${String(status)}`,
      text.trim() === ""
        ? fallback
        : `${fallback}: ${text.trim().slice(0, 200)}`,
    );
  }
  const code =
    typeof body.error === "string"
      ? body.error
      : typeof body.code === "string"
        ? body.code
        : `http_${String(status)}`;
  const message =
    typeof body.message === "string" && body.message !== ""
      ? body.message
      : fallback;
  const fieldErrors = Array.isArray(body.errors)
    ? body.errors.filter(isFieldError)
    : [];
  return new EmailApiError(status, code, message, fieldErrors);
};

const expect = <T>(
  status: number,
  body: unknown,
  isExpected: (value: unknown) => value is T,
  what: string,
): T => {
  if (!isExpected(body)) {
    throw new EmailApiError(
      status,
      "invalid_response",
      `The email app's answer wasn't ${what}`,
    );
  }
  return body;
};

/** Creates a client for one email app. Throws at once when the API key is missing. */
export const createEmailClient = (options: EmailClientOptions): EmailClient => {
  const { apiKey, defaultFrom } = options;
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new TypeError("The email client needs an API key");
  }
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const fetchImpl: typeof globalThis.fetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  const request = async (
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; body: unknown }> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new EmailTimeoutError(timeoutMs));
      }, timeoutMs);
    });
    const exchange = async (): Promise<{ status: number; body: unknown }> => {
      let response: Response;
      let text: string;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, {
          method,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
            ...extraHeaders,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        });
        text = await response.text();
      } catch (error) {
        if (controller.signal.aborted) {
          throw new EmailTimeoutError(timeoutMs);
        }
        throw new EmailNetworkError(
          `Couldn't reach the email app at ${baseUrl}`,
          { cause: error },
        );
      }
      if (!response.ok) {
        throw readErrorBody(response.status, text);
      }
      try {
        return { status: response.status, body: JSON.parse(text) };
      } catch {
        throw new EmailApiError(
          response.status,
          "invalid_response",
          "The email app's answer wasn't JSON",
        );
      }
    };
    try {
      return await Promise.race([exchange(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };

  const postMessage = async (
    fields: Record<string, unknown>,
    common: CommonSendOptions,
  ): Promise<Message> => {
    const from = common.from ?? defaultFrom;
    const payload = {
      ...(from === undefined ? {} : { from }),
      to: toList(common.to),
      cc: toList(common.cc),
      bcc: toList(common.bcc),
      replyTo: common.replyTo,
      ...fields,
      attachments: common.attachments?.map(
        ({ filename, contentType, content }) => ({
          filename,
          ...(contentType === undefined ? {} : { contentType }),
          content: toBase64(content),
        }),
      ),
    };
    const { status, body } = await request(
      "POST",
      "/v1/messages",
      payload,
      common.idempotencyKey === undefined
        ? {}
        : { "Idempotency-Key": common.idempotencyKey },
    );
    return expect(status, body, isMessage, "a message");
  };

  const sendTemplate = (
    template: string,
    variables: object | undefined,
    common: CommonSendOptions,
  ): Promise<Message> =>
    postMessage(
      {
        ...(uuidPattern.test(template)
          ? { templateId: template }
          : { templateName: template }),
        variables: variables ?? {},
      },
      common,
    );

  const sendSlug = (
    slug: string,
    variables: object | undefined,
    common: CommonSendOptions,
  ): Promise<Message> =>
    postMessage({ templateSlug: slug, variables: variables ?? {} }, common);

  const builtInSender =
    <Helper extends keyof typeof builtInEmailSlugs>(helper: Helper) =>
    ({
      variables,
      ...common
    }: BuiltInSendOptions<
      (typeof builtInEmailNames)[Helper]
    >): Promise<Message> =>
      sendSlug(builtInEmailSlugs[helper], variables, common);

  return {
    send: ({ template, variables, ...common }) =>
      sendTemplate(template, variables, common),
    sendBySlug: ({ slug, variables, ...common }) =>
      sendSlug(slug, variables, common),
    sendContent: ({ subject, html, text, ...common }) =>
      postMessage({ subject, html, text }, common),
    builtIn: {
      confirmYourEmailAddress: builtInSender("confirmYourEmailAddress"),
      resetYourPassword: builtInSender("resetYourPassword"),
      teacherInvite: builtInSender("teacherInvite"),
      parentInvite: builtInSender("parentInvite"),
      passwordChanged: builtInSender("passwordChanged"),
      passkeyAdded: builtInSender("passkeyAdded"),
      passkeyRemoved: builtInSender("passkeyRemoved"),
      emailChangeRequested: builtInSender("emailChangeRequested"),
      emailAddressChanged: builtInSender("emailAddressChanged"),
      signInCodesPaused: builtInSender("signInCodesPaused"),
      familyDeviceSignedIn: builtInSender("familyDeviceSignedIn"),
      twoFactorTurnedOff: builtInSender("twoFactorTurnedOff"),
      emailAddressAlreadyInUse: builtInSender("emailAddressAlreadyInUse"),
      familyJoinRequest: builtInSender("familyJoinRequest"),
      adultJoinedFamily: builtInSender("adultJoinedFamily"),
    },
    getMessage: async (id) => {
      const { status, body } = await request(
        "GET",
        `/v1/messages/${encodeURIComponent(id)}`,
      );
      return expect(status, body, isMessage, "a message");
    },
    listTemplates: async () => {
      const { status, body } = await request("GET", "/v1/templates");
      const templates = isRecord(body) ? body.templates : undefined;
      if (!Array.isArray(templates) || !templates.every(isTemplate)) {
        throw new EmailApiError(
          status,
          "invalid_response",
          "The email app's answer wasn't a list of templates",
        );
      }
      return templates;
    },
    getTemplate: async (id) => {
      const { status, body } = await request(
        "GET",
        `/v1/templates/${encodeURIComponent(id)}`,
      );
      return expect(status, body, isTemplate, "a template");
    },
  };
};
