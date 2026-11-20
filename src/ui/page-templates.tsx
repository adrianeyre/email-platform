import {
  CodeIcon,
  MonitorIcon,
  MoonIcon,
  PhoneIcon,
  PlusIcon,
  SunIcon,
} from "./icons.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { builtInEmails, builtInParts } from "../templates/built-in-emails.js";
import { partBlocks } from "../templates/compose.js";
import { parseDesign, type Design } from "../templates/design/model.js";
import {
  renderDesignFragment,
  renderDesignHtml,
} from "../templates/design/render-html.js";
import { readRecords, readText, requestJson } from "./api-client.js";
import { CodeEditor } from "./code-editor.js";
import { AffectedList, ConfirmDeleteDialog } from "./confirm-delete-dialog.js";
import { Designer } from "./designer/designer.js";
import {
  recordChange,
  redo,
  startHistory,
  undo,
  type History,
} from "./designer/history.js";
import { starters } from "./designer/starters.js";
import { createPreviewScheduler } from "./preview-scheduler.js";
import { withPreviewScheme, type PreviewScheme } from "./preview-scheme.js";
import { describeFrom } from "./page-configurations.js";
import { navigateTo } from "./router.js";
import {
  blankTemplateForm,
  buildPartBody,
  buildTemplateBody,
  changeName,
  changeSlug,
  designFromHtml,
  findFormSlugProblem,
  findMissingSamples,
  hasHeadStyles,
  listVariableNames,
  parseSampleVariables,
  readTemplateForm,
  templateHtml,
  type TemplateForm,
} from "./template-form.js";
import {
  AppLink,
  confirmAction,
  CopyButton,
  EmptyState,
  FailureNotice,
  formatDateTime,
  LoadingState,
  PageHeader,
  SelectField,
  StatusLine,
  submitForm,
  TextField,
  useActionRunner,
} from "./ui-parts.js";
import { useApiData } from "./use-api-data.js";

export type EditorKind = "template" | "header" | "footer";

interface KindDetails {
  api: string;
  path: string;
  listKey: string;
  singular: string;
  plural: string;
  description: string;
}

export const editorKinds: Record<EditorKind, KindDetails> = {
  template: {
    api: "/app/templates",
    path: "/templates",
    listKey: "templates",
    singular: "template",
    plural: "Templates",
    description:
      "Send a template by its slug, name or ID with POST /v1/messages and your variables.",
  },
  header: {
    api: "/app/headers",
    path: "/headers",
    listKey: "headers",
    singular: "header",
    plural: "Headers",
    description:
      "Content shown above a template's own, such as a logo. Change a header and every template using it sends with the change.",
  },
  footer: {
    api: "/app/footers",
    path: "/footers",
    listKey: "footers",
    singular: "footer",
    plural: "Footers",
    description:
      "Content shown below a template's own, such as contact details or legal notes. Every template using it sends with the change.",
  },
};

