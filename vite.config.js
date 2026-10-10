import {defineConfig} from "vite";import react from "@vitejs/plugin-react";import tailwind from "@tailwindcss/vite";
// In development /api is proxied to the Express server, so the browser sees one origin (cookies just work).
// To call a different API origin instead, set VITE_API_URL (see .env.example) and add that origin to the server's CORS_ORIGIN.
export default defineConfig({plugins:[react(),tailwind()],server:{proxy:{"/api":{target:process.env.API_PROXY_TARGET||"http://localhost:5000",changeOrigin:false}}}});
