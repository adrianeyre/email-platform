import { useState } from "react";
import {
  readFlag,
  readNumber,
  readText,
  requestJson,
  type JsonRecord,
} from "./api-client.js";
import {
  FailureNotice,
  LoadingState,
  PageHeader,
  StatusLine,
  submitForm,
  TextField,
  useActionRunner,
} from "./ui-parts.js";
import { useApiData } from "./use-api-data.js";

interface SettingsForm {
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpPassword: string;
  defaultFrom: string;
  logRetentionDays: string;
}

const readForm = (data: unknown): SettingsForm => ({
  smtpHost: readText(data, "smtpHost"),
  smtpPort: String(readNumber(data, "smtpPort") ?? 587),
  smtpSecure: readFlag(data, "smtpSecure"),
  smtpUsername: readText(data, "smtpUsername"),
  smtpPassword: "",
  defaultFrom: readText(data, "defaultFrom"),
  logRetentionDays: String(readNumber(data, "logRetentionDays") ?? 90),
});

const buildChange = (form: SettingsForm): JsonRecord => ({
  smtpHost: form.smtpHost,
  smtpPort: Number(form.smtpPort),
  smtpSecure: form.smtpSecure,
  smtpUsername: form.smtpUsername,
  defaultFrom: form.defaultFrom,
  logRetentionDays: Number(form.logRetentionDays),
  ...(form.smtpPassword === "" ? {} : { smtpPassword: form.smtpPassword }),
});

const SettingsEditor = ({ initial }: { initial: unknown }) => {
  const [saved, setSaved] = useState(initial);
  const [form, setForm] = useState(() => readForm(initial));
  const [testTo, setTestTo] = useState("");
  const [status, setStatus] = useState("");
  const save = useActionRunner();
  const test = useActionRunner();
  const hasPassword = readFlag(saved, "hasSmtpPassword");
  const isPasswordUnreadable = readFlag(saved, "isSmtpPasswordUnreadable");
  const update = (change: Partial<SettingsForm>) => {
    setForm((current) => ({ ...current, ...change }));
  };
  return (
    <>
      <form
        className="stack-form"
        onSubmit={submitForm(() => {
          setStatus("");
          save.runAction(
            () =>
              requestJson("/app/settings", {
                method: "PUT",
                body: buildChange(form),
              }),
            (result) => {
              setSaved(result);
              setForm(readForm(result));
              setStatus("Settings saved.");
            },
          );
        })}
      >
        <fieldset className="fieldset">
          <legend>SMTP provider</legend>
          <TextField
            label="Host"
            value={form.smtpHost}
            onChange={(smtpHost) => {
              update({ smtpHost });
            }}
            placeholder="smtp.example.com"
          />
          <TextField
            label="Port"
            type="number"
            value={form.smtpPort}
            onChange={(smtpPort) => {
              update({ smtpPort });
            }}
            hint="587 for STARTTLS, 465 for TLS"
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.smtpSecure}
              onChange={(event) => {
                update({ smtpSecure: event.target.checked });
              }}
            />
            Connect with TLS from the start (usually port 465)
          </label>
          <TextField
            label="Username"
            value={form.smtpUsername}
            onChange={(smtpUsername) => {
              update({ smtpUsername });
            }}
          />
          <TextField
            label="Password"
            type="password"
            value={form.smtpPassword}
            onChange={(smtpPassword) => {
              update({ smtpPassword });
            }}
            hint={
              isPasswordUnreadable
                ? "A password is saved, but it can't be read with this server's ENCRYPTION_KEY. Enter it again, or restart with the key it was saved under."
                : hasPassword
                  ? "A password is saved. Leave blank to keep it, unless you change the host or port: then enter it again."
                  : "Stored encrypted. With a username, the connection must use TLS or STARTTLS."
            }
          />
        </fieldset>
        <TextField
          label="Default from address"
          value={form.defaultFrom}
          onChange={(defaultFrom) => {
            update({ defaultFrom });
          }}
          placeholder="My App <hello@example.com>"
          hint="Used when a send request has no from address and its template has no configuration. A new install starts with no-reply@adrianeyre.co.uk."
        />
        <TextField
          label="Keep logs for (days)"
          type="number"
          value={form.logRetentionDays}
          onChange={(logRetentionDays) => {
            update({ logRetentionDays });
          }}
        />
        <FailureNotice error={save.error} />
        <StatusLine message={status} />
        <button
          type="submit"
          className="button button-primary"
          disabled={save.isBusy}
        >
          Save settings
        </button>
      </form>
      <section className="panel">
        <h2>Send a test email</h2>
        <p className="muted">
          Sends straight through the saved SMTP settings, so save first.
        </p>
        <form
          className="inline-form"
          onSubmit={submitForm(() => {
            setStatus("");
            test.runAction(
              () =>
                requestJson("/app/settings/test", {
                  method: "POST",
                  body: { to: testTo },
                }),
              () => {
                setStatus(`Test email sent to ${testTo}.`);
              },
            );
          })}
        >
          <TextField
            label="To"
            type="email"
            value={testTo}
            onChange={setTestTo}
            isRequired
          />
          <button type="submit" className="button" disabled={test.isBusy}>
            Send test email
          </button>
        </form>
        <FailureNotice error={test.error} />
      </section>
    </>
  );
};

export const SettingsPage = () => {
  const settings = useApiData("/app/settings");
  return (
    <>
      <PageHeader
        title="Delivery"
        description="The SMTP provider your email is sent through, the default from address and how long logs are kept."
      />
      <LoadingState isLoading={settings.isLoading} />
      <FailureNotice error={settings.error} />
      {settings.data === undefined ? null : (
        <SettingsEditor initial={settings.data} />
      )}
    </>
  );
};
