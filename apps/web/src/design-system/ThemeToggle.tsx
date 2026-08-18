import { useTheme } from "./theme";

const LABEL = {
  system: "Systemdarstellung aktiv. Zu Hell wechseln",
  light: "Helle Darstellung aktiv. Zu Dunkel wechseln",
  dark: "Dunkle Darstellung aktiv. Zur Systemdarstellung wechseln",
} as const;

function themeToggleLabel(
  binary: boolean,
  preference: keyof typeof LABEL,
  resolved: "light" | "dark",
): string {
  if (!binary) return LABEL[preference];
  return resolved === "dark"
    ? "Dunkle Darstellung aktiv. Zu Hell wechseln"
    : "Helle Darstellung aktiv. Zu Dunkel wechseln";
}

function themeIconName(
  binary: boolean,
  preference: keyof typeof LABEL,
  resolved: "light" | "dark",
): "system" | "moon" | "sun" {
  if (!binary && preference === "system") return "system";
  return resolved === "dark" ? "moon" : "sun";
}

function ThemeIcon({
  binary,
  preference,
  resolved,
}: Readonly<{
  binary: boolean;
  preference: keyof typeof LABEL;
  resolved: "light" | "dark";
}>) {
  if (!binary && preference === "system") {
    return (
      <>
        <rect height="13" rx="2" width="18" x="3" y="3" />
        <path d="M8 21h8M12 16v5" />
      </>
    );
  }
  if (resolved === "dark") {
    return <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" />;
  }
  return (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  );
}

export function ThemeToggle({ binary = false }: Readonly<{ binary?: boolean }>) {
  const { preference, resolved, cycle, setPreference } = useTheme();
  const label = themeToggleLabel(binary, preference, resolved);
  const icon = themeIconName(binary, preference, resolved);
  return (
    <button
      aria-label={label}
      className="theme-toggle"
      data-preference={preference}
      onClick={binary ? () => setPreference(resolved === "dark" ? "light" : "dark") : cycle}
      title={label}
      type="button"
    >
      <svg aria-hidden="true" data-theme-icon={icon} viewBox="0 0 24 24">
        <ThemeIcon binary={binary} preference={preference} resolved={resolved} />
      </svg>
    </button>
  );
}
