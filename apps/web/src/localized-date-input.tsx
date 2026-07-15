import { type ReactNode, useEffect, useState } from "react";

type LocalizedInputProps = {
  label: string;
  labelContent?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  dateLabel?: string;
  timeLabel?: string;
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
  return date && valid24HourTime(time) ? `${date}T${time}` : date ? `${date}T00:00` : "";
}

function PickerIcon({ type }: { type: "date" | "time" }) {
  return type === "date" ? (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function GermanDateControl({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const [displayValue, setDisplayValue] = useState(() => formatGermanDate(value));
  useEffect(() => setDisplayValue(formatGermanDate(value)), [value]);
  return (
    <div className="localized-picker-control">
      <input
        aria-label={ariaLabel}
        autoComplete="off"
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
        value={displayValue}
      />
      <span className="localized-picker-trigger">
        <PickerIcon type="date" />
        <input
          aria-label={`${ariaLabel}: Kalender öffnen`}
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
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled: boolean;
}) {
  const [displayValue, setDisplayValue] = useState(value);
  useEffect(() => setDisplayValue(value), [value]);
  return (
    <div className="localized-picker-control time">
      <input
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
}: Omit<LocalizedInputProps, "timeLabel">) {
  return (
    <div className="localized-input-field">
      <span>{labelContent ?? label}</span>
      <GermanDateControl ariaLabel={`${label}: ${dateLabel}`} onChange={onChange} value={value} />
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
}: LocalizedInputProps) {
  const date = value.slice(0, 10);
  const time = value.length >= 16 ? value.slice(11, 16) : "";
  return (
    <div className="localized-input-field">
      <span>{labelContent ?? label}</span>
      <div className="localized-date-time">
        <GermanDateControl
          ariaLabel={`${label}: ${dateLabel}`}
          onChange={(nextDate) => onChange(replaceLocalDate(value, nextDate))}
          value={date}
        />
        <span aria-hidden="true">um</span>
        <GermanTimeControl
          ariaLabel={`${label}: ${timeLabel}`}
          disabled={!date}
          onChange={(nextTime) => onChange(replaceLocalTime(value, nextTime))}
          value={time}
        />
      </div>
    </div>
  );
}
