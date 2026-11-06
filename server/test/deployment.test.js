import {test} from "node:test";
import assert from "node:assert/strict";
import {deploymentConfig} from "../../scripts/configure-vercel.mjs";

test("Vercel API rewrite precedes SPA routing and preserves the API path", () => {
  const config = deploymentConfig({}, "https://api.example.com/");
  assert.deepEqual(config.rewrites[0], {source: "/api/:path*", destination: "https://api.example.com/api/:path*"});
  const spa = new RegExp("^" + config.rewrites[1].source + "$");
  for (const path of ["/", "/dashboard", "/consumer/verify/MILK-2026-004"]) assert.ok(spa.test(path));
  for (const path of ["/api", "/api/health", "/api/not-found"]) assert.ok(!spa.test(path));
  assert.deepEqual(deploymentConfig(config, "https://next.example.com").rewrites.length, 2, "reconfiguration does not duplicate routes");
});

test("deployment configuration rejects missing and unsafe backend origins", () => {
  for (const origin of [undefined, "http://api.example.com", "https://user:password@api.example.com", "https://api.example.com/api", "https://api.example.com?q=x"]) {
    assert.throws(() => deploymentConfig({}, origin));
  }
});
