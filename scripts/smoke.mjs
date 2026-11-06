// Read-only deployment checks. Does not create accounts, complaints or reports.
const base = process.argv[2]?.replace(/\/$/, "");
if (!base || !/^https?:\/\//.test(base)) throw new Error("Usage: npm run smoke -- https://your-deployment.example");
const cases = [
  ["/api/health", 200, true], ["/api/public/meta", 200, true],
  ["/api/batches", 401, true], ["/api/not-a-route", 404, true],
  ["/", 200, false], ["/login", 200, false], ["/dashboard", 200, false],
];
if (process.env.SMOKE_BATCH_ID) cases.push(["/api/public/batches/" + encodeURIComponent(process.env.SMOKE_BATCH_ID), 200, true]);
for (const [path, status, json] of cases) {
  const res = await fetch(base + path, {signal: AbortSignal.timeout(15000), redirect: "error"});
  const type = res.headers.get("content-type") || "";
  if (res.status !== status || !type.includes(json ? "application/json" : "text/html")) {
    throw new Error(`${path}: expected ${status} ${json ? "JSON" : "HTML"}; received ${res.status} ${type}`);
  }
  if (json) {
    const data = await res.json();
    if (path === "/api/health" && data.ok !== true) throw new Error("Database health check failed");
  }
  console.log(`PASS ${path}: ${res.status}`);
}
