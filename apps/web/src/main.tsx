import { registerSW } from "virtual:pwa-register";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./design-system/theme";
import "./design-system/tokens.css";
import "./styles.css";
import "./features/admin/admin-v12.css";
import "./features/cashier/cashier-v12.css";
import "./features/flight-line/flight-line-v12.css";
import "./features/fids/fids-v12.css";
import "./features/ui-finish-v12.css";
import "./features/operations-finish-v12.css";
import "./features/admin/admin-v15.css";
import "./features/flight-line/flight-line-assist-v15.css";
import "./design-system/base.css";
import "./design-system/components.css";

registerSW({
  immediate: true,
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
