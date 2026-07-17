import { destinationsForRole, homeForRole, isDestinationActive } from "./app/navigation";
import { AuthProvider, useAuth } from "./features/auth/AuthContext";
import { LoginPage } from "./features/auth/LoginPage";
import { LegacyApp } from "./LegacyApp";

function isPublicRoute(pathname: string): boolean {
  return (
    pathname === "/setup" ||
    pathname === "/privacy" ||
    pathname === "/datenschutz" ||
    /^\/ticket\/[A-Za-z2-9]{12,32}$/.test(pathname)
  );
}

function AuthenticatedApplication() {
  const { session, loading } = useAuth();
  if (isPublicRoute(window.location.pathname)) return <LegacyApp />;
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
  return <LegacyApp />;
}

/**
 * Root composition for the V1.2 migration.
 *
 * Feature routes are moved out of LegacyApp one vertical slice at a time. Keeping this root free
 * from workflow state makes route guards, providers and code splitting independently testable.
 */
export function App() {
  return (
    <AuthProvider>
      <AuthenticatedApplication />
    </AuthProvider>
  );
}
