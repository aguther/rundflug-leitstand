import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { GIT_EXECUTABLE } from "./build-tool-executables.ts";
import { resolveSourceRevision } from "./source-revision.ts";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

const operationalPwa = VitePWA({
  registerType: "prompt",
  includeAssets: ["icons/pwa/brand/favicon.svg", "icons/pwa/brand/apple-touch-icon-180.png"],
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
        src: "/icons/pwa/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/pwa/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/pwa/brand/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/pwa/brand/maskable-512.png",
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
      /^\/(?:flight-director|flight-line)(?:\/|$)/,
    ],
    importScripts: ["/push-sw.js"],
    globIgnores: [
      // Administration requires a confirmed backend connection and is loaded on demand.
      "**/admin-view-*.js",
      "**/admin-view-*.css",
      "**/ForecastSimulationView-*.js",
      "**/ForecastSimulationView-*.css",
      "**/comparison-worker-*.js",
      "**/CartesianChart-*.js",
      // Historical analytics require live history endpoints and are loaded only on demand.
      "**/FlightDirectorAnalyticsContent-*.js",
      "**/flight-director-analytics-model-*.js",
    ],
  },
});

export default defineConfig(({ mode }) => {
  const simulator = mode === "simulator";
  const sourceRevision = resolveSourceRevision(process.env.SOURCE_REVISION, () =>
    execFileSync(GIT_EXECUTABLE, ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }),
  );
  return {
    build: {
      cssMinify: "lightningcss",
      manifest: true,
    },
    define: {
      "import.meta.env.SOURCE_REVISION": JSON.stringify(sourceRevision),
    },
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
