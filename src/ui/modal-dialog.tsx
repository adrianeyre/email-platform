import { useEffect, useId, useRef, type ReactNode } from "react";
import { CloseIcon } from "./icons.js";

/**
 * A native modal dialog: focus moves into it on opening and back to the button that opened it on closing, and Esc or a
 * click outside closes it. Its footer is a Close button unless `actions` gives its own, such as Cancel and Delete.
 */
export const ModalDialog = ({
  isOpen,
  onClose,
  title,
  closeLabel,
  actions,
  className,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (isOpen && !dialog.open) {
      openerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
      // A form dialog starts on the field marked data-autofocus; others on the close button.
      const first = dialog.querySelector<HTMLElement>("[data-autofocus]");
      (first ?? closeButtonRef.current)?.focus();
      return;
    }
    if (!isOpen && dialog.open) {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
      openerRef.current?.focus();
      openerRef.current = null;
    }
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      className={`modal-dialog${className === undefined ? "" : ` ${className}`}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      {isOpen ? (
        <>
          <div className="modal-dialog-header">
            <h2 id={titleId}>{title}</h2>
            <button
              ref={closeButtonRef}
              type="button"
              className="icon-button-large"
              aria-label={closeLabel}
              onClick={onClose}
            >
              <CloseIcon size={22} />
            </button>
          </div>
          <div
            role="region"
            aria-labelledby={titleId}
            tabIndex={0}
            className="modal-dialog-body"
          >
            {children}
          </div>
          <div className="modal-dialog-footer">
            {actions ?? (
              <button
                type="button"
                className="button button-primary"
                onClick={onClose}
              >
                Close
              </button>
            )}
          </div>
        </>
      ) : null}
    </dialog>
  );
};
