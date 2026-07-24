import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const operationalPwa = VitePWA({
  registerType: "autoUpdate",
  includeAssets: ["icons/app-icon.svg", "icons/app-icon-180.png"],
  manifest: {
    name: "Rundflug-Leitstand",
    short_name: "Leitstand",
    description: "Operations-Management für Rundflüge auf Flugplatzfesten",
    lang: "de",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7fa",
    theme_color: "#102a43",
    icons: [
      {
        src: "/icons/app-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/app-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/app-icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  },
  workbox: {
    navigateFallback: "/index.html",
    navigateFallbackDenylist: [
      /^\/api(?:\/|$)/,
      /^\/(?:ticket|gruppe)\//,
      /^\/(?:kasse|admin|fids)(?:\/|$)/,
      /^\/flight-line(?:\/|$)/,
    ],
    importScripts: ["/push-sw.js"],
    globIgnores: [
      "**/ForecastSimulationView-*.js",
      "**/ForecastSimulationView-*.css",
      "**/comparison-worker-*.js",
    ],
  },
});

export default defineConfig(({ mode }) => {
  const simulator = mode === "simulator";
  return {
    plugins: simulator ? [react()] : [react(), ...operationalPwa],
    resolve: {
      alias: simulator
        ? [
            {
              find: "virtual:pwa-register",
              replacement: fileURLToPath(
                new URL("./src/app/pwa-register-disabled.ts", import.meta.url),
              ),
            },
          ]
        : [],
    },
    server: {
      port: 5173,
      proxy: simulator
        ? {}
        : {
            "/api": {
              target: "http://127.0.0.1:8787",
              changeOrigin: true,
              ws: true,
            },
          },
    },
  };
});
