import fs from "node:fs";

if (process.env.VITE_API_URL && process.env.VITE_API_URL !== "/api") {
  console.warn("[deploy] VITE_API_URL is ignored: TraceX uses same-origin /api. Remove the stale setting from the frontend project.");
}

if (process.env.VERCEL) {
  const config = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url)));
  const api = config.rewrites?.find(r => r.source === "/api/:path*");
  if (!api || !api.destination.startsWith("https://")) {
    throw new Error("API routing is not configured. Run npm run configure:vercel with BACKEND_ORIGIN, review and commit vercel.json before deployment.");
  }
}
