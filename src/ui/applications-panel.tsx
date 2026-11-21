import { useState } from "react";
import {
  readNumber,
  readRecords,
  readText,
  requestJson,
} from "./api-client.js";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog.js";
import { ModalDialog } from "./modal-dialog.js";
import {
  FailureNotice,
  formatDateTime,
  submitForm,
  TextField,
  useActionRunner,
} from "./ui-parts.js";
import type { ApiData } from "./use-api-data.js";

/**
 * The Applications API Keys belong to (ADR 0009), to rename or delete. One with keys can't be deleted; deleting one
 * leaves its Templates, Headers, Footers, Configurations and Messages owned by no Application.
 */
export const ApplicationsPanel = ({
  applications,
  onChange,
}: {
  applications: ApiData;
  /** Called after a rename or delete, so the keys' list shows it too. */
  onChange: () => void;
}) => {
  const rows = readRecords(applications.data, "applications");
  const { error, isBusy, runAction } = useActionRunner();
  const [renaming, setRenaming] = useState<unknown>(undefined);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<unknown>(undefined);
  const done = () => {
    setRenaming(undefined);
    setDeleting(undefined);
    applications.reload();
    onChange();
  };
  if (rows.length === 0) {
    return null;
  }
  return (
    <section className="panel" aria-labelledby="applications-heading">
      <h2 id="applications-heading">Applications</h2>
      <p className="muted">
        Each API key belongs to one application. Its keys can change only that
        application&apos;s templates, headers and footers, send only from its
        configurations&apos; addresses or the default from address, and read
        only its emails. Users can change everything.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>API keys</th>
              <th>Created</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={readText(row, "id")}>
                <td>{readText(row, "name")}</td>
                <td>{String(readNumber(row, "apiKeys") ?? 0)}</td>
                <td>{formatDateTime(readText(row, "createdAt"))}</td>
                <td>
                  <button
                    type="button"
                    className="button-small"
                    aria-haspopup="dialog"
                    aria-label={`Rename ${readText(row, "name")}`}
                    onClick={() => {
                      setNewName(readText(row, "name"));
                      setRenaming(row);
                    }}
                  >
                    Rename
                  </button>{" "}
                  <button
                    type="button"
                    className="button-small button-danger"
                    aria-haspopup="dialog"
                    aria-label={`Delete ${readText(row, "name")}`}
                    onClick={() => {
                      setDeleting(row);
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
      <ModalDialog
        isOpen={renaming !== undefined}
        onClose={() => {
          setRenaming(undefined);
        }}
        title="Rename this application"
        closeLabel="Cancel"
        actions={
          <button
            type="submit"
            form="rename-application"
            className="button button-primary"
            disabled={isBusy}
          >
            Rename
          </button>
        }
      >
        <form
          id="rename-application"
          onSubmit={submitForm(() => {
            runAction(
              () =>
                requestJson(`/app/applications/${readText(renaming, "id")}`, {
                  method: "PUT",
                  body: { name: newName },
                }),
              done,
            );
          })}
        >
          <TextField
            label="Name"
            value={newName}
            onChange={setNewName}
            isRequired
            isFirst
          />
          <FailureNotice error={renaming === undefined ? undefined : error} />
        </form>
      </ModalDialog>
      <ConfirmDeleteDialog
        isOpen={deleting !== undefined}
        title="Delete this application?"
        summary={
          <>
            The application <strong>{readText(deleting, "name")}</strong> will
            be deleted.
          </>
        }
        details={[
          { label: "Name", value: readText(deleting, "name") },
          {
            label: "API keys",
            value: String(readNumber(deleting, "apiKeys") ?? 0),
          },
        ]}
        consequences={[
          "An application with API keys can't be deleted: delete its keys first.",
          "Its templates, headers, footers, configurations and emails stay, owned by no application, so only users can change them.",
        ]}
        confirmLabel="Delete application"
        isBusy={isBusy}
        error={deleting === undefined ? undefined : error}
        onCancel={() => {
          setDeleting(undefined);
        }}
        onConfirm={() => {
          runAction(
            () =>
              requestJson(`/app/applications/${readText(deleting, "id")}`, {
                method: "DELETE",
              }),
            done,
          );
        }}
      />
    </section>
  );
};
