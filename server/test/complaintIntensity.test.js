import {test} from "node:test";
import assert from "node:assert/strict";
import {complaintSeverity} from "../src/domain/complaint-intensity.js";

test("complaint alert level increases with complaint count", () => {
  assert.equal(complaintSeverity(1), "safe");
  assert.equal(complaintSeverity(2), "safe");
  assert.equal(complaintSeverity(3), "review");
  assert.equal(complaintSeverity(4), "review");
  assert.equal(complaintSeverity(5), "suspicious");
  assert.equal(complaintSeverity(9), "suspicious");
  assert.equal(complaintSeverity(10), "critical");
  assert.equal(complaintSeverity(50), "critical");
});
