import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/barlow-condensed/latin-200.css";
import "@fontsource/barlow-condensed/latin-400.css";
import { App } from "./App";
import { AppErrorBoundary } from "./app/AppErrorBoundary";
import "./app/app-error-boundary.css";
import { applyInitialInstallMetadata } from "./app/install-metadata";
import { PWA_UPDATE_CONTROLLER_READY_EVENT } from "./app/pwa-update-events";
import { applyInitialTheme, ThemeProvider } from "./design-system/theme";
import "./design-system/tokens.css";
import "./styles.css";
import "./features/ui-finish-shared.css";
import "./design-system/base.css";
import "./design-system/components.css";

applyInitialInstallMetadata();
applyInitialTheme();

if (import.meta.env.MODE !== "simulator") {
  const { registerSW } = await import("virtual:pwa-register");
  const updateServiceWorker = registerSW({
    immediate: true,
    onNeedReload() {
      window.dispatchEvent(new Event(PWA_UPDATE_CONTROLLER_READY_EVENT));
    },
    onNeedRefresh() {
      window.rundflugPwaUpdateServiceWorker = updateServiceWorker;
      window.dispatchEvent(new Event("rundflug:pwa-update-available"));
    },
  });
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary scope="application">
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
