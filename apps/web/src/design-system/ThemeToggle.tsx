import { useTheme } from "./theme";

const LABEL = {
  system: "Systemdarstellung aktiv. Zu Hell wechseln",
  light: "Helle Darstellung aktiv. Zu Dunkel wechseln",
  dark: "Dunkle Darstellung aktiv. Zur Systemdarstellung wechseln",
} as const;

export function ThemeToggle({ binary = false }: { binary?: boolean }) {
  const { preference, resolved, cycle, setPreference } = useTheme();
  const label = binary
    ? resolved === "dark"
      ? "Dunkle Darstellung aktiv. Zu Hell wechseln"
      : "Helle Darstellung aktiv. Zu Dunkel wechseln"
    : LABEL[preference];
  return (
    <button
      aria-label={label}
      className="theme-toggle"
      data-preference={preference}
      onClick={binary ? () => setPreference(resolved === "dark" ? "light" : "dark") : cycle}
      title={label}
      type="button"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        {!binary && preference === "system" ? (
          <>
            <rect height="13" rx="2" width="18" x="3" y="3" />
            <path d="M8 21h8M12 16v5" />
          </>
        ) : resolved === "dark" ? (
          <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        )}
      </svg>
    </button>
  );
}
