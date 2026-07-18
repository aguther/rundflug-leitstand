import { Search } from "lucide-react";
import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId } from "react";

export interface FieldProps {
  label: ReactNode;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Field({ label, help, children, className = "" }: FieldProps) {
  return (
    <div className={`ds-field ${className}`.trim()}>
      <span className="ds-field-label">{label}</span>
      {children}
      {help ? <small>{help}</small> : null}
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
