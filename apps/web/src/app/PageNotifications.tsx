import { AlertTriangle, CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import {
  createContext,
  type Dispatch,
  type FocusEvent,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

export function ActionNotificationProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [notices, setNotices] = useState<ActionNotice[]>([]);
  const dismiss = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);
  const notify = useCallback((message: string, tone = inferActionNoticeTone(message)) => {
    const notice = { id: nextActionNoticeId++, message, tone };
    setNotices((current) => [...current.slice(-4), notice]);
  }, []);
  const value = useMemo(() => ({ dismiss, notices, notify }), [dismiss, notices, notify]);
  return (
    <ActionNotificationContext.Provider value={value}>
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
  if (notices.length === 0) return null;
  return (
    <aside aria-label="Aktionsbestätigungen" className="action-notification-region">
      {notices.map((notice) => (
        <PageNotice
          autoDismissMs={notice.tone === "danger" ? 10_000 : 5_000}
          noticeKey={`action:${notice.id}`}
          onDismiss={() => dismiss(notice.id)}
          tone={notice.tone}
          key={notice.id}
        >
          {notice.message}
        </PageNotice>
      ))}
    </aside>
  );
}

export function PageNotificationRegion({ children }: Readonly<{ children: React.ReactNode }>) {
  const listRef = useRef<HTMLDivElement>(null);
  const [noticeCount, setNoticeCount] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const updateCount = () => {
      const nextCount =
        listRef.current?.querySelectorAll(":scope > .page-notification").length ?? 0;
      setNoticeCount(nextCount);
      if (nextCount < 2) setExpanded(false);
    };
    updateCount();
    const observer = new MutationObserver(updateCount);
    if (listRef.current) observer.observe(listRef.current, { childList: true });
    return () => observer.disconnect();
  }, []);
  return (
    <aside
      aria-label="Dauerhafte Hinweise"
      aria-live="polite"
      className={`page-notification-region${expanded ? " is-expanded" : ""}`}
      hidden={noticeCount === 0}
    >
      <div className="page-notification-list" ref={listRef}>
        {children}
      </div>
      {noticeCount > 1 ? (
        <button
          aria-expanded={expanded}
          className="page-notification-more"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? "Nur wichtigsten Hinweis zeigen" : `${noticeCount - 1} weitere Hinweise`}
        </button>
      ) : null}
    </aside>
  );
}

export function PageNotice({
  autoDismissMs,
  children,
  dismissible = true,
  noticeKey,
  onDismiss,
  tone = "warning",
}: Readonly<{
  autoDismissMs?: number;
  children: React.ReactNode;
  dismissible?: boolean;
  noticeKey: string;
  onDismiss?: () => void;
  tone?: PageNoticeTone;
}>) {
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
  const notificationProps = {
    className: `page-notification page-notification-${tone}`,
    onBlurCapture: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
    },
    onFocusCapture: () => setPaused(true),
    onPointerEnter: () => setPaused(true),
    onPointerLeave: () => setPaused(false),
  };
  const content = (
    <>
      <ToneIcon aria-hidden="true" className="page-notification-icon" size={20} />
      <div className="page-notification-content">{children}</div>
      {dismissible ? (
        <button
          aria-label="Meldung schließen"
          className="page-notification-close"
          onClick={dismiss}
          type="button"
        >
          <X aria-hidden="true" size={18} />
        </button>
      ) : null}
    </>
  );
  if (tone === "danger") {
    return (
      <section {...notificationProps} role="alert">
        {content}
      </section>
    );
  }
  return <output {...notificationProps}>{content}</output>;
}
