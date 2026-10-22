
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const chunks = {
  "vendor-react": ["react/", "react-dom/", "react-router/", "react-router-dom/", "scheduler/"],
  "vendor-motion": ["framer-motion", "motion-dom", "motion-utils"],
  "vendor-maps": ["leaflet/", "react-leaflet", "@react-leaflet"],
  "vendor-charts": [
    "recharts", "d3-", "victory-vendor", "recharts-scale",
    "react-smooth", "immer", "reselect", "redux",
    "@reduxjs", "react-redux", "decimal.js-light",
    "eventemitter3", "tiny-invariant", "es-toolkit"
  ]
};

export default defineConfig({
  base: "/traceX/",

  plugins: [react(), tailwind()],

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          for (const [name, packages] of Object.entries(chunks)) {
            if (packages.some(p => id.includes("/node_modules/" + p))) {
              return name;
            }
          }
        }
      }
    }
  },

  server: {
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET || "http://localhost:5000",
        changeOrigin: false
      }
    }
  }
});
