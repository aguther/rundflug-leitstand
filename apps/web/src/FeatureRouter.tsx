import { lazy, type ReactNode, Suspense } from "react";
import { AppErrorBoundary } from "./app/AppErrorBoundary";

const AdminView = lazy(() =>
  import("./admin-view").then((module) => ({ default: module.AdminView })),
);
const CashierView = lazy(() =>
  import("./cashier-view").then((module) => ({ default: module.CashierView })),
);
const FidsView = lazy(() => import("./fids-view").then((module) => ({ default: module.FidsView })));
const FlightLineView = lazy(() =>
  import("./flight-line-view").then((module) => ({ default: module.FlightLineView })),
);
const FlightDirectorView = lazy(() =>
  import("./flight-director-view").then((module) => ({ default: module.FlightDirectorView })),
);
const ForecastSimulationView = lazy(
  () => import("./features/forecast-simulation/ForecastSimulationView"),
);
const SimulationFidsView = lazy(() => import("./features/forecast-simulation/SimulationFidsView"));
const PrivacyView = lazy(() =>
  import("./privacy-view").then((module) => ({ default: module.PrivacyView })),
);
const SetupView = lazy(() =>
  import("./setup-view").then((module) => ({ default: module.SetupView })),
);
const TicketStatusView = lazy(() =>
  import("./ticket-status-view").then((module) => ({ default: module.TicketStatusView })),
);
const GroupStatusView = lazy(() =>
  import("./group-status-view").then((module) => ({ default: module.GroupStatusView })),
);
const NotFoundPage = lazy(() =>
  import("./app/NotFoundPage").then((module) => ({ default: module.NotFoundPage })),
);

export function FeatureBoundary({
  children,
  routeKey,
}: Readonly<{ children: ReactNode; routeKey: string }>) {
  return (
    <AppErrorBoundary scope="route" resetKey={routeKey}>
      <Suspense fallback={<output className="app-loading">Arbeitsbereich wird geladen …</output>}>
        {children}
      </Suspense>
    </AppErrorBoundary>
  );
}

export function FeatureRouter() {
  const path = window.location.pathname;
  const ticketMatch = /^\/ticket\/([A-Za-z2-9]{12,32})$/.exec(path);
  const ticketCode = ticketMatch?.[1];
  const groupMatch = /^\/gruppe\/([A-Za-z2-9]{12,32})$/.exec(path);
  const groupCode = groupMatch?.[1];
  let view: ReactNode = <NotFoundPage />;
  if (groupCode) view = <GroupStatusView code={groupCode.toUpperCase()} />;
  else if (ticketCode) view = <TicketStatusView code={ticketCode.toUpperCase()} />;
  else if (path === "/setup") view = <SetupView />;
  else if (path === "/datenschutz") view = <PrivacyView />;
  else if (path === "/flight-director") view = <FlightDirectorView />;
  else if (path === "/flight-line") view = <FlightLineView />;
  else if (path === "/fids") view = <FidsView />;
  else if (path === "/admin") view = <AdminView />;
  else if (path === "/simulation") view = <ForecastSimulationView />;
  else if (path === "/simulation/fids") view = <SimulationFidsView />;
  else if (path === "/" || path === "/kasse") view = <CashierView />;
  return <FeatureBoundary routeKey={path}>{view}</FeatureBoundary>;
}
