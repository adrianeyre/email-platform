import { renderDesignHtml } from "./design/render-html.js";
import Handlebars from "handlebars";
import { describe, expect, it } from "vitest";
import {
  builtInConfiguration,
  builtInEmails,
  builtInParts,
  toPartBody,
  toTemplateBody,
} from "./built-in-emails.js";
import {
  builtInEmailNames,
  builtInEmailSlugs,
} from "../../packages/email-client/src/built-in-emails.js";
import { parseDesign } from "./design/model.js";
import { checkRequiredVariables, renderTemplate } from "./render.js";

/** Every {{name}} a template uses, ignoring helpers such as {{#if}} and {{/if}}. */
const usedVariables = (source: string): Set<string> => {
  const names = new Set<string>();
  const visit = (node: unknown) => {
    if (typeof node !== "object" || node === null) {
      return;
    }
    if (
      "type" in node &&
      node.type === "PathExpression" &&
      "original" in node &&
      typeof node.original === "string"
    ) {
      names.add(node.original);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else {
        visit(value);
      }
    }
  };
  visit(Handlebars.parse(source));
  names.delete("if");
  return names;
};

describe("the built-in emails", () => {
  it("are the fifteen emails from the guide, with unique names starting Wizzaroo - ", () => {
    expect(builtInEmails).toHaveLength(15);
    expect(new Set(builtInEmails.map((email) => email.name)).size).toBe(15);
    for (const email of builtInEmails) {
      expect(email.name).toBe(`Wizzaroo - ${email.previousName}`);
      expect(email.headerName).toBe("Wizzaroo");
      expect(email.footerName).toBe("Wizzaroo");
      expect(email.configurationName).toBe(builtInConfiguration.name);
    }
  });

  it("are sent from Wizzaroo's no-reply address by the built-in configuration", () => {
    expect(builtInConfiguration).toEqual({
      name: "Wizzaroo",
      fromEmail: "no-reply@wizzaroo.adrianeyre.co.uk",
      fromName: "Wizzaroo",
    });
    const [email] = builtInEmails;
    if (email === undefined) {
      throw new Error("missing the built-in emails");
    }
    expect(toTemplateBody(email, { configurationId: "c1" })).toMatchObject({
      configurationId: "c1",
    });
    expect(toTemplateBody(email).configurationId).toBeNull();
  });

  it("each has a stable slug that applications can send by", () => {
    expect(builtInEmails.map((email) => email.slug)).toEqual([
      "wizzaroo-confirm-your-email-address",
      "wizzaroo-reset-your-password",
      "wizzaroo-teacher-invite",
      "wizzaroo-parent-invite",
      "wizzaroo-password-changed",
      "wizzaroo-passkey-added",
      "wizzaroo-passkey-removed",
      "wizzaroo-email-change-requested",
      "wizzaroo-email-address-changed",
      "wizzaroo-sign-in-codes-paused",
      "wizzaroo-family-device-signed-in",
      "wizzaroo-two-factor-turned-off",
      "wizzaroo-email-address-already-in-use",
      "wizzaroo-family-join-request",
      "wizzaroo-adult-joined-family",
    ]);
    for (const email of builtInEmails) {
      expect(toTemplateBody(email).slug).toBe(email.slug);
    }
  });

  it("match the email client's names and slugs", () => {
    const names: Record<string, string> = builtInEmailNames;
    const slugs: Record<string, string> = builtInEmailSlugs;
    const helpers = Object.keys(names).filter((helper) => helper in slugs);
    expect(helpers).toHaveLength(builtInEmails.length);
    expect(helpers.map((helper) => [names[helper], slugs[helper]])).toEqual(
      builtInEmails.map((email) => [email.name, email.slug]),
    );
  });

  it("has a Wizzaroo header carrying the logo's SVG code, and a footer", () => {
    const header = builtInParts.find((part) => part.kind === "header");
    const footer = builtInParts.find((part) => part.kind === "footer");
    if (header === undefined) {
      throw new Error("missing the Wizzaroo header");
    }
    expect(header.name).toBe("Wizzaroo");
    expect(toPartBody(header).html).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50" viewBox="0 0 273 68" role="img" aria-label="Wizzaroo">',
    );
    expect(footer?.name).toBe("Wizzaroo");
    const socials = footer?.design.blocks.find(
      (block) => block.type === "social",
    );
    expect(
      socials?.type === "social"
        ? socials.links.map(({ network, url }) => [network, url])
        : [],
    ).toEqual([
      ["website", "https://adrianeyre.co.uk"],
      ["linkedin", "https://www.linkedin.com/in/adrianeyre"],
      ["facebook", "https://facebook.com/adrianeyre"],
    ]);
    const footerHtml =
      footer === undefined ? "" : renderDesignHtml(footer.design);
    expect(footerHtml).toContain(
      'href="https://www.linkedin.com/in/adrianeyre"',
    );
    expect(footerHtml.match(/<svg /gu)).toHaveLength(3);
  });

  it.each(builtInEmails.map((email) => [email.name, email] as const))(
    "%s renders with its sample variables and uses exactly its variables",
    (_name, email) => {
      const body = toTemplateBody(email);
      expect(
        checkRequiredVariables(body.variables, email.sampleVariables),
      ).toEqual([]);
      const rendered = renderTemplate(body, email.sampleVariables);
      expect(rendered.html).not.toMatch(/\{\{|\}\}/u);
      expect(rendered.text).toContain("Wizzaroo");
      expect(rendered.text).toContain(String(email.sampleVariables.email));
      const used = new Set([
        ...usedVariables(body.html),
        ...usedVariables(body.subject),
      ]);
      expect([...used].toSorted()).toEqual(
        Object.keys(email.sampleVariables).toSorted(),
      );
      expect(parseDesign(JSON.parse(JSON.stringify(body.design)))).toEqual(
        email.design,
      );
    },
  );

  it("escapes what people typed, such as a passkey name", () => {
    const email = builtInEmails.find(
      (item) => item.name === "Wizzaroo - Passkey added",
    );
    if (email === undefined) {
      throw new Error("missing Passkey added");
    }
    const rendered = renderTemplate(toTemplateBody(email), {
      ...email.sampleVariables,
      passkeyName: "<script>x</script>",
      isFromQrCode: true,
    });
    expect(rendered.html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(rendered.html).toContain("from a QR code scanned on another device");
  });
});
