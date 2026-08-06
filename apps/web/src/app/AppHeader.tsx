import { APP_VERSION } from "@rundflug/config";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Circle,
  CircleUserRound,
  Copy,
  Headphones,
  Info,
  LockKeyhole,
  LogOut,
  Monitor,
  Moon,
  Settings,
  Sun,
  Tickets,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "../design-system/BrandMark";
import { BusyIndicator, IconButton, ModalDialog } from "../design-system/components";
import { ThemeToggle } from "../design-system/ThemeToggle";
import { useTheme } from "../design-system/theme";
import { activeEventLabel } from "../event-context";
import { switchActiveEvent } from "../event-navigation";
import { useAuth } from "../features/auth/AuthContext";
import type { ConnectionStatus } from "../shared/hooks/use-connectivity";
import { appDestinations, isDestinationActive } from "./navigation";
import { getBuildSourceRevision } from "./source-revision";

const destinationIcons = {
  "/kasse": Tickets,
  "/flight-director": Users,
  "/flight-line": Headphones,
  "/fids": Monitor,
  "/admin": Settings,
} as const;

const themeOptions = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Hell", Icon: Sun },
  { value: "dark", label: "Dunkel", Icon: Moon },
] as const;

export interface AppHeaderProps {
  title: string;
  kiosk?: boolean;
  publicView?: boolean;
  publicEvent?: {
    eventId: string;
    eventName: string;
  };
  connectionStatus?: ConnectionStatus;
}

const connectionLabels: Record<ConnectionStatus, string> = {
  checking: "Verbindung wird geprüft",
  connected: "Verbunden",
  degraded: "Verbindung gestört",
  offline: "Offline",
};

type RevisionCopyStatus = "idle" | "copied" | "error";

