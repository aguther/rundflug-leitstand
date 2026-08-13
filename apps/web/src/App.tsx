import { lazy, Suspense } from "react";
import { ActionNotificationProvider } from "./app/PageNotifications";
import { AuthProvider, useAuth } from "./features/auth/AuthContext";
import { EventScopedApplication } from "./features/auth/EventScopedApplication";
import { LoginPage } from "./features/auth/LoginPage";
import { isSimulatorRoute, SimulatorRouter } from "./SimulatorRouter";

const FeatureRouter = lazy(async () => {
  const module = await import("./FeatureRouter");
  return { default: module.FeatureRouter };
});

function ApplicationLoading() {
  return <output className="app-loading">Arbeitsbereich wird geladen …</output>;
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
  if (loading) return <output className="app-loading">Anmeldung wird geprüft …</output>;
  if (!session) return <LoginPage />;
  return <EventScopedApplication session={session} />;
}

export function App() {
  if (import.meta.env.MODE === "simulator" && isSimulatorRoute(window.location.pathname))
    return <SimulatorRouter />;
  return (
    <ActionNotificationProvider>
      <AuthProvider>
        <AuthenticatedApplication />
      </AuthProvider>
    </ActionNotificationProvider>
  );
}
