import {defineConfig} from "vite";import react from "@vitejs/plugin-react";import tailwind from "@tailwindcss/vite";
// In development /api is proxied to the Express server, so the browser sees one origin (cookies just work).
// To call a different API origin instead, set VITE_API_URL (see .env.example) and add that origin to the server's CORS_ORIGIN.
// Heavy libraries get their own long-cached chunks; with route-level lazy loading they are fetched only by pages that use them.
const chunks={"vendor-react":["react/","react-dom/","react-router/","react-router-dom/","scheduler/"],"vendor-motion":["framer-motion","motion-dom","motion-utils"],"vendor-maps":["leaflet/","react-leaflet","@react-leaflet"],"vendor-charts":["recharts","d3-","victory-vendor","recharts-scale","react-smooth","immer","reselect","redux","@reduxjs","react-redux","decimal.js-light","eventemitter3","tiny-invariant","es-toolkit"]};
export default defineConfig({plugins:[react(),tailwind()],
  build:{rollupOptions:{output:{manualChunks(id){if(!id.includes("node_modules"))return;for(const [name,pk] of Object.entries(chunks))if(pk.some(p=>id.includes("/node_modules/"+p)))return name}}}},
  server:{proxy:{"/api":{target:process.env.API_PROXY_TARGET||"http://localhost:5000",changeOrigin:false}}}});
