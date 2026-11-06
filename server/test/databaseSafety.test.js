import {test} from "node:test";
import assert from "node:assert/strict";
import {temporaryDatabase, dropTemporaryDatabase} from "./support/database.js";

test("test database selection replaces existing names and preserves URI options", () => {
  const previous = process.env.MONGO_URI_TEST;
  process.env.MONGO_URI_TEST = "mongodb+srv://fixture:password@cluster.example/existing?authSource=admin&retryWrites=true";
  try {
    const a = temporaryDatabase("tracex_safety_test"), b = temporaryDatabase("tracex_safety_test");
    assert.notEqual(a.name, b.name);
    assert.ok(a.uri.includes("/" + a.name + "?authSource=admin&retryWrites=true"));
    assert.ok(!a.uri.includes("/existing"));
  } finally {
    if (previous === undefined) delete process.env.MONGO_URI_TEST; else process.env.MONGO_URI_TEST = previous;
  }
});

test("test cleanup refuses any database other than the generated test database", async () => {
  let dropped = false;
  const M = {dbName: () => "existing", dropDatabase: async () => { dropped = true; }};
  await assert.rejects(dropTemporaryDatabase(M, temporaryDatabase("tracex_safety_test").name), /Refusing/);
  assert.equal(dropped, false);
});
