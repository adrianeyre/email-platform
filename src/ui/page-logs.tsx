import { useState } from "react";
import {
  readFlag,
  readNumber,
  readRecords,
  readText,
  readTexts,
} from "./api-client.js";
import { buildQueryString, toIsoDateTime } from "./query-string.js";
import {
  AppLink,
  Badge,
  EmptyState,
  FailureNotice,
  formatDateTime,
  LoadingState,
  PageHeader,
  SelectField,
  submitForm,
  TextField,
} from "./ui-parts.js";
import { useApiData } from "./use-api-data.js";

const statusTones: Record<string, string> = {
  queued: "pending",
  sent: "delivered",
  failed: "failed",
};

const StatusBadge = ({ status }: { status: string }) => (
  <Badge label={status} tone={statusTones[status] ?? "pending"} />
);

interface LogFilters {
  search: string;
  status: string;
  after: string;
  before: string;
}

const emptyFilters: LogFilters = {
  search: "",
  status: "",
  after: "",
  before: "",
};

export const LogsPage = () => {
  const [draft, setDraft] = useState(emptyFilters);
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const logs = useApiData(
    `/app/messages${buildQueryString({
      search: filters.search,
      status: filters.status,
      after: toIsoDateTime(filters.after),
      before: toIsoDateTime(filters.before),
      page: page === 1 ? undefined : page,
    })}`,
  );
  const rows = readRecords(logs.data, "messages");
  const total = readNumber(logs.data, "total") ?? 0;
  const pageSize = readNumber(logs.data, "pageSize") ?? 50;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const update = (change: Partial<LogFilters>) => {
    setDraft((current) => ({ ...current, ...change }));
  };
  return (
    <>
      <PageHeader title="Logs" description="Every email sent, newest first." />
      <form
        className="filter-bar"
        onSubmit={submitForm(() => {
          setFilters(draft);
          setPage(1);
        })}
      >
        <TextField
          label="Search"
          value={draft.search}
          onChange={(search) => {
            update({ search });
          }}
          placeholder="Recipient, sender or subject"
        />
        <SelectField
          label="Status"
          value={draft.status}
          onChange={(status) => {
            update({ status });
          }}
          options={[
            { value: "", label: "Any" },
            { value: "queued", label: "Queued" },
            { value: "sent", label: "Sent" },
            { value: "failed", label: "Failed" },
          ]}
        />
        <TextField
          label="From"
          type="datetime-local"
          value={draft.after}
          onChange={(after) => {
            update({ after });
          }}
        />
        <TextField
          label="To"
          type="datetime-local"
          value={draft.before}
          onChange={(before) => {
            update({ before });
          }}
        />
        <button type="submit" className="button">
          Search
        </button>
      </form>
      <LoadingState isLoading={logs.isLoading} />
      <FailureNotice error={logs.error} />
      {rows.length === 0 && !logs.isLoading ? (
        <EmptyState>No emails match.</EmptyState>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>To</th>
                <th>Subject</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((message) => (
                <tr key={readText(message, "id")}>
                  <td>
                    <AppLink href={`/logs/${readText(message, "id")}`}>
                      {formatDateTime(readText(message, "createdAt"))}
                    </AppLink>
                  </td>
                  <td>{readTexts(message, "to").join(", ")}</td>
                  <td>{readText(message, "subject")}</td>
                  <td>
                    <StatusBadge status={readText(message, "status")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav className="actions" aria-label="Pages">
        <button
          type="button"
          className="button-small"
          disabled={page <= 1}
          onClick={() => {
            setPage(page - 1);
          }}
        >
          Newer
        </button>
        <span className="muted">
          Page {page} of {pageCount} ({total} emails)
        </span>
        <button
          type="button"
          className="button-small"
          disabled={page >= pageCount}
          onClick={() => {
            setPage(page + 1);
          }}
        >
          Older
        </button>
      </nav>
    </>
  );
};

const DetailRow = ({ label, value }: { label: string; value: string }) =>
  value === "" ? null : (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );

export const MessagePage = ({ messageId }: { messageId: string }) => {
  const message = useApiData(`/app/messages/${encodeURIComponent(messageId)}`);
  const data = message.data;
  if (data === undefined) {
    return (
      <>
        <LoadingState isLoading={message.isLoading} />
        <FailureNotice error={message.error} />
      </>
    );
  }
  const html = readText(data, "html");
  const templateId = readText(data, "templateId");
  return (
    <>
      <PageHeader
        title={readText(data, "subject")}
        actions={<StatusBadge status={readText(data, "status")} />}
      />
      {readText(data, "error") === "" ? null : (
        <div className="notice notice-error" role="alert">
          <p>{readText(data, "error")}</p>
        </div>
      )}
      <dl className="details">
        <DetailRow label="ID" value={readText(data, "id")} />
        <DetailRow
          label="Queued"
          value={formatDateTime(readText(data, "createdAt"))}
        />
        <DetailRow
          label="Sent"
          value={
            readText(data, "sentAt") === ""
              ? ""
              : formatDateTime(readText(data, "sentAt"))
          }
        />
        <DetailRow label="From" value={readText(data, "from")} />
        <DetailRow label="To" value={readTexts(data, "to").join(", ")} />
        <DetailRow label="Cc" value={readTexts(data, "cc").join(", ")} />
        <DetailRow label="Bcc" value={readTexts(data, "bcc").join(", ")} />
        <DetailRow label="Reply-To" value={readText(data, "replyTo")} />
        <DetailRow label="Attempts" value={readText(data, "attempts")} />
        <DetailRow
          label="Provider message ID"
          value={readText(data, "providerMessageId")}
        />
      </dl>
      {templateId === "" ? null : (
        <p>
          Sent from{" "}
          <AppLink href={`/templates/${templateId}`}>this template</AppLink>.
        </p>
      )}
      {readFlag(data, "isBodyKept") ? (
        <>
          {html === "" ? null : (
            <iframe
              title="Email as it will be sent"
              className="preview-frame"
              sandbox=""
              srcDoc={html}
            />
          )}
          <details className="details" open={html === ""}>
            <summary>Plain text</summary>
            <pre className="wrap">{readText(data, "text")}</pre>
          </details>
        </>
      ) : (
        <p className="muted">
          The email itself isn&apos;t kept once it has been sent or has failed,
          so the links in it, like password resets and invites, are not stored
          here.
        </p>
      )}
    </>
  );
};
