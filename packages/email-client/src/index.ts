export {
  createEmailClient,
  type Attachment,
  type BuiltInEmailSenders,
  type BuiltInSendOptions,
  type CommonSendOptions,
  type EmailClient,
  type EmailClientOptions,
  type Message,
  type MessageStatus,
  type Recipients,
  type SendContentOptions,
  type SendSlugOptions,
  type SendTemplateOptions,
  type SlugVariables,
  type Template,
  type TemplateVariables,
} from "./client.js";
export {
  builtInEmailNames,
  builtInEmailSlugs,
  type BuiltInEmailName,
  type BuiltInEmails,
  type BuiltInEmailsBySlug,
  type BuiltInEmailSlug,
} from "./built-in-emails.js";
export {
  EmailApiError,
  EmailNetworkError,
  EmailTimeoutError,
  type FieldError,
} from "./errors.js";
export { maskEmailAddress } from "./mask-email-address.js";
