import { useId, useState } from "react";
import { CheckIcon, CloseIcon } from "./icons.js";

/** The server's rule (src/access/users.ts), checked here as you type. */
export const minimumPasswordLength = 12;

/** Letters and digits that can't be mistaken for one another when read or typed: no 0/O, 1/l/I. */
const passwordAlphabet =
  "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A strong random password, from the browser's cryptographic random source, with no bias towards any character. */
export const generatePassword = (length = 20): string => {
  const limit = 256 - (256 % passwordAlphabet.length);
  let password = "";
  while (password.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < limit && password.length < length) {
        password += passwordAlphabet[byte % passwordAlphabet.length] ?? "";
      }
    }
  }
  return password;
};

export interface PasswordRule {
  label: string;
  isMet: boolean;
}

/**
 * A password input with a Show/Hide toggle and its rules ticked off as you type. The rules are linked to the input,
 * so a screen reader reads them with it, and their state is spoken as well as shown.
 */
export const PasswordField = ({
  label,
  value,
  onChange,
  autoComplete,
  rules = [],
  isFirst,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** current-password or new-password, so password managers fill or save it. */
  autoComplete: "current-password" | "new-password";
  rules?: readonly PasswordRule[];
  isFirst?: boolean;
}) => {
  const id = useId();
  const [isShown, setShown] = useState(false);
  const rulesId = `${id}-rules`;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        <span aria-hidden="true"> *</span>
      </label>
      <div className="password-input">
        <input
          id={id}
          type={isShown ? "text" : "password"}
          value={value}
          required
          aria-required
          autoComplete={autoComplete}
          spellCheck={false}
          autoCapitalize="none"
          data-autofocus={isFirst === true ? "" : undefined}
          aria-describedby={rules.length === 0 ? undefined : rulesId}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <button
          type="button"
          className="password-toggle"
          aria-controls={id}
          aria-pressed={isShown}
          aria-label={
            isShown
              ? `Hide ${label.toLowerCase()}`
              : `Show ${label.toLowerCase()}`
          }
          onClick={() => {
            setShown((shown) => !shown);
          }}
        >
          {isShown ? "Hide" : "Show"}
        </button>
      </div>
      {rules.length === 0 ? null : (
        <ul className="password-rules" id={rulesId}>
          {rules.map((rule) => (
            <li key={rule.label} data-met={rule.isMet ? "" : undefined}>
              {rule.isMet ? <CheckIcon size={14} /> : <CloseIcon size={14} />}
              <span>
                {rule.label}
                <span className="visually-hidden">
                  {rule.isMet ? ", done" : ", not yet"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const lengthRule = (password: string): PasswordRule => ({
  label: `At least ${String(minimumPasswordLength)} characters`,
  isMet: password.length >= minimumPasswordLength,
});
