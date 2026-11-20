/**
 * The built-in emails: Wizzaroo's account, invite and security emails, as visual designs that open in the designer.
 * Each one keeps the wording of the original. What changes per send, such as addresses, links and pre-formatted dates,
 * is a Handlebars variable. Add them from the "Start from a built-in email" gallery or `pnpm cli templates:add-built-ins`.
 */
import {
  createButtonBlock,
  createHtmlBlock,
  createDesign,
  createDividerBlock,
  createSocialBlock,
  createTextBlock,
  spacing,
  type Block,
  type Design,
  type SocialBlock,
  type TextBlock,
} from "./design/model.js";
import { renderDesignHtml } from "./design/render-html.js";
import { wizzarooLogoSvg } from "./assets/wizzaroo-logo.js";
import { slugify } from "./slug.js";

export type BuiltInCategory =
  "Links" | "Invites" | "Security notices" | "Other notes";

export const builtInNamePrefix = "Wizzaroo - ";

export interface BuiltInEmail {
  /** The Template's name, such as "Wizzaroo - Reset your password". */
  name: string;
  /** What applications send it by as templateSlug, such as "wizzaroo-reset-your-password". It never changes. */
  slug: string;
  /** Its name before the "Wizzaroo - " prefix, so an older copy can be renamed. */
  previousName: string;
  /** The names of the built-in Header, Footer and Configuration it is sent with. */
  headerName: string;
  footerName: string;
  configurationName: string;
  category: BuiltInCategory;
  description: string;
  subject: string;
  variables: string[];
  sampleVariables: Record<string, unknown>;
  design: Design;
}

const colours = {
  ground: "#eff6ff",
  card: "#ffffff",
  border: "#dbe5fb",
  ink: "#0f172a",
  body: "#334155",
  muted: "#475569",
  primary: "#2563eb",
  wordmark: "#1c2f8c",
  panel: "#f8fafc",
  panelBorder: "#e2e8f0",
  calloutGround: "#fffbeb",
  calloutBorder: "#f59e0b",
  calloutInk: "#78350f",
} as const;

const fontStack =
  "Nunito, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const sideSpace = 40;

const text = (html: string, top = 0, bottom = 16): TextBlock => ({
  ...createTextBlock(html),
  padding: { top, right: sideSpace, bottom, left: sideSpace },
});

const styled = (style: string, inner: string) =>
  `<span style="${style}">${inner}</span>`;

const securityLabel = (): TextBlock =>
  text(
    `<p>${styled(`color: ${colours.primary}; font-size: 13px`, "<strong>SECURITY NOTICE</strong>")}</p>`,
    0,
    8,
  );

const heading = (title: string): TextBlock =>
  text(`<h1>${styled("font-size: 24px", title)}</h1>`, 0, 24);

const paragraph = (html: string): TextBlock => text(`<p>${html}</p>`);

const muted = (html: string, size: number): TextBlock =>
  text(
    `<p>${styled(`color: ${colours.muted}; font-size: ${String(size)}px`, html)}</p>`,
  );

/** A button and, under it, the link written out for mail apps that block buttons. */
const action = (label: string, urlVariable: string, note?: string): Block[] => [
  {
    ...createButtonBlock(label, `{{${urlVariable}}}`),
    padding: { top: 8, right: sideSpace, bottom: 16, left: sideSpace },
    align: "left",
    buttonColor: colours.primary,
    borderRadius: 10,
    innerPaddingX: 28,
    innerPaddingY: 14,
  },
  ...(note === undefined ? [] : [muted(note, 14)]),
  muted(
    `If the button doesn't work, copy this link into your browser:<br><a href="{{${urlVariable}}}">{{${urlVariable}}}</a>`,
    13,
  ),
];

const details = (rows: readonly (readonly [string, string])[]): TextBlock => ({
  ...text(
    rows
      .map(
        ([label, value]) =>
          `<p>${styled(`color: ${colours.muted}; font-size: 13px`, label)}<br><strong>${styled(`color: ${colours.ink}; font-size: 15px`, value)}</strong></p>`,
      )
      .join(""),
    8,
    24,
  ),
  backgroundColor: colours.panel,
  boxBorderWidth: 1,
  boxBorderColor: colours.panelBorder,
  boxBorderRadius: 12,
  boxPadding: 16,
});

