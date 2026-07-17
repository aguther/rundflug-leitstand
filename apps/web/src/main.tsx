import { registerSW } from "virtual:pwa-register";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./design-system/theme";
import "./design-system/tokens.css";
import "./design-system/base.css";
import "./styles.css";
import "./features/admin/admin-v12.css";
import "./features/cashier/cashier-v12.css";
import "./features/flight-line/flight-line-v12.css";

let reloadingForServiceWorkerUpdate = false;
navigator.serviceWorker?.addEventListener("controllerchange", () => {
  if (reloadingForServiceWorkerUpdate) return;
  reloadingForServiceWorkerUpdate = true;
  window.location.reload();
});

registerSW({
  immediate: true,
  onRegisteredSW: (_swScriptUrl, registration) => {
    // register() may defer another service-worker script check when deployments happen within the
    // browser's update window. update() explicitly checks the current deployment while preserving
    // the existing registration and Web-Push subscription.
    void registration?.update();
  },
});

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
