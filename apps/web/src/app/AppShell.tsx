import { useConnectivity } from "../shared/hooks/use-connectivity";
import { AppHeader } from "./AppHeader";
import { PageNotice, PageNotificationRegion } from "./PageNotifications";

export function AppShell({
  title,
  children,
  kiosk = false,
  publicView = false,
  className = "",
  notifications,
}: {
  title: string;
  children: React.ReactNode;
  kiosk?: boolean;
  publicView?: boolean;
  className?: string;
  notifications?: React.ReactNode;
}) {
  const online = useConnectivity();
  return (
    <main className={`${kiosk ? "app-shell kiosk-shell" : "app-shell"} ${className}`.trim()}>
      <AppHeader kiosk={kiosk} publicView={publicView} title={title} />
      <PageNotificationRegion>
        {!online ? (
          <PageNotice noticeKey="app-offline" tone="warning">
            Offline · letzter bestätigter Stand bleibt sichtbar; operative Aktionen sind gesperrt.
          </PageNotice>
        ) : null}
        {notifications}
      </PageNotificationRegion>
      {children}
    </main>
  );
}
