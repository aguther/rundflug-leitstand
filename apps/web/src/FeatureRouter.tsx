import { lazy, type ReactNode, Suspense } from "react";

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
const ForecastSimulationView = lazy(
  () => import("./features/forecast-simulation/ForecastSimulationView"),
);
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

function FeatureBoundary({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="app-loading" role="status">
          Arbeitsbereich wird geladen …
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

export function FeatureRouter() {
  const path = window.location.pathname;
  const ticketMatch = path.match(/^\/ticket\/([A-Za-z2-9]{12,32})$/);
  const ticketCode = ticketMatch?.[1];
  const groupMatch = path.match(/^\/gruppe\/([A-Za-z2-9]{12,32})$/);
  const groupCode = groupMatch?.[1];
  let view: ReactNode = <CashierView />;
  if (groupCode) view = <GroupStatusView code={groupCode.toUpperCase()} />;
  else if (ticketCode) view = <TicketStatusView code={ticketCode.toUpperCase()} />;
  else if (path === "/setup") view = <SetupView />;
  else if (path === "/datenschutz") view = <PrivacyView />;
  else if (path === "/flight-director" || path === "/flight-line") view = <FlightLineView />;
  else if (path === "/fids") view = <FidsView />;
  else if (path === "/admin") view = <AdminView />;
  else if (path === "/simulation") view = <ForecastSimulationView />;
  return <FeatureBoundary>{view}</FeatureBoundary>;
}
