import { AlertTriangle, CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import {
  createContext,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type PageNoticeTone = "success" | "info" | "warning" | "danger";

interface ActionNotice {
  id: number;
  message: string;
  tone: PageNoticeTone;
}

interface ActionNotificationContextValue {
  notices: ActionNotice[];
  dismiss: (id: number) => void;
  notify: (message: string, tone?: PageNoticeTone) => void;
}

const ActionNotificationContext = createContext<ActionNotificationContextValue | null>(null);
let nextActionNoticeId = 1;

const toneIcon = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  danger: CircleAlert,
} as const;

export function inferActionNoticeTone(message: string): PageNoticeTone {
  if (
    /fehl|konnte nicht|nicht verfügbar|benötigt|mindestens|ungültig|abgelehnt|gesperrt|überschreit|kein druckbar|noch nicht bestätigt|abgelaufen|aufgehoben/i.test(
      message,
    )
  ) {
    return "danger";
  }
  if (/prüfen|klärung|warn|wiederhergestellt/i.test(message)) return "warning";
  return "success";
}

export function ActionNotificationProvider({ children }: { children: React.ReactNode }) {
  const [notices, setNotices] = useState<ActionNotice[]>([]);
  const dismiss = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);
  const notify = useCallback((message: string, tone = inferActionNoticeTone(message)) => {
    const notice = { id: nextActionNoticeId++, message, tone };
    setNotices((current) => [...current.slice(-4), notice]);
  }, []);
  return (
    <ActionNotificationContext.Provider value={{ dismiss, notices, notify }}>
      {children}
    </ActionNotificationContext.Provider>
  );
}

export function useActionNotifications() {
  const context = useContext(ActionNotificationContext);
  if (!context) throw new Error("ActionNotificationProvider fehlt.");
  return context;
}

export function useActionMessageBridge(
  message: string | null,
  setMessage: Dispatch<SetStateAction<string | null>>,
) {
  const { notify } = useActionNotifications();
  useEffect(() => {
    if (!message) return;
    notify(message);
    setMessage(null);
  }, [message, notify, setMessage]);
}

export function ActionNotificationStack() {
  const { dismiss, notices } = useActionNotifications();
  return notices.map((notice) => (
    <PageNotice
      autoDismissMs={notice.tone === "danger" ? 10_000 : 5_000}
      noticeKey={`action:${notice.id}`}
      onDismiss={() => dismiss(notice.id)}
      tone={notice.tone}
      key={notice.id}
    >
      {notice.message}
    </PageNotice>
  ));
}

export function PageNotificationRegion({ children }: { children: React.ReactNode }) {
  return (
    <aside aria-label="Benachrichtigungen" aria-live="polite" className="page-notification-region">
      {children}
    </aside>
  );
}

export function PageNotice({
  autoDismissMs,
  children,
  noticeKey,
  onDismiss,
  tone = "warning",
}: {
  autoDismissMs?: number;
  children: React.ReactNode;
  noticeKey: string;
  onDismiss?: () => void;
  tone?: PageNoticeTone;
}) {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const remainingMs = useRef(autoDismissMs ?? 0);
  const startedAt = useRef(0);
  const dismiss = useCallback(() => {
    setDismissedKey(noticeKey);
    onDismiss?.();
  }, [noticeKey, onDismiss]);

  useEffect(() => {
    remainingMs.current = autoDismissMs ?? 0;
    setPaused(false);
  }, [autoDismissMs]);

  useEffect(() => {
    if (!autoDismissMs || paused || dismissedKey === noticeKey) return;
    startedAt.current = window.performance.now();
    const timeout = window.setTimeout(dismiss, remainingMs.current);
    return () => {
      window.clearTimeout(timeout);
      remainingMs.current = Math.max(
        0,
        remainingMs.current - (window.performance.now() - startedAt.current),
      );
    };
  }, [autoDismissMs, dismiss, dismissedKey, noticeKey, paused]);

  if (dismissedKey === noticeKey) return null;

  const ToneIcon = toneIcon[tone];
  return (
    <section
      className={`page-notification page-notification-${tone}`}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
      onFocusCapture={() => setPaused(true)}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      role={tone === "danger" ? "alert" : "status"}
    >
      <ToneIcon aria-hidden="true" className="page-notification-icon" size={20} />
      <div className="page-notification-content">{children}</div>
      <button
        aria-label="Meldung schließen"
        className="page-notification-close"
        onClick={dismiss}
        type="button"
      >
        <X aria-hidden="true" size={18} />
      </button>
    </section>
  );
}
