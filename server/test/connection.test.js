import {test} from "node:test";
import assert from "node:assert/strict";
import {createConnectionManager} from "../src/connection.js";

test("connection initialization is shared and warm requests skip initialization", async () => {
  let connected = false, attempts = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const ensure = createConnectionManager({isConnected: () => connected, connect: async () => { attempts++; await gate; connected = true; }});
  const requests = Array.from({length: 20}, () => ensure("test-uri"));
  await Promise.resolve();
  assert.equal(attempts, 1);
  release(); await Promise.all(requests);
  await ensure("test-uri"); assert.equal(attempts, 1);
  connected = false;
  await ensure("test-uri"); assert.equal(attempts, 2, "explicit disconnect can reconnect");
});

test("failed cold starts do not poison subsequent connection attempts", async () => {
  let attempts = 0;
  const ensure = createConnectionManager({isConnected: () => false, connect: async () => { if (++attempts === 1) throw new Error("offline"); }});
  const failed = await Promise.allSettled([ensure("test-uri"), ensure("test-uri")]);
  assert.ok(failed.every(r => r.status === "rejected"));
  await ensure("test-uri"); assert.equal(attempts, 2);
});
