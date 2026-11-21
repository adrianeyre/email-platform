import type { ReactNode } from "react";
import { TrashIcon } from "./icons.js";
import { ModalDialog } from "./modal-dialog.js";
import { FailureNotice } from "./ui-parts.js";

/** One fact about the thing being deleted, such as its slug or when it was last used. */
export interface DeleteDetail {
  label: string;
  value: ReactNode;
  /** Shown in the code font, for IDs, slugs and keys. */
  isMono?: boolean;
}

/**
 * Asks before deleting, with everything needed to be sure: what it is, the facts that identify it, and what deleting
 * it changes. Cancel is the safe way out (as are Esc and the close button); the red button deletes. A failure is shown
 * inside the dialog, where it can be seen, and the dialog stays open.
 */
export const ConfirmDeleteDialog = ({
  isOpen,
  title,
  summary,
  details,
  consequences,
  confirmLabel,
  busyLabel = "Deleting…",
  isBusy,
  canConfirm = true,
  error,
  onConfirm,
  onCancel,
  children,
}: {
  isOpen: boolean;
  /** Such as "Delete this template?" */
  title: string;
  /** One sentence naming what is deleted. */
  summary: ReactNode;
  details: readonly DeleteDetail[];
  /** What deleting it changes, one point each. */
  consequences: readonly ReactNode[];
  /** Such as "Delete template". */
  confirmLabel: string;
  /** Shown on the button while it works, such as "Removing…". */
  busyLabel?: string;
  isBusy: boolean;
  /** False keeps the red button off, such as while a step-up password is empty. */
  canConfirm?: boolean;
  error: unknown;
  onConfirm: () => void;
  onCancel: () => void;
  /** Fields asked for before deleting, such as "Your current password", shown below what happens. */
  children?: ReactNode;
}) => (
  <ModalDialog
    isOpen={isOpen}
    onClose={onCancel}
    title={title}
    closeLabel="Cancel"
    className="confirm-delete"
    actions={
      <>
        <button
          type="button"
          className="button"
          onClick={onCancel}
          disabled={isBusy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button-danger-solid"
          onClick={onConfirm}
          disabled={isBusy || !canConfirm}
        >
          <TrashIcon size={16} />
          {isBusy ? busyLabel : confirmLabel}
        </button>
      </>
    }
  >
    <p className="confirm-delete-summary">{summary}</p>
    <p className="confirm-delete-warning" role="note">
      This can&apos;t be undone.
    </p>
    {details.length === 0 ? null : (
      <dl className="confirm-delete-details">
        {details.map((detail) => (
          <div key={detail.label}>
            <dt>{detail.label}</dt>
            <dd className={detail.isMono === true ? "mono" : undefined}>
              {detail.value}
            </dd>
          </div>
        ))}
      </dl>
    )}
    <h3>What happens</h3>
    <ul className="confirm-delete-consequences">
      {consequences.map((consequence, index) => (
        <li key={index}>{consequence}</li>
      ))}
    </ul>
    {children}
    <FailureNotice error={error} />
  </ModalDialog>
);

/**
 * The names of everything a deletion affects, such as the templates using a footer. A long list scrolls in its own
 * short box, so the rest of the dialog stays in view; it can be focused and scrolled with the keyboard.
 */
export const AffectedList = ({
  label,
  items,
}: {
  label: string;
  items: readonly { id: string; name: string }[];
}) => (
  <ul
    className="confirm-delete-affected"
    aria-label={label}
    tabIndex={items.length > 5 ? 0 : undefined}
  >
    {items.map((item) => (
      <li key={item.id}>{item.name}</li>
    ))}
  </ul>
);