export const TemplatesPage = ({ kind = "template" }: { kind?: EditorKind }) => {
  const details = editorKinds[kind];
  const list = useApiData(details.api);
  const rows = readRecords(list.data, details.listKey);
  return (
    <>
      <PageHeader
        title={details.plural}
        description={details.description}
        actions={
          <AppLink
            href={`${details.path}/new`}
            className="button button-primary"
          >
            <PlusIcon />
            New {details.singular}
          </AppLink>
        }
      />
      <LoadingState isLoading={list.isLoading} />
      <FailureNotice error={list.error} />
      {rows.length === 0 && !list.isLoading ? (
        <EmptyState>No {details.plural.toLowerCase()} yet.</EmptyState>
      ) : (
        <div
          className="table-scroll"
          role="region"
          aria-label={details.plural}
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                {kind === "template" ? (
                  <>
                    <th scope="col">Subject</th>
                    <th scope="col">Slug</th>
                  </>
                ) : (
                  <th scope="col">ID</th>
                )}
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={readText(row, "id")}>
                  <td>
                    <AppLink href={`${details.path}/${readText(row, "id")}`}>
                      {readText(row, "name")}
                    </AppLink>
                  </td>
                  {kind === "template" ? (
                    <>
                      <td>{readText(row, "subject")}</td>
                      <td className="mono">{readText(row, "slug")}</td>
                    </>
                  ) : (
                    <td className="mono">{readText(row, "id")}</td>
                  )}
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

interface Preview {
  subject: string;
  html: string;
  text: string;
}

const usePreview = (
  form: TemplateForm & { html: string },
  samples: Record<string, unknown>,
) => {
  const [preview, setPreview] = useState<Preview | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const scheduler = useMemo(
    () =>
      createPreviewScheduler<{
        subject: string;
        html: string;
        text: string;
        variables: Record<string, unknown>;
        design: Design | null;
        headerId: string | null;
        footerId: string | null;
      }>((input) => {
        requestJson("/app/templates/preview", {
          method: "POST",
          body: { ...input, text: input.text === "" ? null : input.text },
        }).then(
          (result) => {
            setError(undefined);
            setPreview({
              subject: readText(result, "subject"),
              html: readText(result, "html"),
              text: readText(result, "text"),
            });
          },
          (failure: unknown) => {
            setError(failure);
          },
        );
      }),
    [],
  );
  useEffect(() => {
    scheduler.schedulePreview({
      subject: form.subject,
      html: form.html,
      text: form.text,
      variables: samples,
      design: form.design ?? null,
      headerId: form.headerId === "" ? null : form.headerId,
      footerId: form.footerId === "" ? null : form.footerId,
    });
  }, [
    scheduler,
    form.subject,
    form.html,
    form.text,
    form.design,
    form.headerId,
    form.footerId,
    samples,
  ]);
  useEffect(
    () => () => {
      scheduler.cancelPreview();
    },
    [scheduler],
  );
  return { preview, error };
};

const SendTestPanel = ({
  templateId,
  samples,
}: {
  templateId: string;
  samples: Record<string, unknown>;
}) => {
  const [to, setTo] = useState("");
  const [messageId, setMessageId] = useState<string | undefined>(undefined);
  const { error, isBusy, runAction } = useActionRunner();
  return (
    <section className="panel">
      <h2>Send a test</h2>
      <p className="muted">
        Sends the saved template with the sample variables through your SMTP
        provider.
      </p>
      <form
        className="inline-form"
        onSubmit={submitForm(() => {
          runAction(
            () =>
              requestJson(`/app/templates/${templateId}/test`, {
                method: "POST",
                body: { to, variables: samples },
              }),
            (result) => {
              setMessageId(readText(result, "id"));
            },
          );
        })}
      >
        <TextField
          label="To"
          type="email"
          value={to}
          onChange={setTo}
          isRequired
        />
        <button type="submit" className="button" disabled={isBusy}>
          Send test
        </button>
      </form>
      <FailureNotice error={error} />
      {messageId === undefined ? null : (
        <p role="status">
          Queued.{" "}
          <AppLink href={`/logs/${messageId}`}>See it in the logs</AppLink>
        </p>
      )}
    </section>
  );
};

type EditorTab = "design" | "html" | "preview" | "variables";

const useDesignHistory = (initial: Design | undefined) => {
  const [history, setHistory] = useState<History<Design | undefined>>(() =>
    startHistory(initial),
  );
  return {
    design: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    change: (next: Design | undefined, key?: string) => {
      setHistory((current) => recordChange(current, next, key, Date.now()));
    },
    undo: () => {
      setHistory(undo);
    },
    redo: () => {
      setHistory(redo);
    },
  };
};

const PreviewPanel = ({
  preview,
  previewError,
  missingSamples,
  templateId,
  samples,
  kind,
}: {
  preview: Preview | undefined;
  previewError: unknown;
  missingSamples: readonly string[];
  templateId: string | undefined;
  samples: Record<string, unknown>;
  kind: EditorKind;
}) => {
  const [width, setWidth] = useState<"desktop" | "phone">("desktop");
  const [scheme, setScheme] = useState<PreviewScheme>("light");
  return (
    <section aria-label="Preview" className="preview-panel">
      <div className="preview-toolbar">
        <p className="muted small">
          Rendered by the server with the sample variables, exactly as it will
          be sent.
        </p>
        <div className="segmented" role="radiogroup" aria-label="Preview width">
          <button
            type="button"
            role="radio"
            aria-checked={width === "desktop"}
            onClick={() => {
              setWidth("desktop");
            }}
          >
            <MonitorIcon size={16} />
            Desktop
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={width === "phone"}
            onClick={() => {
              setWidth("phone");
            }}
          >
            <PhoneIcon size={16} />
            Phone
          </button>
        </div>
        <div
          className="segmented"
          role="radiogroup"
          aria-label="Preview colour scheme"
        >
          <button
            type="button"
            role="radio"
            aria-checked={scheme === "light"}
            onClick={() => {
              setScheme("light");
            }}
          >
            <SunIcon size={16} />
            Light
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={scheme === "dark"}
            title="As mail apps that darken emails, such as Gmail and Outlook, show it"
            onClick={() => {
              setScheme("dark");
            }}
          >
            <MoonIcon size={16} />
            Dark
          </button>
        </div>
      </div>
      {missingSamples.length === 0 ? null : (
        <p className="notice">
          No sample value for: {missingSamples.join(", ")}
        </p>
      )}
      <FailureNotice error={previewError} />
      {preview === undefined ? null : (
        <>
          {kind === "template" ? (
            <div className="inbox-line">
              <strong>{preview.subject}</strong>
            </div>
          ) : null}
          <div className={`preview-device preview-${width}`}>
            <iframe
              title={`HTML preview, ${scheme === "dark" ? "dark" : "light"} mode`}
              className={`preview-frame preview-${scheme}`}
              sandbox=""
              srcDoc={withPreviewScheme(preview.html, scheme)}
            />
          </div>
          <details className="details-block">
            <summary>Plain text part</summary>
            <pre className="wrap">{preview.text}</pre>
          </details>
        </>
      )}
      {kind !== "template" ? null : templateId === undefined ? (
        <p className="muted">Save the template to send a test.</p>
      ) : (
        <SendTestPanel templateId={templateId} samples={samples} />
      )}
    </section>
  );
};

/** A Header or Footer chosen for a Template, loaded to show it locked in the designer. */
const usePart = (kind: "header" | "footer", id: string) => {
  const data = useApiData(
    id === "" ? undefined : `${editorKinds[kind].api}/${id}`,
  );
  return useMemo(() => {
    if (id === "" || data.data === undefined) {
      return undefined;
    }
    return {
      id,
      name: readText(data.data, "name"),
      html: readText(data.data, "html"),
      design: isRecordValue(data.data) ? data.data.design : undefined,
    };
  }, [id, data.data]);
};

const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const PartPicker = ({
  kind,
  value,
  onChange,
}: {
  kind: "header" | "footer";
  value: string;
  onChange: (id: string) => void;
}) => {
  const details = editorKinds[kind];
  const list = useApiData(details.api);
  const rows = readRecords(list.data, details.listKey);
  return (
    <SelectField
      label={kind === "header" ? "Header" : "Footer"}
      value={value}
      onChange={onChange}
      options={[
        { value: "", label: `No ${details.singular}` },
        ...rows.map((row) => ({
          value: readText(row, "id"),
          label: readText(row, "name"),
        })),
      ]}
    />
  );
};

const ConfigurationPicker = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) => {
  const list = useApiData("/app/configurations");
  const rows = readRecords(list.data, "configurations");
  const chosen = rows.find((row) => readText(row, "id") === value);
  return (
    <SelectField
      label="Configuration"
      value={value}
      onChange={onChange}
      options={[
        { value: "", label: "None" },
        ...rows.map((row) => ({
          value: readText(row, "id"),
          label: readText(row, "name"),
        })),
      ]}
      hint={
        chosen === undefined
          ? "Sends from the default from address in Delivery unless the request gives a from address."
          : `Sends from ${describeFrom(chosen)} unless the request gives a from address.`
      }
    />
  );
};

interface UsingTemplate {
  id: string;
  name: string;
}

const countTemplates = (count: number) =>
  `${String(count)} template${count === 1 ? "" : "s"}`;

/** Asks before deleting a template, header or footer, with what it is and what deleting it changes. */
const DeleteTemplateDialog = ({
  kind,
  isOpen,
  templateId,
  form,
  savedSlug,
  updatedAt,
  usedBy,
  partNames,
  isBusy,
  error,
  onConfirm,
  onCancel,
}: {
  kind: EditorKind;
  isOpen: boolean;
  templateId: string;
  form: TemplateForm;
  savedSlug: string;
  updatedAt: string;
  usedBy: readonly UsingTemplate[];
  partNames: { header: string; footer: string; configuration: string };
  isBusy: boolean;
  error: unknown;
  onConfirm: () => void;
  onCancel: () => void;
}) => {
  const details = editorKinds[kind];
  const name = form.name || `This ${details.singular}`;
  const changed =
    updatedAt === ""
      ? []
      : [{ label: "Last changed", value: formatDateTime(updatedAt) }];
  if (kind === "template") {
    return (
      <ConfirmDeleteDialog
        isOpen={isOpen}
        title="Delete this template?"
        summary={
          <>
            The template <strong>{name}</strong> will be deleted.
          </>
        }
        details={[
          { label: "Name", value: name },
          ...(savedSlug === ""
            ? []
            : [{ label: "Slug", value: savedSlug, isMono: true }]),
          { label: "ID", value: templateId, isMono: true },
          { label: "Subject", value: form.subject || "None" },
          {
            label: "Configuration",
            value: partNames.configuration || "None",
          },
          { label: "Header", value: partNames.header || "None" },
          { label: "Footer", value: partNames.footer || "None" },
          ...changed,
        ]}
        consequences={[
          <>
            Applications sending it by its slug
            {savedSlug === "" ? "" : ` (${savedSlug})`}, name or ID get a{" "}
            <strong>404 not found</strong> error, and their email is not sent.
          </>,
          "Emails already sent with it stay in Logs, as they were sent.",
          "Its header, footer and configuration are kept, for the templates that still use them.",
        ]}
        confirmLabel="Delete template"
        isBusy={isBusy}
        error={error}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
  }
  return (
    <ConfirmDeleteDialog
      isOpen={isOpen}
      title={`Delete this ${details.singular}?`}
      summary={
        <>
          The {details.singular} <strong>{name}</strong> will be deleted.
        </>
      }
      details={[
        { label: "Name", value: name },
        { label: "ID", value: templateId, isMono: true },
        {
          label: "Used by",
          value:
            usedBy.length === 0
              ? "No templates"
              : countTemplates(usedBy.length),
        },
        ...changed,
      ]}
      consequences={[
        usedBy.length === 0 ? (
          `No template uses it, so no email changes.`
        ) : (
          <>
            {usedBy.length === 1
              ? "This template is"
              : `These ${countTemplates(usedBy.length)} are`}{" "}
            sent without a {details.singular} from now on:
            <AffectedList label="Templates using it" items={usedBy} />
          </>
        ),
        "Emails already sent stay in Logs, as they were sent.",
      ]}
      confirmLabel={`Delete ${details.singular}`}
      isBusy={isBusy}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
};

const TemplateEditor = ({
  templateId,
  initial,
  kind,
  updatedAt = "",
  usedBy = [],
}: {
  templateId: string | undefined;
  initial: TemplateForm;
  kind: EditorKind;
  updatedAt?: string;
  usedBy?: readonly UsingTemplate[];
}) => {
  const details = editorKinds[kind];
  const isTemplate = kind === "template";
  const [form, setForm] = useState(initial);
  const history = useDesignHistory(initial.design);
  const design = history.design;
  const [tab, setTab] = useState<EditorTab>(
    initial.design === undefined ? "html" : "design",
  );
  const [status, setStatus] = useState("");
  const [savedSlug, setSavedSlug] = useState(initial.slug);
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const configurations = useApiData(
    isTemplate && templateId !== undefined ? "/app/configurations" : undefined,
  );
  const chosenConfiguration = readRecords(
    configurations.data,
    "configurations",
  ).find((row) => readText(row, "id") === form.configurationId);
  const configurationName =
    chosenConfiguration === undefined
      ? ""
      : readText(chosenConfiguration, "name");
  const { error, isBusy, runAction } = useActionRunner();
  const parsedSamples = useMemo(
    () => parseSampleVariables(form.sampleVariables),
    [form.sampleVariables],
  );
  const samples = useMemo(
    () => (parsedSamples.isValid ? parsedSamples.values : {}),
    [parsedSamples],
  );
  const current = useMemo(() => ({ ...form, design }), [form, design]);
  const html = useMemo(() => templateHtml(current), [current]);
  const { preview, error: previewError } = usePreview(
    {
      ...form,
      subject: isTemplate ? form.subject : details.singular,
      html,
      design,
    },
    samples,
  );
  const header = usePart("header", isTemplate ? form.headerId : "");
  const footer = usePart("footer", isTemplate ? form.footerId : "");
  const lockedPart = (
    part: ReturnType<typeof usePart>,
    partKind: "header" | "footer",
  ) =>
    part === undefined || design === undefined
      ? undefined
      : {
          label: `${partKind === "header" ? "Header" : "Footer"}: ${part.name}`,
          href: `${editorKinds[partKind].path}/${part.id}`,
          html: renderDesignFragment({
            ...design,
            blocks: partBlocks(part),
          }),
        };
  const missingSamples = findMissingSamples(form.variables, samples);
  const variableNames = useMemo(
    () => listVariableNames(form.variables, samples),
    [form.variables, samples],
  );
  const body = useMemo(
    () =>
      isTemplate
        ? buildTemplateBody(current, samples)
        : buildPartBody(current, samples),
    [current, samples, isTemplate],
  );
  const bodyKey = JSON.stringify(body);
  const [savedKey, setSavedKey] = useState(() =>
    templateId === undefined ? "" : bodyKey,
  );
  const isDirty = bodyKey !== savedKey;

  const update = (change: Partial<TemplateForm>) => {
    setForm((previous) => ({ ...previous, ...change }));
    setStatus("");
  };

  const slugProblem = isTemplate ? findFormSlugProblem(form) : undefined;

  const save = () => {
    if (slugProblem !== undefined) {
      setStatus("Fix the slug before saving.");
      return;
    }
    if (!parsedSamples.isValid) {
      setTab("variables");
      return;
    }
    runAction(
      () =>
        templateId === undefined
          ? requestJson(details.api, { method: "POST", body })
          : requestJson(`${details.api}/${templateId}`, {
              method: "PUT",
              body,
            }),
      (result) => {
        setSavedKey(bodyKey);
        if (templateId === undefined) {
          navigateTo(`${details.path}/${readText(result, "id")}`);
        } else {
          setSavedSlug(readText(result, "slug"));
          setStatus("Saved.");
        }
      },
    );
  };
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!isDirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [isDirty]);

  const tabs: readonly { id: EditorTab; label: string }[] = [
    { id: "design", label: "Design" },
    { id: "html", label: "HTML" },
    { id: "preview", label: "Preview" },
    {
      id: "variables",
      label: isTemplate ? "Variables and plain text" : "Sample variables",
    },
  ];

  return (
    <div className="template-editor">
      <PageHeader
        title={
          templateId === undefined
            ? `New ${details.singular}`
            : form.name ||
              `${details.singular.charAt(0).toUpperCase()}${details.singular.slice(1)}`
        }
        actions={
          templateId === undefined ? undefined : (
            <>
              {isTemplate && savedSlug !== "" ? (
                <>
                  <span className="mono">{savedSlug}</span>
                  <CopyButton value={savedSlug} label="template slug" />
                </>
              ) : null}
              <span className="mono">{templateId}</span>
              <CopyButton value={templateId} label={`${details.singular} ID`} />
              <button
                type="button"
                className="button button-danger"
                aria-haspopup="dialog"
                onClick={() => {
                  setDeleteOpen(true);
                }}
              >
                Delete
              </button>
              <DeleteTemplateDialog
                kind={kind}
                isOpen={isDeleteOpen}
                templateId={templateId}
                form={form}
                savedSlug={savedSlug}
                updatedAt={updatedAt}
                usedBy={usedBy}
                partNames={{
                  header: header?.name ?? "",
                  footer: footer?.name ?? "",
                  configuration: configurationName,
                }}
                isBusy={isBusy}
                error={isDeleteOpen ? error : undefined}
                onCancel={() => {
                  setDeleteOpen(false);
                }}
                onConfirm={() => {
                  runAction(
                    () =>
                      requestJson(`${details.api}/${templateId}`, {
                        method: "DELETE",
                      }),
                    () => {
                      setDeleteOpen(false);
                      setSavedKey(bodyKey);
                      navigateTo(details.path);
                    },
                  );
                }}
              />
            </>
          )
        }
      />
      <form className="template-fields" onSubmit={submitForm(save)}>
        <TextField
          label="Name"
          value={form.name}
          onChange={(name) => {
            update(changeName(form, name));
          }}
          hint={
            isTemplate
              ? "Applications can send by this name as templateName."
              : `Shown when choosing a ${details.singular} for a template.`
          }
          isRequired
        />
        {isTemplate ? (
          <>
            <TextField
              label="Subject"
              value={form.subject}
              onChange={(subject) => {
                update({ subject });
              }}
              hint="Handlebars works here too, such as {{orderId}}"
              isRequired
            />
            <TextField
              label="Slug"
              value={form.slug}
              onChange={(slug) => {
                update(changeSlug(slug));
              }}
              hint="Applications can send by this as templateSlug. Lowercase letters, numbers and hyphens."
              error={slugProblem}
              autoComplete="off"
              isCode
              isRequired
            />
            <ConfigurationPicker
              value={form.configurationId}
              onChange={(configurationId) => {
                update({ configurationId });
              }}
            />
            <PartPicker
              kind="header"
              value={form.headerId}
              onChange={(headerId) => {
                update({ headerId });
              }}
            />
            <PartPicker
              kind="footer"
              value={form.footerId}
              onChange={(footerId) => {
                update({ footerId });
              }}
            />
          </>
        ) : null}
        <button type="submit" hidden>
          Save
        </button>
      </form>
      <div
        className="tabs"
        role="tablist"
        aria-label={`${details.singular} editor`}
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            onClick={() => {
              setTab(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="panel-design"
        aria-labelledby="tab-design"
        hidden={tab !== "design"}
      >
        {design === undefined ? (
          <div className="empty-state convert-panel">
            <h2>This {details.singular}&apos;s HTML was written by hand</h2>
            <p className="muted">
              Open it in the visual designer to add text, buttons, images and
              columns. Your current HTML is kept as an HTML block you can keep
              editing or replace.
            </p>
            {hasHeadStyles(form.html) ? (
              <p className="notice">
                Styles in the HTML's &lt;head&gt; are not carried over. Inline
                styles are.
              </p>
            ) : null}
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                history.change(designFromHtml(form.html));
              }}
            >
              Open in the visual designer
            </button>
          </div>
        ) : (
          <Designer
            design={design}
            onChange={(next, key) => {
              history.change(next, key);
              setStatus("");
            }}
            onUndo={history.undo}
            onRedo={history.redo}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            variables={variableNames}
            lockedTop={lockedPart(header, "header")}
            lockedBottom={lockedPart(footer, "footer")}
          />
        )}
      </div>
      <div
        role="tabpanel"
        id="panel-html"
        aria-labelledby="tab-html"
        hidden={tab !== "html"}
        className="html-panel"
      >
        {design === undefined ? (
          <div className="field">
            <span className="field-label">HTML</span>
            <CodeEditor
              label="HTML body"
              value={form.html}
              onChange={(next) => {
                update({ html: next });
              }}
            />
          </div>
        ) : (
          <>
            <div className="notice html-notice">
              <p>
                This HTML is made by the designer, with tables and inline styles
                that work across mail apps. Change it in the Design tab.
              </p>
              <button
                type="button"
                className="button-small"
                onClick={() => {
                  if (
                    confirmAction(
                      "Edit the HTML by hand? The template leaves the visual designer, and later design changes can't be made visually. Undo brings the design back.",
                    )
                  ) {
                    update({ html });
                    history.change(undefined);
                  }
                }}
              >
                Edit the HTML by hand
              </button>
            </div>
            <CodeEditor label="Generated HTML" value={html} isReadOnly />
          </>
        )}
      </div>
      <div
        role="tabpanel"
        id="panel-preview"
        aria-labelledby="tab-preview"
        hidden={tab !== "preview"}
      >
        <PreviewPanel
          preview={preview}
          previewError={previewError}
          missingSamples={missingSamples}
          templateId={templateId}
          samples={samples}
          kind={kind}
        />
      </div>
      <div
        role="tabpanel"
        id="panel-variables"
        aria-labelledby="tab-variables"
        hidden={tab !== "variables"}
        className="stack-form"
      >
        {isTemplate ? (
          <TextField
            label="Required variables"
            value={form.variables}
            onChange={(variables) => {
              update({ variables });
            }}
            hint="Comma-separated. Sending without one of these is refused. They are offered in the designer's variable menus."
          />
        ) : (
          <p className="muted">
            A {details.singular} is sent with the variables of the template
            using it, so it can use them too, such as {"{{email}}"}.
          </p>
        )}
        <label className="field">
          <span className="field-label">Sample variables (JSON)</span>
          <textarea
            rows={8}
            className="mono"
            value={form.sampleVariables}
            onChange={(event) => {
              update({ sampleVariables: event.target.value });
            }}
          />
          <span className="field-hint">
            Used for the preview and test sends.
          </span>
        </label>
        {parsedSamples.isValid ? null : (
          <p className="notice notice-error">{parsedSamples.message}</p>
        )}
        {missingSamples.length === 0 ? null : (
          <p className="muted">
            No sample value for: {missingSamples.join(", ")}
          </p>
        )}
        <label className="field" hidden={!isTemplate}>
          <span className="field-label">Plain text (optional)</span>
          <textarea
            rows={8}
            value={form.text}
            onChange={(event) => {
              update({ text: event.target.value });
            }}
          />
          <span className="field-hint">
            Left empty, the text part is generated from the HTML.
          </span>
        </label>
      </div>
      <div className="save-bar">
        <FailureNotice error={error} />
        <StatusLine
          message={status !== "" ? status : isDirty ? "Unsaved changes" : ""}
        />
        <button
          type="button"
          className="button button-primary"
          disabled={isBusy || !parsedSamples.isValid}
          onClick={save}
          title="Save (⌘S)"
        >
          {templateId === undefined ? `Create ${details.singular}` : "Save"}
        </button>
      </div>
    </div>
  );
};

const fillSamples = (html: string, samples: Record<string, unknown>) =>
  html
    .replaceAll(/\{\{#if [^}]*\}\}|\{\{\/if\}\}/gu, "")
    .replaceAll(/\{\{\s*([\w.]+)\s*\}\}/gu, (token, name: string) => {
      const value = samples[name];
      return typeof value === "string" || typeof value === "number"
        ? String(value).replaceAll("<", "&lt;")
        : token;
    });

const Thumbnail = ({
  design,
  samples,
}: {
  design: Design;
  samples: Record<string, unknown>;
}) => {
  const html = useMemo(
    () => fillSamples(renderDesignHtml(design), samples),
    [design, samples],
  );
  return (
    <div className="thumbnail" aria-hidden="true">
      <iframe
        title="Thumbnail"
        sandbox=""
        srcDoc={html}
        tabIndex={-1}
        loading="lazy"
      />
    </div>
  );
};

const PartStartChooser = ({
  kind,
  onPick,
}: {
  kind: "header" | "footer";
  onPick: (form: TemplateForm) => void;
}) => {
  const details = editorKinds[kind];
  const blank = starters.find((starter) => starter.id === "blank");
  return (
    <>
      <PageHeader
        title={`New ${details.singular}`}
        description={`Start blank, from HTML or from a built-in ${details.singular}.`}
      />
      <div className="gallery">
        {blank === undefined ? null : (
          <button
            type="button"
            className="gallery-card"
            onClick={() => {
              onPick({
                ...blankTemplateForm,
                variables: "",
                sampleVariables: "{}",
                design: blank.design(),
              });
            }}
          >
            <Thumbnail design={blank.design()} samples={{}} />
            <span className="gallery-name">Blank</span>
            <span className="muted small">Build it from blocks.</span>
          </button>
        )}
        <button
          type="button"
          className="gallery-card"
          onClick={() => {
            onPick({
              ...blankTemplateForm,
              html: "",
              variables: "",
              sampleVariables: "{}",
            });
          }}
        >
          <div className="thumbnail thumbnail-code" aria-hidden="true">
            <CodeIcon size={40} />
          </div>
          <span className="gallery-name">Write HTML by hand</span>
          <span className="muted small">
            A code editor with Handlebars highlighting.
          </span>
        </button>
        {builtInParts
          .filter((part) => part.kind === kind)
          .map((part) => (
            <button
              key={part.name}
              type="button"
              className="gallery-card"
              onClick={() => {
                onPick({
                  ...blankTemplateForm,
                  name: part.name,
                  variables: "",
                  sampleVariables: JSON.stringify(
                    part.sampleVariables,
                    null,
                    2,
                  ),
                  design: parseDesign(JSON.parse(JSON.stringify(part.design))),
                });
              }}
            >
              <Thumbnail design={part.design} samples={part.sampleVariables} />
              <span className="gallery-name">{part.name}</span>
              <span className="muted small">{part.description}</span>
            </button>
          ))}
      </div>
    </>
  );
};

/** The IDs of the Headers, Footers and Configurations with these names, to link a built-in email to them. */
const usePartIdsByName = () => {
  const headers = useApiData(editorKinds.header.api);
  const footers = useApiData(editorKinds.footer.api);
  const configurations = useApiData("/app/configurations");
  const lists = {
    header: readRecords(headers.data, editorKinds.header.listKey),
    footer: readRecords(footers.data, editorKinds.footer.listKey),
    configuration: readRecords(configurations.data, "configurations"),
  };
  return (kind: "header" | "footer" | "configuration", name: string) =>
    lists[kind]
      .filter((row) => readText(row, "name") === name)
      .map((row) => readText(row, "id"))[0] ?? "";
};

const StartChooser = ({ onPick }: { onPick: (form: TemplateForm) => void }) => {
  const categories = [...new Set(builtInEmails.map((email) => email.category))];
  const findPart = usePartIdsByName();
  return (
    <>
      <PageHeader
        title="New template"
        description="Start from a layout or a built-in email. Everything can be changed afterwards."
      />
      <h2>Layouts</h2>
      <div className="gallery">
        {starters.map((starter) => {
          const design = starter.design();
          return (
            <button
              key={starter.id}
              type="button"
              className="gallery-card"
              onClick={() => {
                onPick({
                  ...blankTemplateForm,
                  subject: starter.subject,
                  variables: starter.variables,
                  sampleVariables: JSON.stringify(
                    starter.sampleVariables,
                    null,
                    2,
                  ),
                  design: starter.design(),
                });
              }}
            >
              <Thumbnail design={design} samples={starter.sampleVariables} />
              <span className="gallery-name">{starter.name}</span>
              <span className="muted small">{starter.description}</span>
            </button>
          );
        })}
        <button
          type="button"
          className="gallery-card"
          onClick={() => {
            onPick(blankTemplateForm);
          }}
        >
          <div className="thumbnail thumbnail-code" aria-hidden="true">
            <CodeIcon size={40} />
          </div>
          <span className="gallery-name">Write HTML by hand</span>
          <span className="muted small">
            A code editor with Handlebars highlighting.
          </span>
        </button>
      </div>
      <h2>Start from a built-in email</h2>
      <p className="muted">
        Account, invite and security emails with their wording ready to go,
        using the Wizzaroo header, footer and configuration when they exist. Add
        them all at once with <code>pnpm cli templates:add-built-ins</code>.
      </p>
      {categories.map((category) => (
        <section key={category} aria-label={category}>
          <h3>{category}</h3>
          <div className="gallery">
            {builtInEmails
              .filter((email) => email.category === category)
              .map((email) => (
                <button
                  key={email.name}
                  type="button"
                  className="gallery-card"
                  onClick={() => {
                    onPick({
                      ...blankTemplateForm,
                      name: email.name,
                      slug: email.slug,
                      isSlugFollowingName: false,
                      subject: email.subject,
                      variables: email.variables.join(", "),
                      sampleVariables: JSON.stringify(
                        email.sampleVariables,
                        null,
                        2,
                      ),
                      design: parseDesign(
                        JSON.parse(JSON.stringify(email.design)),
                      ),
                      headerId: findPart("header", email.headerName),
                      footerId: findPart("footer", email.footerName),
                      configurationId: findPart(
                        "configuration",
                        email.configurationName,
                      ),
                    });
                  }}
                >
                  <Thumbnail
                    design={email.design}
                    samples={email.sampleVariables}
                  />
                  <span className="gallery-name">{email.name}</span>
                  <span className="muted small">{email.description}</span>
                </button>
              ))}
          </div>
        </section>
      ))}
    </>
  );
};

export const TemplateEditorPage = ({
  templateId,
  kind = "template",
}: {
  templateId: string | undefined;
  kind?: EditorKind;
}) => {
  const template = useApiData(
    templateId === undefined
      ? undefined
      : `${editorKinds[kind].api}/${templateId}`,
  );
  const [start, setStart] = useState<TemplateForm | undefined>(undefined);
  if (templateId === undefined) {
    if (start !== undefined) {
      return (
        <TemplateEditor templateId={undefined} initial={start} kind={kind} />
      );
    }
    return kind === "template" ? (
      <StartChooser onPick={setStart} />
    ) : (
      <PartStartChooser kind={kind} onPick={setStart} />
    );
  }
  if (template.data === undefined) {
    return (
      <>
        <LoadingState isLoading={template.isLoading} />
        <FailureNotice error={template.error} />
      </>
    );
  }
  return (
    <TemplateEditor
      key={templateId}
      templateId={templateId}
      initial={readTemplateForm(template.data)}
      kind={kind}
      updatedAt={readText(template.data, "updatedAt")}
      usedBy={readRecords(template.data, "usedBy").map((row) => ({
        id: readText(row, "id"),
        name: readText(row, "name"),
      }))}
    />
  );
};
