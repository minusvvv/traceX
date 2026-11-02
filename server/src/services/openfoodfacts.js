// Open Food Facts API integration (free, open product database).
// Provides live GTIN/barcode product lookup with automatic category mapping to TraceX categories.

const OFF_API_BASE = "https://world.openfoodfacts.org/api/v2/product";
const USER_AGENT = "TraceX-FoodSafety-App/1.0 (contact: info@tracex.demo)";

export async function lookupOpenFoodFacts(barcode) {
  const code = String(barcode || "").trim();
  if (!code || !/^\d{6,14}$/.test(code)) return null;

  try {
    const res = await fetch(`${OFF_API_BASE}/${encodeURIComponent(code)}.json`, {
      headers: {"User-Agent": USER_AGENT, Accept: "application/json"},
      signal: AbortSignal.timeout(4500),
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;

    const p = data.product;
    const tags = [
      ...(p.categories_tags || []),
      ...(p._keywords || []),
      p.generic_name || "",
      p.product_name || "",
    ].join(" ").toLowerCase();

    // Map Open Food Facts categories into one of TraceX's 6 domain categories
    let category = "other";
    if (tags.includes("dair") || tags.includes("milk") || tags.includes("cheese") || tags.includes("yogurt") || tags.includes("butter") || tags.includes("paneer")) {
      category = "dairy";
    } else if (tags.includes("beverag") || tags.includes("juice") || tags.includes("drink") || tags.includes("water") || tags.includes("soda") || tags.includes("tea") || tags.includes("coffee")) {
      category = "beverage";
    } else if (tags.includes("oil") || tags.includes("fat") || tags.includes("ghee")) {
      category = "edible_oil";
    } else if (tags.includes("snack") || tags.includes("biscuit") || tags.includes("chip") || tags.includes("crisp") || tags.includes("cookie") || tags.includes("namkeen") || tags.includes("cracker")) {
      category = "snack";
    } else if (tags.includes("grain") || tags.includes("cereal") || tags.includes("flour") || tags.includes("atta") || tags.includes("rice") || tags.includes("wheat") || tags.includes("pulses")) {
      category = "grain";
    }

    return {
      found: true,
      source: "openfoodfacts",
      gtin: code,
      name: p.product_name || p.product_name_en || p.generic_name || "Packaged Food Product",
      brand: p.brands || p.brand_owner || "Verified Brand",
      category,
      imageUrl: p.image_front_url || p.image_front_small_url || p.image_url || null,
      ingredients: p.ingredients_text || p.ingredients_text_en || null,
      quantity: p.quantity || null,
      nutriscore: p.nutriscore_grade ? String(p.nutriscore_grade).toUpperCase() : null,
      nova: p.nova_group ?? null,
      countries: p.countries || null,
      verifiedAt: new Date().toISOString(),
    };
  } catch {
    // If Open Food Facts is slow, offline or unreachable, return null without breaking TraceX
    return null;
  }
}
