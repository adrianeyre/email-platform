import { useState } from "react";
import { readRecords, readText, requestJson } from "./api-client.js";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog.js";
import { KeyIcon, PlusIcon } from "./icons.js";
import { ModalDialog } from "./modal-dialog.js";
import {
  generatePassword,
  lengthRule,
  PasswordField,
} from "./password-field.js";
import {
  CopyButton,
  FailureNotice,
  formatDateTime,
  LoadingState,
  PageHeader,
  StatusLine,
  submitForm,
  TextField,
  useActionRunner,
} from "./ui-parts.js";
import { useApiData } from "./use-api-data.js";

/** The footer of a form dialog: Cancel, and the submit button, which belongs to the form by its id. */
const FormActions = ({
  formId,
  label,
  busyLabel,
  isBusy,
  canSubmit,
  onCancel,
}: {
  formId: string;
  label: string;
  busyLabel: string;
  isBusy: boolean;
  canSubmit: boolean;
  onCancel: () => void;
}) => (
  <>
    <button type="button" className="button" onClick={onCancel}>
      Cancel
    </button>
    <button
      type="submit"
      form={formId}
      className="button button-primary"
      disabled={isBusy || !canSubmit}
    >
      {isBusy ? busyLabel : label}
    </button>
  </>
);

const ChangePasswordDialog = ({
  isOpen,
  onClose,
  onChanged,
}: {
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
}) => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const { error, isBusy, runAction } = useActionRunner();
  const rules = [
    lengthRule(newPassword),
    {
      label: "Different from your current password",
      isMet: newPassword !== "" && newPassword !== currentPassword,
    },
  ];
  const isRepeated = repeatPassword !== "" && repeatPassword === newPassword;
  const canSubmit =
    currentPassword !== "" && rules.every((rule) => rule.isMet) && isRepeated;
  const close = () => {
    setCurrentPassword("");
    setNewPassword("");
    setRepeatPassword("");
    onClose();
  };
  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={close}
      title="Change your password"
      closeLabel="Cancel"
      className="form-dialog"
      actions={
        <FormActions
          formId="change-password-form"
          label="Change password"
          busyLabel="Changing…"
          isBusy={isBusy}
          canSubmit={canSubmit}
          onCancel={close}
        />
      }
    >
      <form
        id="change-password-form"
        className="stack-form"
        onSubmit={submitForm(() => {
          if (!canSubmit) {
            return;
          }
          runAction(
            () =>
              requestJson("/app/me/password", {
                method: "PUT",
                body: { currentPassword, newPassword },
              }),
            () => {
              close();
              onChanged();
            },
          );
        })}
      >
        <p className="muted">
          You stay signed in here. Use the new password the next time you sign
          in.
        </p>
        <PasswordField
          label="Current password"
          value={currentPassword}
          onChange={setCurrentPassword}
          autoComplete="current-password"
          isFirst
        />
        <PasswordField
          label="New password"
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
          rules={rules}
        />
        <PasswordField
          label="Repeat the new password"
          value={repeatPassword}
          onChange={setRepeatPassword}
          autoComplete="new-password"
          rules={[{ label: "Matches the new password", isMet: isRepeated }]}
        />
        <FailureNotice error={error} />
      </form>
    </ModalDialog>
  );
};

const AddUserDialog = ({
  isOpen,
  onClose,
  onAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdded: (email: string) => void;
}) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { error, isBusy, runAction } = useActionRunner();
  const rules = [lengthRule(password)];
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email.trim());
  const canSubmit = isEmail && rules.every((rule) => rule.isMet);
  const close = () => {
    setEmail("");
    setPassword("");
    onClose();
  };
  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={close}
      title="Add a user"
      closeLabel="Cancel"
      className="form-dialog"
      actions={
        <FormActions
          formId="add-user-form"
          label="Add user"
          busyLabel="Adding…"
          isBusy={isBusy}
          canSubmit={canSubmit}
          onCancel={close}
        />
      }
    >
      <form
        id="add-user-form"
        className="stack-form"
        onSubmit={submitForm(() => {
          if (!canSubmit) {
            return;
          }
          const added = email.trim();
          runAction(
            () =>
              requestJson("/app/users", {
                method: "POST",
                body: { email: added, password },
              }),
            () => {
              close();
              onAdded(added);
            },
          );
        })}
      >
        <p className="muted">
          They can sign in straight away and manage everything, as you can.
        </p>
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="off"
          placeholder="name@example.com"
          isRequired
          isFirst
        />
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          rules={rules}
        />
        <div className="password-actions">
          <button
            type="button"
            className="button-small"
            onClick={() => {
              setPassword(generatePassword());
            }}
          >
            Generate a strong password
          </button>
          {password === "" ? null : (
            <CopyButton value={password} label="password" />
          )}
        </div>
        <p className="field-hint">
          Share the password with them privately, such as in a password manager.
          They can change it under Users once signed in.
        </p>
        <FailureNotice error={error} />
      </form>
    </ModalDialog>
  );
};

