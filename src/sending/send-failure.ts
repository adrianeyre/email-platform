/**
 * What a failed send is told as, wherever it is shown: a Message's `error` (read on `/v1` and in the Logs) and the
 * Delivery page's test send. It comes from a closed set and never carries the provider's reply text or Node's network
 * error, which name the provider's internal hosts, addresses and accounts and the SMTP host and port (pen test I1,
 * #173), and which made the test send a port scanner and banner grabber (pen test I5, #184):
 *
 * - **refused**: an SMTP server took the connection and refused a command after its greeting (AUTH, MAIL, RCPT,
 *   DATA). Told with its reply code and RFC 3463 status code, which name the reason without free text, and whether it
 *   is permanent (5xx) or temporary (4xx).
 * - **unreachable**: no SMTP session was reached. A closed port, a name that won't resolve, a timeout, a failed TLS
 *   handshake and a service that answers with something other than an SMTP greeting are one class, so none of them
 *   tells a User which hosts and ports answer, or how.
 * - **settings**: the platform's own refusal (no provider set, an unreadable password), told as it is.
 * - **failed**: anything else, told generically.
 */
export interface SendFailure {
  kind: "refused" | "unreachable" | "settings" | "failed";
  isPermanent: boolean;
  summary: string;
}

/** A refusal the platform makes itself, whose message names no host, address or reply. */
export class SendSettingsError extends Error {
  override name = "SendSettingsError";
}

/** Nodemailer's codes for a connection that never became an SMTP session. */
const connectionCodes = new Set([
  "ECONNECTION",
  "ESOCKET",
  "ETIMEDOUT",
  "EDNS",
  "ETLS",
  "EPROTOCOL",
]);

/** The commands Nodemailer names for a failure before the session was ready: the greeting, EHLO and STARTTLS. */
const sessionCommands = new Set(["CONN", "EHLO", "HELO", "LHLO", "STARTTLS"]);

const readField = (error: unknown, key: string): unknown =>
  typeof error === "object" && error !== null
    ? Reflect.get(error, key)
    : undefined;

const unreachable: SendFailure = {
  kind: "unreachable",
  isPermanent: false,
  summary:
    "The SMTP provider could not be reached, or the connection to it failed (a name, network, TLS or timeout failure)",
};

export const classifySendFailure = (error: unknown): SendFailure => {
  if (error instanceof SendSettingsError) {
    return { kind: "settings", isPermanent: false, summary: error.message };
  }
  const code = readField(error, "code");
  const command = readField(error, "command");
  const responseCode = readField(error, "responseCode");
  const isInSession =
    typeof command === "string" && !sessionCommands.has(command);
  if (
    isInSession &&
    typeof responseCode === "number" &&
    responseCode >= 400 &&
    responseCode < 600
  ) {
    const isPermanent = responseCode >= 500;
    const response = readField(error, "response");
    const status =
      typeof response === "string"
        ? /^\d{3}[ -]([245]\.\d{1,3}\.\d{1,3})\b/u.exec(response)?.[1]
        : undefined;
    return {
      kind: "refused",
      isPermanent,
      summary: `The SMTP provider refused it with reply ${String(responseCode)}${status === undefined ? "" : ` ${status}`} (${isPermanent ? "permanent" : "temporary"})`,
    };
  }
  if (
    (typeof code === "string" && connectionCodes.has(code)) ||
    (typeof command === "string" && sessionCommands.has(command))
  ) {
    return unreachable;
  }
  return {
    kind: "failed",
    isPermanent: false,
    summary: "The email could not be sent",
  };
};

/**
 * What the server's own log keeps of a failed send: Nodemailer's code, the command and the reply code, never a text,
 * since a reply can quote a recipient's address and the log sits outside Retention (pen test D2, #126).
 */
export const describeSendFailureForLog = (
  error: unknown,
): Record<string, unknown> => {
  const fields = ["code", "originalCode", "command", "responseCode"] as const;
  return Object.fromEntries(
    fields.flatMap((field) => {
      const value = readField(error, field);
      return typeof value === "string" || typeof value === "number"
        ? [[field, value]]
        : [];
    }),
  );
};
