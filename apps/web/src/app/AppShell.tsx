import { lazy, Suspense } from "react";
import { resolveConnectionStatus, useConnectivity } from "../shared/hooks/use-connectivity";
import { AppHeader } from "./AppHeader";
import { ActionNotificationStack, PageNotice, PageNotificationRegion } from "./PageNotifications";

const PwaUpdateNotice = lazy(() =>
  import("./PwaUpdate").then((module) => ({ default: module.PwaUpdateNotice })),
);

function showsOperationalPwaUpdate(pathname: string): boolean {
  return ["/kasse", "/flight-line", "/flight-director", "/admin"].includes(pathname);
}

export function AppShell({
  title,
  children,
  kiosk = false,
  publicView = false,
  publicEvent,
  className = "",
  notifications,
  connection,
}: Readonly<{
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
}>) {
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
        {notifications}
        {connectionStatus === "offline" ? (
          <PageNotice noticeKey="app-offline" tone="warning">
            Offline · letzter bestätigter Stand bleibt sichtbar; operative Aktionen sind gesperrt.
          </PageNotice>
        ) : null}
        {showsOperationalPwaUpdate(window.location.pathname) ? (
          <Suspense fallback={null}>
            <PwaUpdateNotice />
          </Suspense>
        ) : null}
      </PageNotificationRegion>
      <ActionNotificationStack />
      {children}
    </main>
  );
}
