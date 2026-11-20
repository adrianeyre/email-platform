import { AffectedList, ConfirmDeleteDialog } from "./confirm-delete-dialog.js";
import { useState } from "react";
import { PlusIcon } from "./icons.js";
import { readRecords, readText, requestJson } from "./api-client.js";
import { navigateTo } from "./router.js";
import {
  AppLink,
  EmptyState,
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

const api = "/app/configurations";

/** How a configuration's from address reads, such as "Wizzaroo <no-reply@example.com>". */
export const describeFrom = (configuration: unknown): string => {
  const fromEmail = readText(configuration, "fromEmail");
  const fromName = readText(configuration, "fromName");
  return fromName === "" ? fromEmail : `${fromName} <${fromEmail}>`;
};

export const ConfigurationsPage = () => {
  const list = useApiData(api);
  const rows = readRecords(list.data, "configurations");
  return (
    <>
      <PageHeader
        title="Configuration"
        description="Settings shared by templates, such as the from name and address they are sent with. A send's own from address still wins."
        actions={
          <AppLink href="/configurations/new" className="button button-primary">
            <PlusIcon />
            New configuration
          </AppLink>
        }
      />
      <LoadingState isLoading={list.isLoading} />
      <FailureNotice error={list.error} />
      {rows.length === 0 && !list.isLoading ? (
        <EmptyState>No configurations yet.</EmptyState>
      ) : (
        <div
          className="table-scroll"
          role="region"
          aria-label="Configurations"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">From</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={readText(row, "id")}>
                  <td>
                    <AppLink href={`/configurations/${readText(row, "id")}`}>
                      {readText(row, "name")}
                    </AppLink>
                  </td>
                  <td>{describeFrom(row)}</td>
                  <td>{formatDateTime(readText(row, "updatedAt"))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

interface ConfigurationForm {
  name: string;
  fromEmail: string;
  fromName: string;
}

const ConfigurationEditor = ({
  configurationId,
  initial,
  usedBy,
}: {
  configurationId: string | undefined;
  initial: ConfigurationForm;
  usedBy: readonly { id: string; name: string }[];
}) => {
  const [form, setForm] = useState(initial);
  const [status, setStatus] = useState("");
  const { error, isBusy, runAction } = useActionRunner();
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const update = (change: Partial<ConfigurationForm>) => {
    setForm((previous) => ({ ...previous, ...change }));
    setStatus("");
  };
  const save = () => {
    runAction(
      () =>
        configurationId === undefined
          ? requestJson(api, { method: "POST", body: form })
          : requestJson(`${api}/${configurationId}`, {
              method: "PUT",
              body: form,
            }),
      (result) => {
        if (configurationId === undefined) {
          navigateTo(`/configurations/${readText(result, "id")}`);
        } else {
          setStatus("Saved.");
        }
      },
    );
  };
  return (
    <>
      <PageHeader
        title={
          configurationId === undefined
            ? "New configuration"
            : initial.name || "Configuration"
        }
        description="Templates using this configuration are sent from its name and address, unless the send gives its own from address."
        actions={
          configurationId === undefined ? undefined : (
            <>
              <button
                type="button"
                className="button button-danger"
                aria-haspopup="dialog"
                disabled={isBusy}
                onClick={() => {
                  setDeleteOpen(true);
                }}
              >
                Delete
              </button>
              <ConfirmDeleteDialog
                isOpen={isDeleteOpen}
                title="Delete this configuration?"
                summary={
                  <>
                    The configuration <strong>{initial.name}</strong> will be
                    deleted.
                  </>
                }
                details={[
                  { label: "Name", value: initial.name },
                  { label: "Sends from", value: describeFrom(initial) },
                  { label: "ID", value: configurationId, isMono: true },
                  {
                    label: "Used by",
                    value:
                      usedBy.length === 0
                        ? "No templates"
                        : `${String(usedBy.length)} template${usedBy.length === 1 ? "" : "s"}`,
                  },
                ]}
                consequences={[
                  usedBy.length === 0 ? (
                    "No template uses it, so no email changes."
                  ) : (
                    <>
                      {usedBy.length === 1
                        ? "This template is"
                        : `These ${String(usedBy.length)} templates are`}{" "}
                      sent from the default from address in Delivery instead,
                      unless a send gives its own:
                      <AffectedList label="Templates using it" items={usedBy} />
                    </>
                  ),
                  "Emails already sent keep the from address they were sent with, in Logs.",
                ]}
                confirmLabel="Delete configuration"
                isBusy={isBusy}
                error={isDeleteOpen ? error : undefined}
                onCancel={() => {
                  setDeleteOpen(false);
                }}
                onConfirm={() => {
                  runAction(
                    () =>
                      requestJson(`${api}/${configurationId}`, {
                        method: "DELETE",
                      }),
                    () => {
                      setDeleteOpen(false);
                      navigateTo("/configurations");
                    },
                  );
                }}
              />
            </>
          )
        }
      />
      <form className="stack-form" onSubmit={submitForm(save)}>
        <TextField
          label="Name"
          value={form.name}
          onChange={(name) => {
            update({ name });
          }}
          hint="Shown when choosing a configuration for a template."
          autoComplete="off"
          isRequired
        />
        <TextField
          label="From email address"
          type="email"
          value={form.fromEmail}
          onChange={(fromEmail) => {
            update({ fromEmail });
          }}
          placeholder="no-reply@example.com"
          autoComplete="off"
          isRequired
        />
        <TextField
          label="From name"
          value={form.fromName}
          onChange={(fromName) => {
            update({ fromName });
          }}
          hint="Shown with the address in the reader's inbox. Leave it empty to send with the address alone."
          placeholder="My App"
          autoComplete="off"
        />
        <FailureNotice error={error} />
        <div className="actions">
          <button
            type="submit"
            className="button button-primary"
            disabled={isBusy}
          >
            {configurationId === undefined ? "Create configuration" : "Save"}
          </button>
          <StatusLine message={status} />
        </div>
      </form>
      {configurationId === undefined ? null : (
        <section className="panel" aria-labelledby="used-by-heading">
          <h2 id="used-by-heading">Used by</h2>
          {usedBy.length === 0 ? (
            <p className="muted">No templates use this configuration yet.</p>
          ) : (
            <ul>
              {usedBy.map((template) => (
                <li key={template.id}>
                  <AppLink href={`/templates/${template.id}`}>
                    {template.name}
                  </AppLink>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
};

export const ConfigurationPage = ({
  configurationId,
}: {
  configurationId: string | undefined;
}) => {
  const configuration = useApiData(
    configurationId === undefined ? undefined : `${api}/${configurationId}`,
  );
  if (configurationId === undefined) {
    return (
      <ConfigurationEditor
        configurationId={undefined}
        initial={{ name: "", fromEmail: "", fromName: "" }}
        usedBy={[]}
      />
    );
  }
  if (configuration.data === undefined) {
    return (
      <>
        <LoadingState isLoading={configuration.isLoading} />
        <FailureNotice error={configuration.error} />
      </>
    );
  }
  return (
    <ConfigurationEditor
      key={configurationId}
      configurationId={configurationId}
      initial={{
        name: readText(configuration.data, "name"),
        fromEmail: readText(configuration.data, "fromEmail"),
        fromName: readText(configuration.data, "fromName"),
      }}
      usedBy={readRecords(configuration.data, "usedBy").map((row) => ({
        id: readText(row, "id"),
        name: readText(row, "name"),
      }))}
    />
  );
};
