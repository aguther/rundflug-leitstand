import { lazy, Suspense } from "react";
import { ActionNotificationProvider } from "./app/PageNotifications";
import { AuthProvider, useAuth } from "./features/auth/AuthContext";
import { EventScopedApplication } from "./features/auth/EventScopedApplication";
import { LoginPage } from "./features/auth/LoginPage";

const ForecastSimulationView = lazy(
  () => import("./features/forecast-simulation/ForecastSimulationView"),
);

const FeatureRouter = lazy(async () => {
  const module = await import("./FeatureRouter");
  return { default: module.FeatureRouter };
});

function ApplicationLoading() {
  return (
    <div className="app-loading" role="status">
      Arbeitsbereich wird geladen …
    </div>
  );
}

function isPublicRoute(pathname: string): boolean {
  return (
    pathname === "/setup" ||
    pathname === "/privacy" ||
    pathname === "/datenschutz" ||
    /^\/gruppe\/[A-Za-z2-9]{12,32}$/.test(pathname) ||
    /^\/ticket\/[A-Za-z2-9]{12,32}$/.test(pathname)
  );
}

function AuthenticatedApplication() {
  const { session, loading } = useAuth();
  if (isPublicRoute(window.location.pathname))
    return (
      <Suspense fallback={<ApplicationLoading />}>
        <FeatureRouter />
      </Suspense>
    );
  if (loading)
    return (
      <div className="app-loading" role="status">
        Anmeldung wird geprüft …
      </div>
    );
  if (!session) return <LoginPage />;
  return <EventScopedApplication session={session} />;
}

export function App() {
  if (import.meta.env.MODE === "simulator" && window.location.pathname === "/simulation") {
    return (
      <Suspense fallback={<ApplicationLoading />}>
        <ForecastSimulationView />
      </Suspense>
    );
  }
  return (
    <ActionNotificationProvider>
      <AuthProvider>
        <AuthenticatedApplication />
      </AuthProvider>
    </ActionNotificationProvider>
  );
}
