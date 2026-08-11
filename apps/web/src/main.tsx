import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/barlow-condensed/latin-200.css";
import "@fontsource/barlow-condensed/latin-400.css";
import { App } from "./App";
import { AppErrorBoundary } from "./app/AppErrorBoundary";
import "./app/app-error-boundary.css";
import { applyInitialInstallMetadata } from "./app/install-metadata";
import { applyInitialTheme, ThemeProvider } from "./design-system/theme";
import "./design-system/tokens.css";
import "./styles.css";
import "./features/ui-finish-v12.css";
import "./design-system/base.css";
import "./design-system/components.css";

applyInitialInstallMetadata();
applyInitialTheme();

if (import.meta.env.MODE !== "simulator") {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({
      immediate: true,
    });
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
