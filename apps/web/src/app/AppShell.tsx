import {
  CalendarDays,
  Check,
  ChevronDown,
  Circle,
  Headphones,
  LockKeyhole,
  LogOut,
  Monitor,
  Plane,
  Settings,
  Tickets,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { BrandMark } from "../design-system/BrandMark";
import { ThemeToggle } from "../design-system/ThemeToggle";
import { activeEventLabel, forgetActiveEvent } from "../event-context";
import { useAuth } from "../features/auth/AuthContext";
import { useConnectivity } from "../shared/hooks/use-connectivity";
import { appDestinations, isDestinationActive } from "./navigation";

const destinationIcons = {
  "/kasse": Tickets,
  "/flight-line": Users,
  "/flight-line/assist": Headphones,
  "/fids": Plane,
  "/admin": Settings,
} as const;

function HeaderClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000 * 15);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <time className="app-header-clock" dateTime={now.toISOString()}>
      {now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
    </time>
  );
}

export function AppShell({
  title,
  children,
  kiosk = false,
  publicView = false,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  kiosk?: boolean;
  publicView?: boolean;
  className?: string;
}) {
  const online = useConnectivity();
  const { session, logout } = useAuth();
  const pathname = window.location.pathname;
  const eventLabel = activeEventLabel(window.localStorage);
  const currentDestination = appDestinations.find((destination) =>
    isDestinationActive(pathname, destination.href),
  );
  return (
    <main className={`${kiosk ? "app-shell kiosk-shell" : "app-shell"} ${className}`.trim()}>
      <header className="app-header">
        <a aria-label="Rundflug-Leitstand" className="app-brand" href="/">
          <BrandMark />
          <strong>Rundflug-Leitstand</strong>
          <span>{title}</span>
        </a>
        {!kiosk && !publicView && session ? (
          <details className="view-switcher">
            <summary>
              <Monitor aria-hidden="true" size={20} />
              <span>Ansicht: {currentDestination?.label ?? title}</span>
              <ChevronDown aria-hidden="true" size={18} />
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
              <button
                onClick={() => void logout().then(() => window.location.reload())}
                type="button"
              >
                <LogOut aria-hidden="true" size={21} />
                <span>Abmelden</span>
              </button>
            </div>
          </details>
        ) : null}
        {!kiosk ? <HeaderClock /> : null}
        <ThemeToggle />
        {session && !kiosk && !publicView && eventLabel ? (
          <button
            className="app-event"
            onClick={() => {
              forgetActiveEvent(window.localStorage);
              window.location.reload();
            }}
            title="Veranstaltung wechseln"
            type="button"
          >
            <CalendarDays aria-hidden="true" size={18} />
            {eventLabel}
          </button>
        ) : null}
        {!kiosk ? (
          <span className={online ? "app-connection connected" : "app-connection"}>
            <Circle aria-hidden="true" fill="currentColor" size={12} />
            {online ? "Verbunden" : "Offline"}
          </span>
        ) : null}
        {session && !kiosk && !publicView ? (
          <button
            className="app-account"
            onClick={() => {
              const switcher = document.querySelector<HTMLDetailsElement>(".view-switcher");
              if (switcher) switcher.open = !switcher.open;
            }}
            type="button"
          >
            {session.account.loginCode}
          </button>
        ) : null}
      </header>
      {!online ? (
        <div className="connection-warning" role="status">
          Offline · letzter bestätigter Stand bleibt sichtbar; operative Aktionen sind gesperrt.
        </div>
      ) : null}
      {children}
      {!kiosk ? (
        <footer>Keine flugbetriebliche oder sicherheitsrelevante Freigabewirkung.</footer>
      ) : null}
    </main>
  );
}
