import { registerSW } from "virtual:pwa-register";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

let reloadingForServiceWorkerUpdate = false;
navigator.serviceWorker?.addEventListener("controllerchange", () => {
  if (reloadingForServiceWorkerUpdate) return;
  reloadingForServiceWorkerUpdate = true;
  window.location.reload();
});

registerSW({ immediate: true });

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
