import { AlertTriangle, CircleAlert, Info, X } from "lucide-react";
import { useState } from "react";

export type PageNoticeTone = "info" | "warning" | "danger";

const toneIcon = {
  info: Info,
  warning: AlertTriangle,
  danger: CircleAlert,
} as const;

export function PageNotificationRegion({ children }: { children: React.ReactNode }) {
  return (
    <aside aria-label="Benachrichtigungen" aria-live="polite" className="page-notification-region">
      {children}
    </aside>
  );
}

export function PageNotice({
  children,
  noticeKey,
  tone = "warning",
}: {
  children: React.ReactNode;
  noticeKey: string;
  tone?: PageNoticeTone;
}) {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  if (dismissedKey === noticeKey) return null;

  const ToneIcon = toneIcon[tone];
  return (
    <section
      className={`page-notification page-notification-${tone}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      <ToneIcon aria-hidden="true" className="page-notification-icon" size={20} />
      <div className="page-notification-content">{children}</div>
      <button
        aria-label="Meldung schließen"
        className="page-notification-close"
        onClick={() => setDismissedKey(noticeKey)}
        type="button"
      >
        <X aria-hidden="true" size={18} />
      </button>
    </section>
  );
}
