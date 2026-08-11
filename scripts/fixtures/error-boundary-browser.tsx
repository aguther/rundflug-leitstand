import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "../../apps/web/src/app/AppErrorBoundary";
import "../../apps/web/src/design-system/tokens.css";
import "../../apps/web/src/design-system/base.css";
import "../../apps/web/src/app/app-error-boundary.css";
import "./error-boundary-browser.css";

const SENSITIVE_ERROR_DETAIL = "synthetic-ticket-token-ABCD1234";
const parameters = new URLSearchParams(window.location.search);
const scope = parameters.get("scope") === "route" ? "route" : "application";
const theme = parameters.get("theme") === "dark" ? "dark" : "light";
const recoveryKey = `error-boundary-browser:${scope}:${theme}`;
const failThisDocument = window.sessionStorage.getItem(recoveryKey) !== "recovered";
window.sessionStorage.setItem(recoveryKey, "recovered");
document.documentElement.dataset.theme = theme;

function FailureProbe(): ReactNode {
  if (failThisDocument) throw new Error(SENSITIVE_ERROR_DETAIL);
  return (
    <main className="error-boundary-browser-success">
      <h1>Arbeitsbereich wiederhergestellt</h1>
      <p>Die Testansicht wurde nach dem Neuladen erneut aufgebaut.</p>
    </main>
  );
}

function BrowserFixture() {
  const content =
    scope === "route" ? (
      <AppErrorBoundary scope="route" resetKey="/synthetic-route">
        <FailureProbe />
      </AppErrorBoundary>
    ) : (
      <FailureProbe />
    );
  return <AppErrorBoundary scope="application">{content}</AppErrorBoundary>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Error-boundary browser fixture root is missing.");
createRoot(root).render(
  <StrictMode>
    <BrowserFixture />
  </StrictMode>,
);
