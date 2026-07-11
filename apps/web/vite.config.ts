import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [],
      manifest: {
        name: "Rundflug-Leitstand",
        short_name: "Leitstand",
        description: "Operations-Management für Rundflüge auf Flugplatzfesten",
        lang: "de",
        start_url: "/",
        display: "standalone",
        background_color: "#f4f7fa",
        theme_color: "#102a43",
        icons: [],
      },
      workbox: {
        navigateFallback: "/index.html",
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
