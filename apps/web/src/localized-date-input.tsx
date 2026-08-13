import { CalendarDays, Clock3 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

type LocalizedInputProps = {
  label: string;
  labelContent?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  dateLabel?: string;
  timeLabel?: string;
  id?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
};

export function formatGermanDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
}

export function parseGermanDate(value: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const validation = new Date(Date.UTC(year, month - 1, day));
  if (
    validation.getUTCFullYear() !== year ||
    validation.getUTCMonth() !== month - 1 ||
    validation.getUTCDate() !== day
  )
    return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function formatGermanDateTyping(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join(".");
}

export function format24HourTyping(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

function valid24HourTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

export function replaceLocalDate(value: string, date: string): string {
  if (!date) return "";
  const time = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? value.slice(11, 16) : "00:00";
  return `${date}T${time}`;
}

export function replaceLocalTime(value: string, time: string): string {
  const date = /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
  if (!date) return "";
  return valid24HourTime(time) ? `${date}T${time}` : `${date}T00:00`;
}

function PickerIcon({ type }: Readonly<{ type: "date" | "time" }>) {
  const Icon = type === "date" ? CalendarDays : Clock3;
  return <Icon aria-hidden="true" />;
}

function GermanDateControl({
  value,
  onChange,
  ariaLabel,
  id,
  describedBy,
  disabled,
  invalid,
  required,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  id?: string;
  describedBy?: string;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
}>) {
  const [displayValue, setDisplayValue] = useState(() => formatGermanDate(value));
  useEffect(() => setDisplayValue(formatGermanDate(value)), [value]);
  return (
    <div className="localized-picker-control">
      <input
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        id={id}
        inputMode="numeric"
        maxLength={10}
        onBlur={() => setDisplayValue(formatGermanDate(value))}
        onChange={(event) => {
          const formatted = formatGermanDateTyping(event.target.value);
          setDisplayValue(formatted);
          const parsed = parseGermanDate(formatted);
          if (parsed) onChange(parsed);
          else if (!formatted) onChange("");
        }}
        placeholder="TT.MM.JJJJ"
        required={required}
        value={displayValue}
      />
      <span className="localized-picker-trigger">
        <PickerIcon type="date" />
        <input
          aria-label={`${ariaLabel}: Kalender öffnen`}
          disabled={disabled}
          lang="de-DE"
          onChange={(event) => onChange(event.target.value)}
          tabIndex={-1}
          type="date"
          value={value.slice(0, 10)}
        />
      </span>
    </div>
  );
}

function GermanTimeControl({
  value,
  onChange,
  ariaLabel,
  disabled,
  describedBy,
  invalid,
  required,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled: boolean;
  describedBy?: string;
  invalid?: boolean;
  required?: boolean;
}>) {
  const [displayValue, setDisplayValue] = useState(value);
  useEffect(() => setDisplayValue(value), [value]);
  return (
    <div className="localized-picker-control time">
      <input
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        inputMode="numeric"
        maxLength={5}
        onBlur={() => setDisplayValue(value)}
        onChange={(event) => {
          const formatted = format24HourTyping(event.target.value);
          setDisplayValue(formatted);
          if (valid24HourTime(formatted)) onChange(formatted);
        }}
        placeholder="HH:mm"
        required={required}
        value={displayValue}
      />
      <span className="localized-picker-trigger">
        <PickerIcon type="time" />
        <input
          aria-label={`${ariaLabel}: Uhrzeit auswählen`}
          disabled={disabled}
          lang="de-DE"
          onChange={(event) => onChange(event.target.value)}
          step="60"
          tabIndex={-1}
          type="time"
          value={value}
        />
      </span>
    </div>
  );
}

export function LocalizedDateInput({
  label,
  labelContent,
  value,
  onChange,
  dateLabel = "Datum im Format TT.MM.JJJJ",
  id,
  error,
  required,
  disabled,
}: Readonly<Omit<LocalizedInputProps, "timeLabel">>) {
  const errorId = error && id ? `${id}-error` : undefined;
  return (
    <div className={`localized-input-field${error ? " has-error" : ""}`}>
      <span>{labelContent ?? label}</span>
      <GermanDateControl
        ariaLabel={`${label}: ${dateLabel}`}
        {...(errorId ? { describedBy: errorId } : {})}
        {...(disabled === undefined ? {} : { disabled })}
        {...(id ? { id } : {})}
        invalid={Boolean(error)}
        onChange={onChange}
        {...(required === undefined ? {} : { required })}
        value={value}
      />
      {error ? <small id={errorId}>{error}</small> : null}
    </div>
  );
}

export function LocalizedDateTimeInput({
  label,
  labelContent,
  value,
  onChange,
  dateLabel = "Datum im Format TT.MM.JJJJ",
  timeLabel = "Uhrzeit im 24-Stunden-Format HH:mm",
  id,
  error,
  required,
  disabled,
}: Readonly<LocalizedInputProps>) {
  const date = value.slice(0, 10);
  const time = value.length >= 16 ? value.slice(11, 16) : "";
  const errorId = error && id ? `${id}-error` : undefined;
  return (
    <div className={`localized-input-field${error ? " has-error" : ""}`}>
      <span>{labelContent ?? label}</span>
      <div className="localized-date-time">
        <GermanDateControl
          ariaLabel={`${label}: ${dateLabel}`}
          {...(errorId ? { describedBy: errorId } : {})}
          {...(disabled === undefined ? {} : { disabled })}
          {...(id ? { id } : {})}
          invalid={Boolean(error)}
          onChange={(nextDate) => onChange(replaceLocalDate(value, nextDate))}
          {...(required === undefined ? {} : { required })}
          value={date}
        />
        <span aria-hidden="true">um</span>
        <GermanTimeControl
          ariaLabel={`${label}: ${timeLabel}`}
          {...(errorId ? { describedBy: errorId } : {})}
          disabled={Boolean(disabled) || !date}
          invalid={Boolean(error)}
          onChange={(nextTime) => onChange(replaceLocalTime(value, nextTime))}
          {...(required === undefined ? {} : { required })}
          value={time}
        />
      </div>
      {error ? <small id={errorId}>{error}</small> : null}
    </div>
  );
}
