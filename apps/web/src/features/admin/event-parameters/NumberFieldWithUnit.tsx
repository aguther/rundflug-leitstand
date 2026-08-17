import { useId } from "react";

export function NumberFieldWithUnit({
  label,
  unit,
  value,
  onChange,
  error,
  minimum,
  maximum,
  step = 1,
  disabled = false,
}: Readonly<{
  label: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  minimum: number;
  maximum: number;
  step?: number | undefined;
  disabled?: boolean | undefined;
}>) {
  const generatedId = useId();
  const errorId = error ? `${generatedId}-error` : undefined;
  return (
    <label
      className={`event-parameter-number-field${error ? " has-error" : ""}`}
      htmlFor={generatedId}
    >
      <span>{label}</span>
      <span className="event-parameter-number-control ds-control-group">
        <input
          aria-describedby={errorId}
          aria-invalid={Boolean(error) || undefined}
          disabled={disabled}
          id={generatedId}
          max={maximum}
          min={minimum}
          onChange={(inputEvent) => onChange(inputEvent.target.value)}
          step={step}
          type="number"
          value={value}
        />
        <span aria-hidden="true" className="event-parameter-number-unit">
          {unit}
        </span>
      </span>
      {error ? <small id={errorId}>{error}</small> : null}
    </label>
  );
}