const callout = (body: string, title = "Wasn't you?"): TextBlock => ({
  ...text(
    `<p>${styled(`color: ${colours.calloutInk}; font-size: 15px`, `<strong>${title}</strong><br>${body}`)}</p>`,
    8,
    24,
  ),
  backgroundColor: colours.calloutGround,
  boxBorderWidth: 4,
  boxBorderColor: colours.calloutBorder,
  boxBorderSide: "left",
  boxBorderRadius: 8,
  boxPadding: 16,
});

/** Why this address got the email: the line above the Footer. */
const sentBecause = (reason: string): TextBlock =>
  text(
    `<p style="text-align: center">${styled(`color: ${colours.muted}; font-size: 13px`, `This email was sent to {{email}} ${reason}.`)}</p>`,
    16,
    0,
  );

const accountReason = "because it is the email address of a Wizzaroo account";
const nothingMoreToDo = "If you made this change, there's nothing more to do.";

const layout = ({
  preheader,
  isSecurityNotice = false,
  title,
  greeting = "Hello,",
  body,
  reason = accountReason,
}: {
  preheader: string;
  isSecurityNotice?: boolean;
  title: string;
  greeting?: string;
  body: Block[];
  reason?: string;
}): Design => {
  return withWizzarooSettings(
    createDesign([
      ...(isSecurityNotice ? [securityLabel()] : []),
      heading(title),
      paragraph(greeting),
      ...body,
      text("<p>Wizzaroo</p>", 8, 8),
      sentBecause(reason),
    ]),
    preheader,
  );
};

/** Wizzaroo's look: its colours, card and font, shared by the emails, the Header and the Footer. */
const withWizzarooSettings = (design: Design, preheader = ""): Design => {
  design.settings = {
    ...design.settings,
    preheader,
    backgroundColor: colours.ground,
    contentBackgroundColor: colours.card,
    contentBorderColor: colours.border,
    contentBorderRadius: 16,
    contentWidth: 560,
    contentPadding: 40,
    fontFamily: fontStack,
    fontSize: 16,
    lineHeight: 1.6,
    textColor: colours.body,
    headingColor: colours.ink,
    linkColor: colours.primary,
  };
  return design;
};

/** The built-in Configuration: every built-in email is sent from Wizzaroo's no-reply address. */
export const builtInConfiguration = {
  name: "Wizzaroo",
  fromEmail: "no-reply@wizzaroo.adrianeyre.co.uk",
  fromName: "Wizzaroo",
} as const;

const sampleDate = "20 November 2026 at 10:48 (UK time)";
const sampleEmail = "ada@example.com";

const variablesOf = (
  samples: Record<string, unknown>,
  optional: string[] = [],
) => Object.keys(samples).filter((name) => !optional.includes(name));

const build = (
  email: Omit<
    BuiltInEmail,
    | "variables"
    | "headerName"
    | "footerName"
    | "configurationName"
    | "previousName"
    | "slug"
  >,
  optional: string[] = [],
): BuiltInEmail => ({
  ...email,
  name: `${builtInNamePrefix}${email.name}`,
  slug: slugify(`${builtInNamePrefix}${email.name}`),
  previousName: email.name,
  headerName: "Wizzaroo",
  footerName: "Wizzaroo",
  configurationName: builtInConfiguration.name,
  variables: variablesOf(email.sampleVariables, optional),
});

