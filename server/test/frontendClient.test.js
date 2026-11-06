import {test, afterEach} from "node:test";
import assert from "node:assert/strict";
import {apiUrl, request, ApiError} from "../../src/services/http.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("auth, attachments and exports share the exact same-origin API prefix", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({url, options});
    return new Response(JSON.stringify({ok: true}), {headers: {"Content-Type": "application/json"}});
  };
  await request("/auth/register", {method: "POST", body: {name: "Fixture", email: "fixture@example.com", password: "fixture-password"}});
  await request("/auth/login", {method: "POST", body: {email: "fixture@example.com", password: "fixture-password"}});
  await request("/auth/logout", {method: "POST", body: {}});
  assert.deepEqual(calls.map(c => c.url), ["/api/auth/register", "/api/auth/login", "/api/auth/logout"]);
  assert.ok(calls.every(c => c.options.credentials === "include" && c.options.headers["X-TraceX-Client"] === "web"));
  assert.equal(apiUrl("/attachments/fixture"), "/api/attachments/fixture");
  assert.equal(apiUrl("/reports/fixture/export?format=pdf"), "/api/reports/fixture/export?format=pdf");
});

test("HTML proxy fallbacks and error pages are explicit API failures", async () => {
  for (const status of [200, 404]) {
    globalThis.fetch = async () => new Response("<!doctype html><title>Frontend</title>", {status, headers: {"Content-Type": "text/html"}});
    await assert.rejects(request("/public/meta"), error => error instanceof ApiError && error.status === (status === 200 ? 502 : 404) && error.code === "INVALID_API_RESPONSE");
  }
});

test("validation errors retain field messages and network failures remain actionable", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({error: "Invalid input", fields: {email: "Enter a valid email"}}), {status: 422});
  await assert.rejects(request("/auth/register", {method: "POST", body: {}}), error => error.status === 422 && error.fields.email === "Enter a valid email");
  globalThis.fetch = async () => { throw new TypeError("Network unavailable"); };
  await assert.rejects(request("/auth/login"), error => error.status === 0 && error.message.includes("Cannot reach"));
});
