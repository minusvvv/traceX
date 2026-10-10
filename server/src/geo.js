// Known regions (used for manual complaint location and public-map aggregation). Coordinates are region centroids.
export const REGIONS = [
  {key: "mumbai-suburban", name: "Mumbai Suburban", lat: 19.076, lng: 72.8777},
  {key: "thane", name: "Thane", lat: 19.2183, lng: 72.9781},
  {key: "navi-mumbai", name: "Navi Mumbai", lat: 19.033, lng: 73.0297},
  {key: "pune", name: "Pune", lat: 18.5204, lng: 73.8567},
  {key: "nashik", name: "Nashik", lat: 19.9975, lng: 73.7898},
  {key: "nagpur", name: "Nagpur", lat: 21.1458, lng: 79.0882},
  {key: "solapur", name: "Solapur", lat: 17.6599, lng: 75.9064},
  {key: "chh-sambhajinagar", name: "Chhatrapati Sambhajinagar", lat: 19.8762, lng: 75.3433},
];
export const regionByName = n => REGIONS.find(r => r.name.toLowerCase() === String(n || "").toLowerCase()) || null;
export const regionByKey = k => REGIONS.find(r => r.key === k) || null;

export function haversineKm(a, b, c, d) {
  const R = 6371, rad = x => x * Math.PI / 180, dLat = rad(c - a), dLng = rad(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function nearestRegion(lat, lng, maxKm = 60) {
  if (lat == null || lng == null) return null;
  let best = null, bd = Infinity;
  for (const r of REGIONS) { const d = haversineKm(lat, lng, r.lat, r.lng); if (d < bd) { bd = d; best = r; } }
  return bd <= maxKm ? best : null;
}
