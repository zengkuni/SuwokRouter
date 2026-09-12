import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll("\\", "/");
          const nodeModulesMarker = "/node_modules/";
          const nodeModulesIndex = normalizedId.lastIndexOf(nodeModulesMarker);

          if (nodeModulesIndex === -1) return undefined;

          const packagePath = normalizedId.slice(
            nodeModulesIndex + nodeModulesMarker.length,
          );
          const isPackage = (packageName: string) =>
            packagePath === packageName ||
            packagePath.startsWith(`${packageName}/`);

          if (
            isPackage("react") ||
            isPackage("react-dom") ||
            isPackage("react-router") ||
            isPackage("react-router-dom") ||
            isPackage("@remix-run/router") ||
            isPackage("scheduler")
          ) {
            return "react-vendor";
          }

          if (
            isPackage("@tanstack/react-query") ||
            isPackage("@tanstack/query-core") ||
            isPackage("@tanstack/react-virtual")
          ) {
            return "query-vendor";
          }

          if (isPackage("motion") || isPackage("motion-dom")) {
            return "motion-vendor";
          }

          if (isPackage("@base-ui/react")) {
            return "ui-vendor";
          }

          if (isPackage("lucide-react")) {
            return "icons-vendor";
          }

          if (isPackage("react-markdown") || isPackage("remark-gfm")) {
            return "markdown-vendor";
          }

          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:14045",
        changeOrigin: true,
      },
      "/health": {
        target: "http://127.0.0.1:14045",
        changeOrigin: true,
      },
      "/v1": {
        target: "http://127.0.0.1:14045",
        changeOrigin: true,
      },
    },
  },
});