export const builtInEmails: readonly BuiltInEmail[] = [
  build({
    name: "Confirm your email address",
    category: "Links",
    description:
      "Asks someone to confirm an address they want to use. The link works for a set time.",
    subject: "Confirm your email address for Wizzaroo",
    sampleVariables: {
      email: sampleEmail,
      confirmationUrl: "https://wizzaroo.example.com/confirm?token=abc123",
      linkLifetime: "24 hours",
    },
    design: layout({
      preheader: "Confirm this address to use it with your Wizzaroo account.",
      title: "Confirm your email address",
      body: [
        paragraph(
          "Someone signed in to Wizzaroo asked to use {{email}} for their account. Please confirm that this address is yours.",
        ),
        ...action(
          "Confirm email address",
          "confirmationUrl",
          "This link works once, and expires after {{linkLifetime}}.",
        ),
        paragraph(
          "If you didn't ask for this, you can ignore this email and nothing will change.",
        ),
      ],
      reason: "because it was entered in Wizzaroo",
    }),
  }),
  build({
    name: "Reset your password",
    category: "Links",
    description:
      "Sent after Forgot your password?, with a link to choose a new one.",
    subject: "Reset your Wizzaroo password",
    sampleVariables: {
      email: sampleEmail,
      resetUrl: "https://wizzaroo.example.com/reset?token=abc123",
      linkLifetime: "1 hour",
    },
    design: layout({
      preheader: "Choose a new password for your Wizzaroo account.",
      title: "Reset your password",
      body: [
        paragraph(
          "Someone asked to reset the password for your Wizzaroo account, {{email}}. Choose a new one with the button below.",
        ),
        ...action(
          "Choose a new password",
          "resetUrl",
          "This link works once, and expires after {{linkLifetime}}.",
        ),
        paragraph(
          "If you didn't ask for this, you can ignore this email and your password won't change.",
        ),
      ],
    }),
  }),
  build({
    name: "Teacher invite",
    category: "Invites",
    description: "Invites a new Teacher to set up their login at a School.",
    subject: "You're invited to Wizzaroo as a Teacher at {{schoolName}}",
    sampleVariables: {
      email: sampleEmail,
      name: "Ada Lovelace",
      schoolName: "Hilltop Primary",
      inviteUrl: "https://wizzaroo.example.com/invite?token=abc123",
      inviteLifetime: "7 days",
    },
    design: layout({
      preheader: "Set up your Teacher login for {{schoolName}}.",
      title: "You're invited to Wizzaroo",
      greeting: "Hello {{name}},",
      body: [
        paragraph(
          "You've been invited to Wizzaroo as a Teacher at {{schoolName}}. Once you've set up your Teacher login, you can follow the progress of the Children in your Year Groups.",
        ),
        ...action(
          "Set up your Teacher login",
          "inviteUrl",
          "This Invite works once, and expires after {{inviteLifetime}}.",
        ),
        paragraph(
          "If you weren't expecting it, you can ignore this email and nothing will change.",
        ),
      ],
      reason: "because {{schoolName}} invited this address",
    }),
  }),
  build({
    name: "Parent invite",
    category: "Invites",
    description: "Invites a new Parent to set up their login at a School.",
    subject: "{{schoolName}} invites you to Wizzaroo",
    sampleVariables: {
      email: sampleEmail,
      name: "Ada Lovelace",
      schoolName: "Hilltop Primary",
      inviteUrl: "https://wizzaroo.example.com/invite?token=abc123",
      inviteLifetime: "7 days",
    },
    design: layout({
      preheader:
        "Set up your Parent login so your Children can play and learn at home.",
      title: "You're invited to Wizzaroo",
      greeting: "Hello {{name}},",
      body: [
        paragraph(
          "{{schoolName}} has invited you to Wizzaroo as a Parent. Your Children can play and learn at home, and you can see how they're getting on.",
        ),
        ...action(
          "Set up your Parent login",
          "inviteUrl",
          "This Invite works once, and expires after {{inviteLifetime}}.",
        ),
        paragraph(
          "If you weren't expecting it, you can ignore this email and nothing will change.",
        ),
      ],
      reason: "because {{schoolName}} invited this address",
    }),
  }),
  build({
    name: "Password changed",
    category: "Security notices",
    description: "Tells an adult their password was changed or reset.",
    subject: "Your Wizzaroo password was changed",
    sampleVariables: { email: sampleEmail, changedAt: sampleDate },
    design: layout({
      preheader:
        "If you didn't change it, contact your Wizzaroo Admin straight away.",
      isSecurityNotice: true,
      title: "Your password was changed",
      body: [
        paragraph("The password for your Wizzaroo account was changed."),
        details([
          ["Account", "{{email}}"],
          ["Changed", "{{changedAt}}"],
        ]),
        paragraph(nothingMoreToDo),
        callout(
          "Someone else may know your password. Contact your Wizzaroo Admin straight away, so they can help you back in.",
        ),
      ],
    }),
  }),
  build(
    {
      name: "Passkey added",
      category: "Security notices",
      description:
        "Names a passkey that was added. Set isFromQrCode when it was added from a QR code on a phone.",
      subject: "A passkey was added to your Wizzaroo account",
      sampleVariables: {
        email: sampleEmail,
        passkeyName: "Ada's MacBook",
        addedAt: sampleDate,
        isFromQrCode: false,
      },
      design: layout({
        preheader:
          "The new passkey can sign in to your account without a password.",
        isSecurityNotice: true,
        title: "A passkey was added to your account",
        body: [
          paragraph(
            'A passkey named "{{passkeyName}}" was added to your Wizzaroo account{{#if isFromQrCode}}, from a QR code scanned on another device{{/if}}. It signs in to your account without a password.',
          ),
          details([
            ["Account", "{{email}}"],
            ["Added", "{{addedAt}}"],
          ]),
          paragraph(nothingMoreToDo),
          callout(
            "Someone else may be signed in as you. Sign in to Wizzaroo, open Your account and remove any passkey you don't recognise. Then sign out your other browsers, change your password and contact your Wizzaroo Admin straight away.",
          ),
        ],
      }),
    },
    ["isFromQrCode"],
  ),
  build({
    name: "Passkey removed",
    category: "Security notices",
    description: "Names a passkey that was removed.",
    subject: "A passkey was removed from your Wizzaroo account",
    sampleVariables: {
      email: sampleEmail,
      passkeyName: "Ada's MacBook",
      removedAt: sampleDate,
    },
    design: layout({
      preheader: "The passkey no longer signs in to your account.",
      isSecurityNotice: true,
      title: "A passkey was removed from your account",
      body: [
        paragraph(
          'The passkey named "{{passkeyName}}" was removed from your Wizzaroo account. It no longer signs in to your account.',
        ),
        details([
          ["Account", "{{email}}"],
          ["Removed", "{{removedAt}}"],
        ]),
        paragraph(nothingMoreToDo),
        callout(
          "Someone else may be signed in as you. Sign in to Wizzaroo, open Your account and remove any passkey you don't recognise. Then sign out your other browsers, change your password and contact your Wizzaroo Admin straight away.",
        ),
      ],
    }),
  }),
  build({
    name: "Email change requested",
    category: "Security notices",
    description:
      "Sent to the old address when a move to a new one is asked for. Pass the new address masked, such as a•••@example.com.",
    subject: "Someone asked to change your Wizzaroo email address",
    sampleVariables: {
      email: sampleEmail,
      newEmailMasked: "a•••@example.org",
      requestedAt: sampleDate,
    },
    design: layout({
      preheader:
        "Nothing changes unless the new address is confirmed within 24 hours.",
      isSecurityNotice: true,
      title: "A change of email address was requested",
      body: [
        paragraph(
          "Someone signed in to your Wizzaroo account asked to change its email address. Nothing changes unless a link sent to the new address is opened within 24 hours.",
        ),
        details([
          ["Account", "{{email}}"],
          ["New address", "{{newEmailMasked}}"],
          ["Requested", "{{requestedAt}}"],
        ]),
        paragraph("If you asked for this, there's nothing more to do."),
        callout(
          "Someone else may be signed in as you and know your password. Sign in to Wizzaroo and change your password, which cancels the change and signs out your other browsers. Then contact your Wizzaroo Admin straight away.",
        ),
      ],
    }),
  }),
  build({
    name: "Email address changed",
    category: "Security notices",
    description:
      "Sent to the old address once the new one is confirmed. Pass the new address masked.",
    subject: "Your Wizzaroo email address was changed",
    sampleVariables: {
      email: sampleEmail,
      newEmailMasked: "a•••@example.org",
      changedAt: sampleDate,
    },
    design: layout({
      preheader: "Reset links and notices now go to the new address.",
      isSecurityNotice: true,
      title: "Your email address was changed",
      body: [
        paragraph(
          "The email address of your Wizzaroo account was changed. Reset links and security notices now go to the new address, and {{email}} no longer signs in.",
        ),
        details([
          ["Previous address", "{{email}}"],
          ["New address", "{{newEmailMasked}}"],
          ["Changed", "{{changedAt}}"],
        ]),
        paragraph(nothingMoreToDo),
        callout(
          "Someone else may have taken your account. Contact your Wizzaroo Admin straight away, so they can help you back in.",
        ),
      ],
      reason: "because it was the email address of a Wizzaroo account",
    }),
  }),
  build({
    name: "Sign-in codes paused",
    category: "Security notices",
    description:
      "Sent when too many wrong two-factor codes pause an adult's codes, saying when the pause ends.",
    subject: "Wrong sign-in codes were given for your Wizzaroo account",
    sampleVariables: {
      email: sampleEmail,
      wrongCodes: 5,
      pausedAt: sampleDate,
      pauseEndsAt: "20 November 2026 at 11:48 (UK time)",
    },
    design: layout({
      preheader:
        "Wizzaroo has paused two-factor codes for your account for now.",
      isSecurityNotice: true,
      title: "Sign-in codes are paused",
      body: [
        paragraph(
          "Someone signed in to your Wizzaroo account with its password, then gave {{wrongCodes}} wrong two-factor codes. To protect your account, Wizzaroo won't check any code for it until the pause ends. A passkey still signs you in.",
        ),
        details([
          ["Account", "{{email}}"],
          ["Last wrong code", "{{pausedAt}}"],
          ["Pause ends", "{{pauseEndsAt}}"],
        ]),
        paragraph(
          "If that was you, wait until the pause ends and sign in again with your newest code.",
        ),
        callout(
          "Someone else knows your password. Reset it from the sign-in page, and contact your Wizzaroo Admin straight away.",
        ),
      ],
    }),
  }),
  build({
    name: "Family Device signed in",
    category: "Security notices",
    description:
      "Sent when a Parent makes a browser a Family Device, with a button to review them.",
    subject: "A new Family Device was signed in to Wizzaroo",
    sampleVariables: {
      email: sampleEmail,
      signedInAt: sampleDate,
      parentPageUrl: "https://wizzaroo.example.com/parent",
    },
    design: layout({
      preheader: "The Children in your Family can now play on it.",
      isSecurityNotice: true,
      title: "A new Family Device was signed in",
      body: [
        paragraph(
          "Your Wizzaroo Parent account signed in a new Family Device. The Children in your Family can now play on it.",
        ),
        details([
          ["Account", "{{email}}"],
          ["Signed in", "{{signedInAt}}"],
        ]),
        paragraph("If that was you, there's nothing more to do."),
        callout(
          "Sign that Family Device out on the Parent page straight away, then change your password.",
        ),
        ...action("Review your Family Devices", "parentPageUrl"),
      ],
    }),
  }),
  build({
    name: "Two-factor turned off",
    category: "Security notices",
    description: "Sent when an adult turns two-factor authentication off.",
    subject:
      "Two-factor authentication was turned off for your Wizzaroo account",
    sampleVariables: { email: sampleEmail, turnedOffAt: sampleDate },
    design: layout({
      preheader: "Your password alone now signs in to your account.",
      isSecurityNotice: true,
      title: "Two-factor authentication was turned off",
      body: [
        paragraph(
          "Two-factor authentication was turned off for your Wizzaroo account. Your recovery codes no longer work, and your password alone now signs you in.",
        ),
        details([
          ["Account", "{{email}}"],
          ["Turned off", "{{turnedOffAt}}"],
        ]),
        paragraph(nothingMoreToDo),
        callout(
          "Someone else is signed in as you. Change your password, turn two-factor authentication on again, and contact your Wizzaroo Admin straight away.",
        ),
      ],
    }),
  }),
  build({
    name: "Email address already in use",
    category: "Other notes",
    description:
      "Sent instead of a confirmation link when the address asked for already has an account.",
    subject: "Someone tried to use your email address in Wizzaroo",
    sampleVariables: { email: sampleEmail },
    design: layout({
      preheader:
        "Your address already has a Wizzaroo account, so nothing has changed.",
      title: "Your email address is already in use",
      body: [
        paragraph(
          "Someone signed in to Wizzaroo asked to use {{email}} for their account. This address already has a Wizzaroo account, so nothing has changed.",
        ),
        paragraph(
          "If that was you, sign in with this address instead. If it wasn't, you don't need to do anything.",
        ),
      ],
    }),
  }),
  build({
    name: "Family join request",
    category: "Other notes",
    description:
      "Tells a Family's Parents that a Teacher asked to add another adult.",
    subject: "Someone has been asked to join your Family in Wizzaroo",
    sampleVariables: {
      email: sampleEmail,
      schoolName: "Hilltop Primary",
      parentPageUrl: "https://wizzaroo.example.com/parent",
    },
    design: layout({
      preheader: "Nothing changes unless one of your Family's Parents agrees.",
      title: "A request to join your Family",
      body: [
        paragraph(
          "A Teacher at {{schoolName}} has asked to add another adult to your Family in Wizzaroo. As a Parent in your Family, they could see and change everything about your Children.",
        ),
        paragraph(
          "Nothing changes unless one of your Family's Parents agrees. Sign in to see who it is, then agree or turn it down in Your Family's data.",
        ),
        ...action("Review the request", "parentPageUrl"),
        paragraph("If you don't know who it is, turn it down."),
      ],
    }),
  }),
  build({
    name: "Adult joined Family",
    category: "Other notes",
    description:
      "Tells a Family's Parents that another adult joined as a Parent.",
    subject: "An adult has joined your Family in Wizzaroo",
    sampleVariables: { email: sampleEmail, joinedEmail: "grace@example.com" },
    design: layout({
      preheader: "They're now a Parent in your Family.",
      title: "An adult has joined your Family",
      body: [
        paragraph(
          "{{joinedEmail}} is now a Parent in your Family in Wizzaroo. Once they accept their Invite, they can see and change everything about your Children.",
        ),
        paragraph("If you expected this, there's nothing more to do."),
        callout(
          "Contact your Wizzaroo Admin straight away.",
          "Didn't expect this?",
        ),
      ],
    }),
  }),
];

