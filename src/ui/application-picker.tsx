import { useId } from "react";
import { readRecords, readText } from "./api-client.js";
import { SelectField } from "./ui-parts.js";
import { useApiData } from "./use-api-data.js";

/** The name of the Application a new API Key acts for: an existing one from the list, or a new name, made on saving. */
export const ApplicationNameField = ({
  value,
  onChange,
  names,
}: {
  value: string;
  onChange: (name: string) => void;
  /** The Applications there are, offered as the field is typed in. */
  names: readonly string[];
}) => {
  const id = useId();
  return (
    <label className="field">
      <span className="field-label">
        Application<span aria-hidden="true"> *</span>
      </span>
      <input
        type="text"
        value={value}
        required
        aria-required
        aria-describedby={`${id}-hint`}
        list={`${id}-list`}
        placeholder="My app"
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      <datalist id={`${id}-list`}>
        {names.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <span className="field-hint" id={`${id}-hint`}>
        Pick one or type a new name. The key can change only this
        application&apos;s templates, headers and footers, send only from its
        configurations&apos; addresses or the default, and read only its emails.
      </span>
    </label>
  );
};

/**
 * Chooses the Application that owns a Template, Header, Footer or Configuration, or none. Users can always change it;
 * API Keys reach only their own Application's (ADR 0009). The hint says what owning it means, chosen or not.
 */
export const ApplicationPicker = ({
  value,
  onChange,
  hints,
}: {
  value: string;
  onChange: (id: string) => void;
  hints: { none: string; owned: string };
}) => {
  const list = useApiData("/app/applications");
  const rows = readRecords(list.data, "applications");
  return (
    <SelectField
      label="Application"
      value={value}
      onChange={onChange}
      options={[
        { value: "", label: "None" },
        ...rows.map((row) => ({
          value: readText(row, "id"),
          label: readText(row, "name"),
        })),
      ]}
      hint={value === "" ? hints.none : hints.owned}
    />
  );
};
