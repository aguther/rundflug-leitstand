import { useConnectivity } from "../shared/hooks/use-connectivity";
import { AppHeader } from "./AppHeader";

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
  return (
    <main className={`${kiosk ? "app-shell kiosk-shell" : "app-shell"} ${className}`.trim()}>
      <AppHeader kiosk={kiosk} publicView={publicView} title={title} />
      {!online ? (
        <div className="connection-warning" role="status">
          Offline · letzter bestätigter Stand bleibt sichtbar; operative Aktionen sind gesperrt.
        </div>
      ) : null}
      {children}
    </main>
  );
}
