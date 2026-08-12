import { Search } from "lucide-react";
import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from "react";

export interface FieldProps {
  label: ReactNode;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
}

export interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  trailing?: ReactNode;
}

export function Field({ label, help, children, className = "" }: Readonly<FieldProps>) {
  return (
    <div className={`ds-field ${className}`.trim()}>
      <span className="ds-field-label">{label}</span>
      {children}
      {help ? <small>{help}</small> : null}
    </div>
  );
}

export function CheckboxField({
  label,
  trailing,
  className = "",
  checked,
  disabled,
  id: providedId,
  ...input
}: Readonly<CheckboxFieldProps>) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  return (
    <div
      className={[
        "ds-checkbox-field",
        checked ? "ds-checkbox-field--selected" : "",
        disabled ? "ds-checkbox-field--disabled" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <label className="ds-checkbox-field-label" htmlFor={id}>
        <input {...input} checked={checked} disabled={disabled} id={id} type="checkbox" />
        <span>{label}</span>
      </label>
      {trailing ? <span className="ds-checkbox-field-trailing">{trailing}</span> : null}
    </div>
  );
}

export function TextField({
  label,
  help,
  className = "",
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; help?: ReactNode }) {
  const generatedId = useId();
  const id = input.id ?? generatedId;
  return (
    <label className={`ds-field ${className}`.trim()} htmlFor={id}>
      <span className="ds-field-label">{label}</span>
      <input {...input} id={id} />
      {help ? <small>{help}</small> : null}
    </label>
  );
}

export function SearchField({
  label,
  className = "",
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode }) {
  const generatedId = useId();
  const id = input.id ?? generatedId;
  return (
    <label className={`ds-search-control ${className}`.trim()} htmlFor={id}>
      <span className="visually-hidden">{label}</span>
      <span className="ds-search-field">
        <Search aria-hidden="true" size={17} />
        <input {...input} id={id} type="search" />
      </span>
    </label>
  );
}

export function SelectField({
  label,
  help,
  children,
  className = "",
  ...select
}: SelectHTMLAttributes<HTMLSelectElement> & { label: ReactNode; help?: ReactNode }) {
  const generatedId = useId();
  const id = select.id ?? generatedId;
  return (
    <label className={`ds-field ${className}`.trim()} htmlFor={id}>
      <span className="ds-field-label">{label}</span>
      <select {...select} id={id}>
        {children}
      </select>
      {help ? <small>{help}</small> : null}
    </label>
  );
}

export function TextAreaField({
  label,
  help,
  className = "",
  ...textarea
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: ReactNode; help?: ReactNode }) {
  const generatedId = useId();
  const id = textarea.id ?? generatedId;
  const helpId = `${id}-help`;
  const describedBy = [textarea["aria-describedby"], help ? helpId : undefined]
    .filter(Boolean)
    .join(" ");
  return (
    <label className={`ds-field ${className}`.trim()} htmlFor={id}>
      <span className="ds-field-label">{label}</span>
      <textarea {...textarea} aria-describedby={describedBy || undefined} id={id} />
      {help ? <small id={helpId}>{help}</small> : null}
    </label>
  );
}
