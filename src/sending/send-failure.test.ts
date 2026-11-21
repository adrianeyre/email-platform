import { describe, expect, it } from "vitest";
import {
  classifySendFailure,
  describeSendFailureForLog,
  SendSettingsError,
} from "./send-failure.js";

/** An error shaped as Nodemailer's SMTP connection makes them. */
const smtpError = (
  message: string,
  fields: {
    code: string;
    command: string;
    response?: string;
    responseCode?: number;
    originalCode?: string;
  },
) => Object.assign(new Error(message), fields);

const unreachable =
  "The SMTP provider could not be reached, or the connection to it failed (a name, network, TLS or timeout failure)";

describe("classifySendFailure", () => {
  it("tells a refusal after the greeting by its reply and status code, permanent for 5xx, never its text", () => {
    const reply =
      "550 5.7.1 Relay denied for 10.20.30.40 by smtp-7.internal.provider.example";
    expect(
      classifySendFailure(
        smtpError(`Mail command failed: ${reply}`, {
          code: "EENVELOPE",
          command: "MAIL FROM",
          response: reply,
          responseCode: 550,
        }),
      ),
    ).toEqual({
      kind: "refused",
      isPermanent: true,
      summary: "The SMTP provider refused it with reply 550 5.7.1 (permanent)",
    });
    expect(
      classifySendFailure(
        smtpError("Invalid login: 454 try later", {
          code: "EAUTH",
          command: "AUTH PLAIN",
          response: "454 try later",
          responseCode: 454,
        }),
      ),
    ).toEqual({
      kind: "refused",
      isPermanent: false,
      summary: "The SMTP provider refused it with reply 454 (temporary)",
    });
  });

  it("puts every failure before an SMTP session in one class, with no host, address or banner", () => {
    for (const error of [
      smtpError("connect ECONNREFUSED 172.20.0.2:5433", {
        code: "ESOCKET",
        command: "CONN",
        originalCode: "ECONNREFUSED",
      }),
      smtpError("getaddrinfo ENOTFOUND smtp.internal.invalid", {
        code: "EDNS",
        command: "CONN",
      }),
      smtpError("Greeting never received", {
        code: "ETIMEDOUT",
        command: "CONN",
      }),
      // A service that isn't SMTP, even one whose banner starts with a reply code.
      smtpError("Invalid greeting. response=554 not-smtp banner", {
        code: "EPROTOCOL",
        command: "CONN",
        response: "554 not-smtp banner",
        responseCode: 554,
      }),
      smtpError("Error upgrading connection with STARTTLS: 502 no", {
        code: "ETLS",
        command: "STARTTLS",
        response: "502 no",
        responseCode: 502,
      }),
    ]) {
      expect(classifySendFailure(error)).toEqual({
        kind: "unreachable",
        isPermanent: false,
        summary: unreachable,
      });
    }
  });

  it("tells the platform's own refusals as they are, and anything else generically", () => {
    expect(
      classifySendFailure(new SendSettingsError("No SMTP provider is set")),
    ).toEqual({
      kind: "settings",
      isPermanent: false,
      summary: "No SMTP provider is set",
    });
    expect(classifySendFailure(new Error("secret detail"))).toEqual({
      kind: "failed",
      isPermanent: false,
      summary: "The email could not be sent",
    });
    expect(classifySendFailure(undefined).kind).toBe("failed");
  });
});

describe("describeSendFailureForLog", () => {
  it("keeps the codes and the command, never the message or reply", () => {
    expect(
      describeSendFailureForLog(
        smtpError("Mail command failed: 550 <ada@example.com> unknown", {
          code: "EENVELOPE",
          command: "MAIL FROM",
          response: "550 <ada@example.com> unknown",
          responseCode: 550,
        }),
      ),
    ).toEqual({ code: "EENVELOPE", command: "MAIL FROM", responseCode: 550 });
  });
});
