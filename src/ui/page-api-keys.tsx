import { useState } from "react";
import {
  readCreator,
  readRecords,
  readText,
  requestJson,
} from "./api-client.js";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog.js";
import { PasswordField } from "./password-field.js";
import {
  CopyButton,
  EmptyState,
  FailureNotice,
  formatDateTime,
  LoadingState,
  PageHeader,
  submitForm,
  TextField,
  useActionRunner,
} from "./ui-parts.js";
import { useApiData } from "./use-api-data.js";
import { ApplicationNameField } from "./application-picker.js";
import { ApplicationsPanel } from "./applications-panel.js";

export const ApiKeysPage = () => {
  const keys = useApiData("/app/api-keys");
  const [name, setName] = useState("");
  const applications = useApiData("/app/applications");
  const [application, setApplication] = useState("");
  /** Your own password, asked again before a key is created (step-up). */
  const [currentPassword, setCurrentPassword] = useState("");
  const [newSecret, setNewSecret] = useState<string | undefined>(undefined);
  const { error, isBusy, runAction } = useActionRunner();
  const rows = readRecords(keys.data, "apiKeys");
  /** The key whose Delete was pressed, kept while its dialog is open. */
  const [deleting, setDeleting] = useState<unknown>(undefined);
  const lastUsed = readText(deleting, "lastUsedAt");
  return (
    <>
      <PageHeader
        title="API keys"
        description="Your applications send email with an API key as a Bearer token. A key is shown once, when it is created."
      />
      <form
        className="inline-form"
        onSubmit={submitForm(() => {
          runAction(
            () =>
              requestJson("/app/api-keys", {
                method: "POST",
                body: { name, application, currentPassword },
              }),
            (result) => {
              setNewSecret(readText(result, "secret"));
              setName("");
              setCurrentPassword("");
              keys.reload();
              applications.reload();
            },
          );
        })}
      >
        <TextField
          label="Name"
          value={name}
          onChange={setName}
          placeholder="My app"
          isRequired
        />
        <ApplicationNameField
          value={application}
          onChange={setApplication}
          names={readRecords(applications.data, "applications").map((row) =>
            readText(row, "name"),
          )}
        />
        <PasswordField
          label="Your current password"
          value={currentPassword}
          onChange={setCurrentPassword}
          autoComplete="current-password"
        />
        <button
          type="submit"
          className="button button-primary"
          disabled={isBusy || currentPassword === ""}
        >
          Create API key
        </button>
      </form>
      {newSecret === undefined ? null : (
        <div className="notice notice-success" role="status">
          <p>Copy this key now. It will not be shown again.</p>
          <p className="mono wrap">{newSecret}</p>
          <CopyButton value={newSecret} label="API key" />
        </div>
      )}
      <FailureNotice error={error ?? keys.error} />
      <LoadingState isLoading={keys.isLoading} />
      {rows.length === 0 && !keys.isLoading ? (
        <EmptyState>No API keys yet.</EmptyState>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Application</th>
                <th>Key</th>
                <th>Created</th>
                <th>Created by</th>
                <th>Last used</th>
                <th>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((key) => (
                <tr key={readText(key, "id")}>
                  <td>{readText(key, "name")}</td>
                  <td>{readText(key, "applicationName")}</td>
                  <td className="mono">{readText(key, "prefix")}</td>
                  <td>{formatDateTime(readText(key, "createdAt"))}</td>
                  <td>{readCreator(key)}</td>
                  <td>{formatDateTime(readText(key, "lastUsedAt"))}</td>
                  <td>
                    <button
                      type="button"
                      className="button-small button-danger"
                      aria-haspopup="dialog"
                      aria-label={`Delete ${readText(key, "name")}`}
                      onClick={() => {
                        setDeleting(key);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDeleteDialog
        isOpen={deleting !== undefined}
        title="Delete this API key?"
        summary={
          <>
            The API key <strong>{readText(deleting, "name")}</strong> will be
            deleted.
          </>
        }
        details={[
          { label: "Name", value: readText(deleting, "name") },
          {
            label: "Application",
            value: readText(deleting, "applicationName"),
          },
          {
            label: "Key",
            value: readText(deleting, "prefix"),
            isMono: true,
          },
          {
            label: "Created",
            value: formatDateTime(readText(deleting, "createdAt")),
          },
          {
            label: "Last used",
            value: lastUsed === "" ? "Never" : formatDateTime(lastUsed),
          },
        ]}
        consequences={[
          <>
            Applications using it can no longer send: their requests are refused
            with <strong>401 Unauthorized</strong>, straight away.
          </>,
          "To replace it without a gap, create a new key and switch your applications to it first.",
          "Emails already sent with it stay in Logs.",
        ]}
        confirmLabel="Delete API key"
        isBusy={isBusy}
        error={deleting === undefined ? undefined : error}
        onCancel={() => {
          setDeleting(undefined);
        }}
        onConfirm={() => {
          runAction(
            () =>
              requestJson(`/app/api-keys/${readText(deleting, "id")}`, {
                method: "DELETE",
              }),
            () => {
              setDeleting(undefined);
              keys.reload();
            },
          );
        }}
      />
      <ApplicationsPanel applications={applications} onChange={keys.reload} />
    </>
  );
};
