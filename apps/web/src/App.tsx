import { lazy, Suspense } from "react";
import { destinationsForRole, homeForRole, isDestinationActive } from "./app/navigation";
import { AuthProvider, useAuth } from "./features/auth/AuthContext";
import { LoginPage } from "./features/auth/LoginPage";

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
    pathname === "/fids" ||
    pathname.startsWith("/fids/") ||
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
  const permitted = destinationsForRole(session.account.role).some((destination) =>
    isDestinationActive(
      window.location.pathname === "/" ? "/kasse" : window.location.pathname,
      destination.href,
    ),
  );
  if (!permitted) {
    window.location.replace(homeForRole(session.account.role));
    return (
      <div className="app-loading" role="status">
        Arbeitsbereich wird geöffnet …
      </div>
    );
  }
  return (
    <Suspense fallback={<ApplicationLoading />}>
      <FeatureRouter />
    </Suspense>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AuthenticatedApplication />
    </AuthProvider>
  );
}