type OpenDialog = "add" | "password" | undefined;

export const UsersPage = ({ currentUserId }: { currentUserId: string }) => {
  const users = useApiData("/app/users");
  const [openDialog, setOpenDialog] = useState<OpenDialog>(undefined);
  /** The user whose Remove was pressed, kept while its dialog is open. */
  const [removing, setRemoving] = useState<unknown>(undefined);
  const [status, setStatus] = useState("");
  const { error, isBusy, runAction } = useActionRunner();
  const rows = readRecords(users.data, "users");
  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone listed here can sign in and manage everything."
        actions={
          <>
            <button
              type="button"
              className="button"
              aria-haspopup="dialog"
              onClick={() => {
                setStatus("");
                setOpenDialog("password");
              }}
            >
              <KeyIcon size={16} />
              Change your password
            </button>
            <button
              type="button"
              className="button button-primary"
              aria-haspopup="dialog"
              onClick={() => {
                setStatus("");
                setOpenDialog("add");
              }}
            >
              <PlusIcon size={16} />
              Add user
            </button>
          </>
        }
      />
      {status === "" ? null : <StatusLine message={status} />}
      <LoadingState isLoading={users.isLoading} />
      <FailureNotice error={users.error} />
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Added</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => (
              <tr key={readText(user, "id")}>
                <td>
                  {readText(user, "email")}
                  {readText(user, "id") === currentUserId ? (
                    <span className="badge user-you">You</span>
                  ) : null}
                </td>
                <td>{formatDateTime(readText(user, "createdAt"))}</td>
                <td className="table-actions">
                  {readText(user, "id") === currentUserId ? null : (
                    <button
                      type="button"
                      className="button-small button-danger"
                      aria-haspopup="dialog"
                      aria-label={`Remove ${readText(user, "email")}`}
                      onClick={() => {
                        setStatus("");
                        setRemoving(user);
                      }}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ChangePasswordDialog
        isOpen={openDialog === "password"}
        onClose={() => {
          setOpenDialog(undefined);
        }}
        onChanged={() => {
          setStatus("Your password was changed.");
        }}
      />
      <AddUserDialog
        isOpen={openDialog === "add"}
        onClose={() => {
          setOpenDialog(undefined);
        }}
        onAdded={(email) => {
          setStatus(`${email} was added and can sign in now.`);
          users.reload();
        }}
      />
      <ConfirmDeleteDialog
        isOpen={removing !== undefined}
        title="Remove this user?"
        summary={
          <>
            <strong>{readText(removing, "email")}</strong> will be removed.
          </>
        }
        details={[
          { label: "Email", value: readText(removing, "email") },
          {
            label: "Added",
            value: formatDateTime(readText(removing, "createdAt")),
          },
        ]}
        consequences={[
          "They can no longer sign in, and are signed out everywhere straight away.",
          "Everything they made stays: templates, headers, footers, configurations, API keys and settings.",
          "To let them back in, add them again with a new password.",
        ]}
        confirmLabel="Remove user"
        busyLabel="Removing…"
        isBusy={isBusy}
        error={removing === undefined ? undefined : error}
        onCancel={() => {
          setRemoving(undefined);
        }}
        onConfirm={() => {
          const email = readText(removing, "email");
          runAction(
            () =>
              requestJson(`/app/users/${readText(removing, "id")}`, {
                method: "DELETE",
              }),
            () => {
              setRemoving(undefined);
              setStatus(`${email} was removed.`);
              users.reload();
            },
          );
        }}
      />
    </>
  );
};
