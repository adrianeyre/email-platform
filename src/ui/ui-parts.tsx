import {
  useId,
  useState,
  type SyntheticEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ApiRequestFailedError, describeFailure } from "./api-client.js";
import { navigateTo } from "./router.js";

export const formatDateTime = (value: string | undefined | null): string => {
  if (value === undefined || value === null || value === "") {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
};

export const AppLink = ({
  href,
  children,
  className,
  isCurrent,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  isCurrent?: boolean;
}) => (
  <a
    href={href}
    className={className}
    aria-current={isCurrent === true ? "page" : undefined}
    onClick={(event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.button !== 0
      ) {
        return;
      }
      event.preventDefault();
      navigateTo(href);
    }}
  >
    {children}
  </a>
);

export const PageHeader = ({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) => (
  <header className="page-header">
    <div>
      <h1>{title}</h1>
      {description === undefined ? null : (
        <p className="muted">{description}</p>
      )}
    </div>
    {actions === undefined ? null : <div className="actions">{actions}</div>}
  </header>
);

export const FailureNotice = ({ error }: { error: unknown }) => {
  if (error === undefined || error === null) {
    return null;
  }
  const problems =
    error instanceof ApiRequestFailedError ? error.fieldProblems : [];
  return (
    <div className="notice notice-error" role="alert">
      <p>{describeFailure(error)}</p>
      {problems.length === 0 ? null : (
        <ul>
          {problems.map((problem) => (
            <li key={`${problem.field}-${problem.message}`}>
              {problem.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const StatusLine = ({ message }: { message: string }) => (
  <p className="status-line" role="status" aria-live="polite">
    {message}
  </p>
);

export const LoadingState = ({ isLoading }: { isLoading: boolean }) =>
  isLoading ? <StatusLine message="Loading…" /> : null;

export const Badge = ({ label, tone }: { label: string; tone?: string }) => (
  <span className={`badge badge-${tone ?? label.toLowerCase()}`}>{label}</span>
);

export const CopyButton = ({
  value,
  label,
}: {
  value: string;
  label: string;
}) => {
  const [isCopied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="button-small"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
        });
      }}
      aria-label={`Copy ${label}`}
    >
      {isCopied ? "Copied" : "Copy"}
    </button>
  );
};

export interface ActionRunner {
  error: unknown;
  isBusy: boolean;
  runAction: (
    action: () => Promise<unknown>,
    onSuccess?: (result: unknown) => void,
  ) => void;
}

export const useActionRunner = (): ActionRunner => {
  const [error, setError] = useState<unknown>(undefined);
  const [isBusy, setBusy] = useState(false);
  const runAction = (
    action: () => Promise<unknown>,
    onSuccess?: (result: unknown) => void,
  ) => {
    setBusy(true);
    setError(undefined);
    action().then(
      (result) => {
        setBusy(false);
        onSuccess?.(result);
      },
      (failure: unknown) => {
        setBusy(false);
        setError(failure);
      },
    );
  };
  return { error, isBusy, runAction };
};

export const confirmAction = (question: string): boolean =>
  window.confirm(question);

export const submitForm =
  (onSubmit: () => void) =>
  (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit();
  };

export const TextField = ({
  label,
  value,
  onChange,
  type,
  isRequired,
  hint,
  error,
  placeholder,
  autoComplete,
  isCode,
  isFirst,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The field a dialog puts focus on when it opens. */
  isFirst?: boolean;
  type?: string;
  isRequired?: boolean;
  hint?: string;
  /** Shown under the field, which is marked invalid, when set. */
  error?: string;
  placeholder?: string;
  autoComplete?: string;
  /** A code-like value, such as a slug: monospaced, with no spell checking or capitalising. */
  isCode?: boolean;
}) => {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [
    ...(hint === undefined ? [] : [hintId]),
    ...(error === undefined ? [] : [errorId]),
  ].join(" ");
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {isRequired === true ? <span aria-hidden="true"> *</span> : null}
      </span>
      <input
        type={type ?? "text"}
        value={value}
        required={isRequired}
        aria-required={isRequired}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        placeholder={placeholder}
        autoComplete={autoComplete}
        data-autofocus={isFirst === true ? "" : undefined}
        className={isCode === true ? "mono" : undefined}
        spellCheck={isCode === true ? false : undefined}
        autoCapitalize={isCode === true ? "none" : undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hint === undefined ? null : (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      )}
      {error === undefined ? null : (
        <span className="field-error" id={errorId}>
          {error}
        </span>
      )}
    </label>
  );
};

export const SelectField = ({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  hint?: string;
}) => {
  const hintId = `${useId()}-hint`;
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select
        value={value}
        aria-describedby={hint === undefined ? undefined : hintId}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint === undefined ? null : (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      )}
    </label>
  );
};

export const EmptyState = ({ children }: { children: ReactNode }) => (
  <div className="empty-state">{children}</div>
);