export function AppHeader({
  title,
  kiosk = false,
  publicView = false,
  publicEvent,
  connectionStatus = "connected",
}: AppHeaderProps) {
  const { session, logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const [infoOpen, setInfoOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [revisionCopyStatus, setRevisionCopyStatus] = useState<RevisionCopyStatus>("idle");
  const viewSwitcherRef = useRef<HTMLDetailsElement>(null);
  const accountMenuRef = useRef<HTMLDetailsElement>(null);
  const accountSummaryRef = useRef<HTMLElement>(null);
  const revisionCopyResetRef = useRef<number | null>(null);
  const pathname = window.location.pathname;
  const fidsView = pathname === "/fids" || pathname.startsWith("/fids/");
  const eventLabel = activeEventLabel(window.localStorage);
  const currentDestination = appDestinations.find((destination) =>
    isDestinationActive(pathname, destination.href),
  );
  const CurrentDestinationIcon = currentDestination
    ? destinationIcons[currentDestination.href as keyof typeof destinationIcons]
    : Monitor;
  const sourceRevision = getBuildSourceRevision();
  const internalOperationalView = Boolean(session && !kiosk && !publicView && !fidsView);
  const brandContent = (
    <>
      <BrandMark
        {...(publicEvent
          ? { alt: `Logo ${publicEvent.eventName}`, eventId: publicEvent.eventId }
          : {})}
      />
      <strong>
        {publicEvent?.eventName ?? (fidsView ? "Rundflug-Leitstand" : (eventLabel ?? title))}
      </strong>
    </>
  );

  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!viewSwitcherRef.current?.contains(target))
        viewSwitcherRef.current?.removeAttribute("open");
      if (!accountMenuRef.current?.contains(target))
        accountMenuRef.current?.removeAttribute("open");
    };
    const closeMenusWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      viewSwitcherRef.current?.removeAttribute("open");
      accountMenuRef.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closeMenus);
    document.addEventListener("keydown", closeMenusWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenus);
      document.removeEventListener("keydown", closeMenusWithEscape);
    };
  }, []);

  useEffect(
    () => () => {
      if (revisionCopyResetRef.current !== null) {
        window.clearTimeout(revisionCopyResetRef.current);
      }
    },
    [],
  );

  function resetRevisionCopyStatusLater() {
    if (revisionCopyResetRef.current !== null) {
      window.clearTimeout(revisionCopyResetRef.current);
    }
    revisionCopyResetRef.current = window.setTimeout(() => {
      setRevisionCopyStatus("idle");
      revisionCopyResetRef.current = null;
    }, 2_000);
  }

  async function copyFullSourceRevision() {
    if (!sourceRevision.known) return;
    try {
      await navigator.clipboard.writeText(sourceRevision.full);
      setRevisionCopyStatus("copied");
    } catch {
      setRevisionCopyStatus("error");
    }
    resetRevisionCopyStatusLater();
  }

  function closeInfoDialog() {
    if (revisionCopyResetRef.current !== null) {
      window.clearTimeout(revisionCopyResetRef.current);
      revisionCopyResetRef.current = null;
    }
    setRevisionCopyStatus("idle");
    setInfoOpen(false);
  }

  async function logoutAndReload() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    try {
      await logout();
      window.location.reload();
    } finally {
      setLogoutBusy(false);
    }
  }

  return (
    <>
      <header
        className={`app-header ${
          publicView ? "app-header--public" : fidsView ? "app-header--fids" : "app-header--compact"
        }`}
      >
        {internalOperationalView || publicView ? (
          <div className="app-brand">{brandContent}</div>
        ) : (
          <a aria-label="Rundflug-Leitstand" className="app-brand" href="/">
            {brandContent}
          </a>
        )}
        {!kiosk && !publicView && session ? (
          <span
            aria-label={connectionLabels[connectionStatus]}
            className={`app-connection ${connectionStatus}`}
            role="status"
            title={connectionLabels[connectionStatus]}
          >
            <Circle aria-hidden="true" fill="currentColor" size={12} />
            <span>{connectionLabels[connectionStatus]}</span>
          </span>
        ) : null}
        {!kiosk && !publicView && session ? (
          <details
            className="view-switcher"
            onToggle={(event) => {
              if (event.currentTarget.open) accountMenuRef.current?.removeAttribute("open");
            }}
            ref={viewSwitcherRef}
          >
            <summary aria-label={`Ansicht wechseln: ${currentDestination?.label ?? title}`}>
              <span className="view-switcher-icon">
                <CurrentDestinationIcon aria-hidden="true" size={20} />
              </span>
              {fidsView ? (
                <>
                  <span>
                    <span className="view-switcher-prefix">Ansicht: </span>
                    {currentDestination?.label ?? title}
                  </span>
                  <ChevronDown aria-hidden="true" className="view-switcher-chevron" size={18} />
                </>
              ) : null}
            </summary>
            <div className="view-switcher-menu">
              {appDestinations.map((destination) => {
                const Icon = destinationIcons[destination.href as keyof typeof destinationIcons];
                const allowed = destination.roles.includes(session.account.role);
                const active = isDestinationActive(pathname, destination.href);
                return allowed ? (
                  <a
                    aria-current={active ? "page" : undefined}
                    href={destination.href}
                    key={destination.href}
                  >
                    <Icon aria-hidden="true" size={21} />
                    <span>
                      <strong>{destination.label}</strong>
                      <small>
                        {destination.href === "/fids" ? "Öffentliche Vorschau" : "Ansicht öffnen"}
                      </small>
                    </span>
                    {active ? <Check aria-hidden="true" size={20} /> : null}
                  </a>
                ) : (
                  <span
                    aria-disabled="true"
                    className="view-switcher-locked"
                    key={destination.href}
                  >
                    <Icon aria-hidden="true" size={21} />
                    <span>
                      <strong>{destination.label}</strong>
                      <small>Andere Rolle erforderlich</small>
                    </span>
                    <LockKeyhole aria-hidden="true" size={19} />
                  </span>
                );
              })}
            </div>
          </details>
        ) : null}
        {fidsView && session && !kiosk && !publicView && eventLabel ? (
          <button
            className="app-event"
            onClick={switchActiveEvent}
            title="Veranstaltung wechseln"
            type="button"
          >
            <CalendarDays aria-hidden="true" size={18} />
            <span>{eventLabel}</span>
          </button>
        ) : null}
        {fidsView && !kiosk ? (
          <details className="app-info-menu">
            <summary
              aria-label={`Informationen zu Rundflug-Leitstand Version ${APP_VERSION}`}
              className="app-info"
            >
              <Info aria-hidden="true" size={20} />
            </summary>
            <div className="app-info-popover">
              <strong>Rundflug-Leitstand</strong>
              <span>Version {APP_VERSION}</span>
              <small>Rundflug-Leitstand · Version {APP_VERSION}</small>
            </div>
          </details>
        ) : null}
        {fidsView ? <ThemeToggle /> : null}
        {publicView ? <ThemeToggle binary /> : null}
        {session && !kiosk && !publicView ? (
          <details
            className={`account-menu ${fidsView ? "account-menu--legacy" : "account-menu--integrated"}`}
            onToggle={(event) => {
              if (event.currentTarget.open) viewSwitcherRef.current?.removeAttribute("open");
            }}
            ref={accountMenuRef}
          >
            <summary className="app-account" ref={accountSummaryRef}>
              <CircleUserRound aria-hidden="true" size={22} />
              <span>{session.account.loginCode}</span>
              <ChevronDown aria-hidden="true" className="account-menu-chevron" size={16} />
            </summary>
            {fidsView ? (
              <div className="account-menu-popover">
                <strong>{session.account.loginCode}</strong>
                <small>{session.account.role}</small>
                <button
                  aria-busy={logoutBusy || undefined}
                  aria-label={logoutBusy ? "Abmeldung wird ausgeführt" : undefined}
                  disabled={logoutBusy}
                  onClick={() => void logoutAndReload()}
                  type="button"
                >
                  <LogOut aria-hidden="true" size={18} />
                  Abmelden
                  {logoutBusy ? <BusyIndicator label="Abmeldung wird ausgeführt" /> : null}
                </button>
              </div>
            ) : (
              <div className="account-menu-popover account-menu-popover--integrated">
                <header>
                  <strong>{session.account.loginCode}</strong>
                  <small>{session.account.role}</small>
                </header>
                {eventLabel ? (
                  <button className="account-menu-action" onClick={switchActiveEvent} type="button">
                    <CalendarDays aria-hidden="true" size={19} />
                    <span>
                      <strong>Veranstaltung wechseln</strong>
                      <small>{eventLabel}</small>
                    </span>
                  </button>
                ) : null}
                <fieldset className="account-theme-options">
                  <legend>Darstellung</legend>
                  <div>
                    {themeOptions.map(({ value, label, Icon }) => (
                      <label key={value}>
                        <input
                          checked={preference === value}
                          name="account-theme"
                          onChange={() => setPreference(value)}
                          type="radio"
                          value={value}
                        />
                        <Icon aria-hidden="true" size={17} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <button
                  className="account-menu-action"
                  onClick={() => {
                    accountMenuRef.current?.removeAttribute("open");
                    accountSummaryRef.current?.focus();
                    setInfoOpen(true);
                  }}
                  type="button"
                >
                  <Info aria-hidden="true" size={19} />
                  <span>
                    <strong>Über Rundflug-Leitstand</strong>
                    <small>Version und Anwendung</small>
                  </span>
                </button>
                <button
                  aria-busy={logoutBusy || undefined}
                  aria-label={logoutBusy ? "Abmeldung wird ausgeführt" : undefined}
                  className="account-menu-action account-menu-logout"
                  disabled={logoutBusy}
                  onClick={() => void logoutAndReload()}
                  type="button"
                >
                  <LogOut aria-hidden="true" size={19} />
                  <span>
                    <strong>Abmelden</strong>
                  </span>
                  {logoutBusy ? <BusyIndicator label="Abmeldung wird ausgeführt" /> : null}
                </button>
              </div>
            )}
          </details>
        ) : null}
      </header>
      <ModalDialog
        onClose={closeInfoDialog}
        open={infoOpen}
        size="compact"
        title="Über Rundflug-Leitstand"
      >
        <div className="app-about-dialog">
          <strong>Rundflug-Leitstand</strong>
          <span className="app-about-version">Version {APP_VERSION}</span>
          <div className="app-about-revision">
            <span>Source Revision</span>
            <div className="app-about-revision-value">
              <code>{sourceRevision.short}</code>
              {sourceRevision.known ? (
                <IconButton
                  label={
                    revisionCopyStatus === "copied"
                      ? "Source Revision kopiert"
                      : "Vollständige Source Revision kopieren"
                  }
                  onClick={() => void copyFullSourceRevision()}
                  size="compact"
                  type="button"
                >
                  {revisionCopyStatus === "copied" ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <Copy aria-hidden="true" />
                  )}
                </IconButton>
              ) : null}
            </div>
            {sourceRevision.known ? (
              <small
                aria-live="polite"
                className={revisionCopyStatus === "error" ? "is-error" : undefined}
              >
                {revisionCopyStatus === "copied"
                  ? "Kopiert"
                  : revisionCopyStatus === "error"
                    ? "Kopieren nicht möglich."
                    : ""}
              </small>
            ) : null}
          </div>
        </div>
      </ModalDialog>
    </>
  );
}
