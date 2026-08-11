import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("../../scripts/fixtures", import.meta.url)),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    strictPort: true,
  },
});
