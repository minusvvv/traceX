import fs from "node:fs";
import {fileURLToPath} from "node:url";

export function deploymentConfig(current, backendOrigin) {
  if (!backendOrigin) throw new Error("Set BACKEND_ORIGIN to the HTTPS origin of the persistent TraceX API.");
  const url = new URL(backendOrigin);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("BACKEND_ORIGIN must be an HTTPS origin without credentials, path, query or fragment.");
  }
  return {...current, rewrites: [
    {source: "/api/:path*", destination: `${url.origin}/api/:path*`},
    {source: "/((?!api(?:/|$)).*)", destination: "/index.html"},
  ]};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const file = new URL("../vercel.json", import.meta.url);
  fs.writeFileSync(file, JSON.stringify(deploymentConfig(JSON.parse(fs.readFileSync(file)), process.env.BACKEND_ORIGIN), null, 2) + "\n");
  console.log("Configured same-origin /api routing in vercel.json. Review before deploying.");
}
