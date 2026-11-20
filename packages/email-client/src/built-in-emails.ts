/**
 * The built-in emails and the variables each needs. Dates and times are strings the caller formats, such as
 * "20 November 2026 at 10:48 (UK time)", and lifetimes are phrases such as "24 hours".
 */
export interface BuiltInEmails {
  "Wizzaroo - Confirm your email address": {
    email: string;
    confirmationUrl: string;
    linkLifetime: string;
  };
  "Wizzaroo - Reset your password": {
    email: string;
    resetUrl: string;
    linkLifetime: string;
  };
  "Wizzaroo - Teacher invite": {
    email: string;
    name: string;
    schoolName: string;
    inviteUrl: string;
    inviteLifetime: string;
  };
  "Wizzaroo - Parent invite": {
    email: string;
    name: string;
    schoolName: string;
    inviteUrl: string;
    inviteLifetime: string;
  };
  "Wizzaroo - Password changed": { email: string; changedAt: string };
  "Wizzaroo - Passkey added": {
    email: string;
    passkeyName: string;
    addedAt: string;
    isFromQrCode?: boolean;
  };
  "Wizzaroo - Passkey removed": {
    email: string;
    passkeyName: string;
    removedAt: string;
  };
  "Wizzaroo - Email change requested": {
    email: string;
    /** Use `maskEmailAddress(newEmail)`. */
    newEmailMasked: string;
    requestedAt: string;
  };
  "Wizzaroo - Email address changed": {
    email: string;
    /** Use `maskEmailAddress(newEmail)`. */
    newEmailMasked: string;
    changedAt: string;
  };
  "Wizzaroo - Sign-in codes paused": {
    email: string;
    wrongCodes: number | string;
    pausedAt: string;
    pauseEndsAt: string;
  };
  "Wizzaroo - Family Device signed in": {
    email: string;
    signedInAt: string;
    parentPageUrl: string;
  };
  "Wizzaroo - Two-factor turned off": { email: string; turnedOffAt: string };
  "Wizzaroo - Email address already in use": { email: string };
  "Wizzaroo - Family join request": {
    email: string;
    schoolName: string;
    parentPageUrl: string;
  };
  "Wizzaroo - Adult joined Family": { email: string; joinedEmail: string };
}

/** The exact name of a built-in template in the email app. */
export type BuiltInEmailName = keyof BuiltInEmails;

/** Each built-in email's helper name on `client.builtIn`, and the template it sends. */
export const builtInEmailNames = {
  confirmYourEmailAddress: "Wizzaroo - Confirm your email address",
  resetYourPassword: "Wizzaroo - Reset your password",
  teacherInvite: "Wizzaroo - Teacher invite",
  parentInvite: "Wizzaroo - Parent invite",
  passwordChanged: "Wizzaroo - Password changed",
  passkeyAdded: "Wizzaroo - Passkey added",
  passkeyRemoved: "Wizzaroo - Passkey removed",
  emailChangeRequested: "Wizzaroo - Email change requested",
  emailAddressChanged: "Wizzaroo - Email address changed",
  signInCodesPaused: "Wizzaroo - Sign-in codes paused",
  familyDeviceSignedIn: "Wizzaroo - Family Device signed in",
  twoFactorTurnedOff: "Wizzaroo - Two-factor turned off",
  emailAddressAlreadyInUse: "Wizzaroo - Email address already in use",
  familyJoinRequest: "Wizzaroo - Family join request",
  adultJoinedFamily: "Wizzaroo - Adult joined Family",
} as const satisfies Record<string, BuiltInEmailName>;

/**
 * Each built-in email's helper name on `client.builtIn`, and the slug of the template it sends. A slug stays the same
 * when a template is renamed in the app, so the helpers send by slug.
 */
export const builtInEmailSlugs = {
  confirmYourEmailAddress: "wizzaroo-confirm-your-email-address",
  resetYourPassword: "wizzaroo-reset-your-password",
  teacherInvite: "wizzaroo-teacher-invite",
  parentInvite: "wizzaroo-parent-invite",
  passwordChanged: "wizzaroo-password-changed",
  passkeyAdded: "wizzaroo-passkey-added",
  passkeyRemoved: "wizzaroo-passkey-removed",
  emailChangeRequested: "wizzaroo-email-change-requested",
  emailAddressChanged: "wizzaroo-email-address-changed",
  signInCodesPaused: "wizzaroo-sign-in-codes-paused",
  familyDeviceSignedIn: "wizzaroo-family-device-signed-in",
  twoFactorTurnedOff: "wizzaroo-two-factor-turned-off",
  emailAddressAlreadyInUse: "wizzaroo-email-address-already-in-use",
  familyJoinRequest: "wizzaroo-family-join-request",
  adultJoinedFamily: "wizzaroo-adult-joined-family",
} as const satisfies Record<keyof typeof builtInEmailNames, string>;

/** The slug of a built-in template in the email app, such as "wizzaroo-reset-your-password". */
export type BuiltInEmailSlug =
  (typeof builtInEmailSlugs)[keyof typeof builtInEmailSlugs];

/** The built-in emails and their variables, by slug. */
export type BuiltInEmailsBySlug = {
  [
    Helper in keyof typeof builtInEmailSlugs as (typeof builtInEmailSlugs)[Helper]
  ]: BuiltInEmails[(typeof builtInEmailNames)[Helper]];
};
