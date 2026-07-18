import { useEffect, useState } from "react";
import { BrandMark } from "../design-system/BrandMark";
import { ThemeToggle } from "../design-system/ThemeToggle";
import { useAuth } from "../features/auth/AuthContext";
import { useConnectivity } from "../shared/hooks/use-connectivity";
import { appDestinations, destinationsForRole, isDestinationActive } from "./navigation";

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
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  kiosk?: boolean;
  className?: string;
}) {
  const online = useConnectivity();
  const { session, logout } = useAuth();
  const pathname = window.location.pathname;
  const destinations = session ? destinationsForRole(session.account.role) : appDestinations;
  return (
    <main className={`${kiosk ? "app-shell kiosk-shell" : "app-shell"} ${className}`.trim()}>
      <header className="app-header">
        <a aria-label="Rundflug-Leitstand" className="app-brand" href="/">
          <BrandMark />
          <strong>Rundflug-Leitstand</strong>
          <span>{title}</span>
        </a>
        {!kiosk ? (
          <nav aria-label="Arbeitsbereiche">
            {destinations.map((destination) => (
              <a
                aria-current={isDestinationActive(pathname, destination.href) ? "page" : undefined}
                href={destination.href}
                key={destination.href}
              >
                {destination.label}
              </a>
            ))}
          </nav>
        ) : null}
        {!kiosk ? <HeaderClock /> : null}
        <ThemeToggle />
        {session && !kiosk ? (
          <button
            className="app-account"
            onClick={() => void logout().then(() => window.location.reload())}
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
