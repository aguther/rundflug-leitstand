import {
  CalendarDays,
  Check,
  ChevronDown,
  Circle,
  CircleUserRound,
  Headphones,
  LockKeyhole,
  LogOut,
  Monitor,
  Plane,
  Settings,
  Tickets,
  Users,
} from "lucide-react";
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

export interface AppHeaderProps {
  title: string;
  kiosk?: boolean;
  publicView?: boolean;
}

export function AppHeader({ title, kiosk = false, publicView = false }: AppHeaderProps) {
  const online = useConnectivity();
  const { session, logout } = useAuth();
  const pathname = window.location.pathname;
  const eventLabel = activeEventLabel(window.localStorage);
  const currentDestination = appDestinations.find((destination) =>
    isDestinationActive(pathname, destination.href),
  );

  return (
    <header className="app-header">
      <a aria-label="Rundflug-Leitstand" className="app-brand" href="/">
        <BrandMark />
        <strong>Rundflug-Leitstand</strong>
      </a>
      {!kiosk && !publicView && session ? (
        <details className="view-switcher">
          <summary>
            <Monitor aria-hidden="true" size={20} />
            <span>
              <span className="view-switcher-prefix">Ansicht: </span>
              {currentDestination?.label ?? title}
            </span>
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
                <span aria-disabled="true" className="view-switcher-locked" key={destination.href}>
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
      <ThemeToggle />
      {session && !kiosk && !publicView ? (
        <details className="account-menu">
          <summary className="app-account">
            <CircleUserRound aria-hidden="true" size={22} />
            <span>{session.account.loginCode}</span>
            <ChevronDown aria-hidden="true" size={16} />
          </summary>
          <div className="account-menu-popover">
            <strong>{session.account.loginCode}</strong>
            <small>{session.account.role}</small>
            <button
              onClick={() => void logout().then(() => window.location.reload())}
              type="button"
            >
              <LogOut aria-hidden="true" size={18} />
              Abmelden
            </button>
          </div>
        </details>
      ) : null}
    </header>
  );
}
