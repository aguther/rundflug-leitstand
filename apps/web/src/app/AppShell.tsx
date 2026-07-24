import { resolveConnectionStatus, useConnectivity } from "../shared/hooks/use-connectivity";
import { AppHeader } from "./AppHeader";
import { ActionNotificationStack, PageNotice, PageNotificationRegion } from "./PageNotifications";

export function AppShell({
  title,
  children,
  kiosk = false,
  publicView = false,
  publicEvent,
  className = "",
  notifications,
  connection,
}: {
  title: string;
  children: React.ReactNode;
  kiosk?: boolean;
  publicView?: boolean;
  publicEvent?: {
    eventId: string;
    eventName: string;
  };
  className?: string;
  notifications?: React.ReactNode;
  connection?: {
    error: string | null;
    lastConfirmedAt: string | null;
    backendConfirmed: boolean;
  };
}) {
  const online = useConnectivity();
  const connectionStatus = resolveConnectionStatus({
    online,
    error: connection?.error,
    lastConfirmedAt: connection?.lastConfirmedAt,
    backendConfirmed: connection?.backendConfirmed,
    tracksBackend: connection !== undefined,
  });
  return (
    <main className={`${kiosk ? "app-shell kiosk-shell" : "app-shell"} ${className}`.trim()}>
      <AppHeader
        connectionStatus={connectionStatus}
        kiosk={kiosk}
        {...(publicEvent ? { publicEvent } : {})}
        publicView={publicView}
        title={title}
      />
      <PageNotificationRegion>
        {connectionStatus === "offline" ? (
          <PageNotice noticeKey="app-offline" tone="warning">
            Offline · letzter bestätigter Stand bleibt sichtbar; operative Aktionen sind gesperrt.
          </PageNotice>
        ) : null}
        {notifications}
        <ActionNotificationStack />
      </PageNotificationRegion>
      {children}
    </main>
  );
}
