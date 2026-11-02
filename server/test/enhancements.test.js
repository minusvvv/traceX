import {test} from "node:test";
import assert from "node:assert/strict";
import {reverseGeocodeNominatim, nearestRegion} from "../src/geo.js";
import {lookupOpenFoodFacts} from "../src/services/openfoodfacts.js";

test("geo: nearestRegion accurately calculates geographic match in Maharashtra", () => {
  // Coordinates near Thane (19.21, 72.97)
  const reg = nearestRegion(19.218, 72.978);
  assert.equal(reg.name, "Thane");
  assert.equal(reg.key, "thane");

  // Coordinates near Pune (18.52, 73.85)
  const pune = nearestRegion(18.53, 73.86);
  assert.equal(pune.name, "Pune");

  // Far away (e.g. London coordinates) returns null
  assert.equal(nearestRegion(51.5074, -0.1278), null);
});

test("geo: reverseGeocodeNominatim gracefully falls back to nearest known region", async () => {
  const res = await reverseGeocodeNominatim(19.076, 72.8777);
  assert.ok(res);
  assert.equal(res.matchedRegion, "Mumbai Suburban");
  assert.equal(res.lat, 19.076);
  assert.equal(res.lng, 72.8777);
});

test("openfoodfacts: lookup handles invalid and empty barcodes safely without throwing", async () => {
  assert.equal(await lookupOpenFoodFacts(null), null);
  assert.equal(await lookupOpenFoodFacts(""), null);
  assert.equal(await lookupOpenFoodFacts("not-a-number"), null);
  assert.equal(await lookupOpenFoodFacts("123"), null); // Too short for GTIN
});