/* ---------- The Wizzaroo Header and Footer ---------- */

export interface BuiltInPart {
  kind: "header" | "footer";
  name: string;
  description: string;
  sampleVariables: Record<string, unknown>;
  design: Design;
}

/** Where to find Wizzaroo, under the Footer's note, in Wizzaroo's own colour. */
export const wizzarooSocialLinks = [
  { network: "website", url: "https://adrianeyre.co.uk" },
  { network: "linkedin", url: "https://www.linkedin.com/in/adrianeyre" },
  { network: "facebook", url: "https://facebook.com/adrianeyre" },
] as const;

const wizzarooSocials = (): SocialBlock => {
  const block = createSocialBlock(
    wizzarooSocialLinks.map((link) => link.network),
  );
  return {
    ...block,
    padding: { top: 16, right: sideSpace, bottom: 0, left: sideSpace },
    links: block.links.map((link, index) => ({
      ...link,
      url: wizzarooSocialLinks[index]?.url ?? link.url,
    })),
    colorMode: "custom",
    customColor: colours.primary,
    iconSize: 28,
    gap: 12,
  };
};

export const builtInParts: readonly BuiltInPart[] = [
  {
    kind: "header",
    name: "Wizzaroo",
    description: "The Wizzaroo logo, above every Wizzaroo email.",
    sampleVariables: {},
    design: withWizzarooSettings(
      createDesign([
        {
          ...createHtmlBlock(
            `<div style="line-height:0;">${wizzarooLogoSvg.replace('width="273" height="68"', 'width="200" height="50"')}</div>`,
          ),
          padding: { top: 0, right: sideSpace, bottom: 24, left: sideSpace },
        },
      ]),
    ),
  },
  {
    kind: "footer",
    name: "Wizzaroo",
    description: "The note under every Wizzaroo email.",
    sampleVariables: {},
    design: withWizzarooSettings(
      createDesign([
        {
          ...createDividerBlock(),
          padding: spacing(16, sideSpace),
          color: colours.border,
        },
        text(
          `<p style="text-align: center">${styled(`color: ${colours.muted}; font-size: 13px`, "This is an automated message, so replies aren't read.")}</p>`,
          0,
          0,
        ),
        wizzarooSocials(),
      ]),
    ),
  },
];

/** The body for POST /headers or /footers. */
export const toPartBody = (part: BuiltInPart) => ({
  name: part.name,
  html: renderDesignHtml(part.design),
  sampleVariables: part.sampleVariables,
  design: { ...part.design },
});

/** The body for POST /templates: the design, the HTML rendered from it, and its Header, Footer and Configuration by ID. */
export const toTemplateBody = (
  email: BuiltInEmail,
  partIds: {
    headerId?: string | null;
    footerId?: string | null;
    configurationId?: string | null;
  } = {},
) => ({
  name: email.name,
  slug: email.slug,
  subject: email.subject,
  html: renderDesignHtml(email.design, { title: email.subject }),
  text: null,
  variables: email.variables,
  sampleVariables: email.sampleVariables,
  design: { ...email.design },
  headerId: partIds.headerId ?? null,
  footerId: partIds.footerId ?? null,
  configurationId: partIds.configurationId ?? null,
});
