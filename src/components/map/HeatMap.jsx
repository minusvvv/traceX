import {useEffect, useMemo, useRef} from "react";
import {MapContainer, TileLayer, Circle, Polyline, Tooltip, Popup, useMap} from "react-leaflet";

// Design Tokens strictly from index.css
export const THEME = {
  deep:    "#274245",
  deep2:   "#1D3336",
  deep3:   "#365B5C",
  cream:   "#DFD6AE",
  sand:    "#E8DDC7",
  off:     "#F5F2E9",
  ink:     "#203437",
  muted:   "#718080",
  line:    "#D9D3BF",
  paper:   "#FBF9F3",
  safe:    "#6B8E5A",
  sage:    "#8FAA8B",
  review:  "#C58B3A",
  susp:    "#B85450",
  crit:    "#7F1D1D",
};

// Requirement 1: Category Color Mapping (Theme Tokens Only)
export const CATEGORY_COLORS = {
  dairy:      THEME.deep3,   // #365B5C (deep-3)
  edible_oil: THEME.review,  // #C58B3A (review)
  beverage:   THEME.sage,    // #8FAA8B (sage)
  snack:      THEME.susp,    // #B85450 (susp)
  grain:      THEME.deep,    // #274245 (deep)
  other:      THEME.muted,   // #718080 (muted)
};

export const CATEGORY_LABELS = {
  dairy:      "Dairy / Milk",
  edible_oil: "Edible Oils",
  beverage:   "Beverages",
  snack:      "Snacks",
  grain:      "Grains",
  other:      "Other",
};

// Requirement 3: Spot Colors derived strictly from Alert Tokens
export function getSeverityAlertColor(reportsOrSeverity) {
  if (typeof reportsOrSeverity === "number") {
    if (reportsOrSeverity >= 10) return THEME.crit;   // #7F1D1D (Critical 10+)
    if (reportsOrSeverity >= 5)  return THEME.susp;   // #B85450 (High 5–9)
    if (reportsOrSeverity >= 3)  return THEME.review; // #C58B3A (Moderate 3–4)
    return THEME.safe;                                // #6B8E5A (Low 1–2)
  }
  const s = String(reportsOrSeverity || "").toLowerCase();
  if (s === "critical" || s === "crit") return THEME.crit;
  if (s === "suspicious" || s === "susp") return THEME.susp;
  if (s === "review") return THEME.review;
  return THEME.safe;
}

export function getSeverityLabel(reportsOrSeverity) {
  if (typeof reportsOrSeverity === "number") {
    if (reportsOrSeverity >= 10) return "Critical";
    if (reportsOrSeverity >= 5)  return "Suspicious";
    if (reportsOrSeverity >= 3)  return "Review";
    return "Safe";
  }
  const s = String(reportsOrSeverity || "").toLowerCase();
  if (s === "critical" || s === "crit") return "Critical";
  if (s === "suspicious" || s === "susp") return "Suspicious";
  if (s === "review") return "Review";
  return "Safe";
}

// Theme tokens for separate batch distinguishing in category views
export const THEME_BATCH_PALETTE = [
  THEME.deep3,  // #365B5C
  THEME.review, // #C58B3A
  THEME.sage,   // #8FAA8B
  THEME.susp,   // #B85450
  THEME.deep,   // #274245
  THEME.muted,  // #718080
  THEME.crit,   // #7F1D1D
  THEME.safe,   // #6B8E5A
  THEME.cream,  // #DFD6AE
];

export function batchColor(batchId, batchList = []) {
  if (!batchId) return THEME.muted;
  if (Array.isArray(batchList) && batchList.length) {
    const idx = batchList.indexOf(batchId);
    if (idx !== -1) return THEME_BATCH_PALETTE[idx % THEME_BATCH_PALETTE.length];
  }
  let hash = 0;
  for (let i = 0; i < batchId.length; i++) {
    hash = batchId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return THEME_BATCH_PALETTE[Math.abs(hash) % THEME_BATCH_PALETTE.length];
}

function Fit({ pts }) {
  const map = useMap();
  const hasFittedRef = useRef(false);

  useEffect(() => {
    if (!hasFittedRef.current && pts.length > 0) {
      map.invalidateSize();
      map.fitBounds(pts, { padding: [50, 50], maxZoom: 9 });
      hasFittedRef.current = true;
    }
  }, [pts, map]);

  return null;
}

// Legacy heatmap mode with strict theme tokens and 3-circle radial bloom structure
function HeatmapMode({hotspots, variant, labels}) {
  const pts = hotspots.map(h => [h.lat, h.lng]);
  return (
    <>
      <Fit pts={pts}/>
      {[...hotspots].sort((a, b) => a.reports - b.reports).flatMap(h => {
        const spotColor = getSeverityAlertColor(h.reports);
        const sevLabel = getSeverityLabel(h.reports);
        return [
          {scale: 1.0,  fillOpacity: 0.12, stroke: false, isCore: false},
          {scale: 0.62, fillOpacity: 0.28, stroke: false, isCore: false},
          {scale: 0.30, fillOpacity: 0.90, stroke: true,  isCore: true},
        ].map(({scale, fillOpacity, stroke, isCore}, i) => (
          <Circle
            key={`${h.region}-${h.lat}-${h.lng}-${i}`}
            center={[h.lat, h.lng]}
            radius={h.radius * scale}
            pathOptions={{
              stroke,
              weight: isCore ? 1.5 : 0,
              color: isCore ? THEME.off : spotColor,
              fillColor: spotColor,
              fillOpacity,
            }}
          >
            {isCore && (
              <Tooltip sticky direction="top" offset={[0, -10]} opacity={1}>
                <div
                  style={{
                    background: THEME.off,
                    color: THEME.ink,
                    fontFamily: "Inter, system-ui, sans-serif",
                    borderColor: THEME.line,
                  }}
                  className="p-2.5 rounded-xl text-xs space-y-1.5 border shadow-sm"
                >
                  <div style={{color: THEME.deep}} className="font-semibold text-sm leading-tight">
                    {variant === "public" ? `${h.reports} Consumer Reports` : h.region}
                  </div>
                  {variant !== "public" && (
                    <div style={{color: THEME.muted}} className="text-[11px] leading-relaxed">
                      Reports: {h.reports} · Affected batches: {h.batches}<br/>
                      Lab confirmed: {h.lab} · Open investigations: {h.open}<br/>
                      Stage: {h.stage}
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1 border-t" style={{borderColor: THEME.line}}>
                    <span style={{color: THEME.muted}}>Severity:</span>
                    <span
                      style={{
                        background: `${spotColor}1a`,
                        color: spotColor,
                        borderColor: `${spotColor}44`,
                      }}
                      className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border"
                    >
                      {sevLabel}
                    </span>
                  </div>
                </div>
              </Tooltip>
            )}
          </Circle>
        ));
      })}
    </>
  );
}

// Enhanced map mode: 3-circle radial bloom spots, aesthetic thin connection lines, and interactive theme popups
function EnhancedMode({points = [], connections = [], colorMode = "category", showConnections = true, highlightedBatchId = null}) {
  const pts = points.map(p => [p.lat, p.lng]);

  const uniqueBatches = useMemo(() => {
    const s = new Set();
    points.forEach(p => { if (p.batchId) s.add(p.batchId); });
    connections.forEach(c => { if (c.batchId) s.add(c.batchId); });
    return [...s];
  }, [points, connections]);

  // Aggregate points by node location [lat, lng, batchId]
  const aggregatedNodes = useMemo(() => {
    const map = new Map();
    for (const p of points) {
      const key = `${p.lat},${p.lng}:${p.batchId || "nobatch"}`;
      let node = map.get(key);
      if (!node) {
        node = {
          ...p,
          count: p.count || 1,
        };
        map.set(key, node);
      } else {
        node.count += (p.count || 1);
        if (p.isOwn) node.isOwn = true;
      }
    }
    return [...map.values()];
  }, [points]);

  return (
    <>
      <Fit pts={pts}/>

      {/* Requirement 2: Aesthetic Thin Connection Lines */}
      {/* Edge style: solid line (weight: 1.2), color strictly from category token or #7F1D1D for crit, opacity 0.7 */}
      {showConnections && connections.map((conn, idx) => {
        if (!conn.points || conn.points.length < 2) return null;
        const isCrit = conn.severity === "critical" || conn.severity === "crit";
        const lineColor = isCrit
          ? THEME.crit
          : (CATEGORY_COLORS[conn.category] || THEME.muted);
        const isHighlighted = highlightedBatchId && conn.batchId === highlightedBatchId;
        const isDimmed = highlightedBatchId && conn.batchId !== highlightedBatchId;

        return (
          <Polyline
            key={`conn-${conn.batchId || idx}`}
            positions={conn.points}
            pathOptions={{
              color: lineColor,
              weight: isHighlighted ? 2.5 : 1.2,
              opacity: isHighlighted ? 1 : isDimmed ? 0.18 : 0.7,
            }}
          >
            <Tooltip sticky direction="top" offset={[0, -6]} opacity={1}>
              <div
                style={{
                  background: THEME.off,
                  color: THEME.ink,
                  fontFamily: "Inter, system-ui, sans-serif",
                  borderColor: THEME.line,
                }}
                className="p-2 rounded-xl text-xs space-y-0.5 border shadow-sm"
              >
                <div style={{color: THEME.deep}} className="font-semibold text-xs">
                  Batch {conn.batchId} {conn.lot ? `(${conn.lot})` : ""}
                </div>
                <div style={{color: THEME.muted}} className="text-[11px]">
                  {conn.productName || "Product"} · {conn.interRegional ? "Inter-regional Route" : "Regional Transit Network"}
                </div>
              </div>
            </Tooltip>
          </Polyline>
        );
      })}

      {/* Requirement 3: Layered Glow Spots (Radial Bloom Structure [1, 0.62, 0.3]) */}
      {aggregatedNodes.map((node, i) => {
        const count = node.count || 1;
        const spotColor = getSeverityAlertColor(node.severity || count);
        const sevLabel = getSeverityLabel(node.severity || count);
        const catKey = node.category || "other";
        const catLabel = CATEGORY_LABELS[catKey] || catKey.replace("_", " ");
        const catColor = CATEGORY_COLORS[catKey] || THEME.muted;

        // Radius calculation: 2400m base radius for 1 report, dynamically scaling with complaint count
        const baseRadius = 2400;
        const totalRadius = count === 1 ? baseRadius : Math.min(baseRadius + (count - 1) * 2800, 32000);

        // Requirement 4: Interactive Theme Tooltips & Popups styled with theme tokens
        const themeCard = (
          <div
            style={{
              background: THEME.off,
              color: THEME.ink,
              fontFamily: "Inter, system-ui, sans-serif",
              borderColor: THEME.line,
            }}
            className="p-2.5 min-w-[210px] max-w-[260px] rounded-xl text-xs space-y-2 border shadow-sm"
          >
            {/* Header: Product Name + Category Badge */}
            <div
              style={{borderColor: THEME.line}}
              className="flex items-start justify-between gap-2 border-b pb-1.5"
            >
              <div>
                <div style={{color: THEME.deep}} className="font-semibold text-sm leading-snug">
                  {node.productName || "Product"}
                </div>
                <div style={{color: THEME.muted}} className="text-[11px] mt-0.5">
                  {node.region || "Reported Area"}
                </div>
              </div>
              <span
                style={{background: catColor, color: THEME.off}}
                className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0"
              >
                {catLabel}
              </span>
            </div>

            {/* Product Name, Batch Number, Severity Badge, and Complaint Count */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span style={{color: THEME.muted}}>Batch / LOT:</span>
                <span style={{color: THEME.ink}} className="font-mono font-medium">
                  {node.batchId || "—"} {node.lot ? `(${node.lot})` : ""}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span style={{color: THEME.muted}}>Severity:</span>
                <span
                  style={{
                    background: `${spotColor}1a`,
                    color: spotColor,
                    borderColor: `${spotColor}44`,
                  }}
                  className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border"
                >
                  {sevLabel}
                </span>
              </div>

              <div
                style={{
                  background: `${THEME.sand}55`,
                  borderColor: `${THEME.line}80`,
                }}
                className="flex items-center justify-between rounded p-1.5 border text-xs"
              >
                <span style={{color: THEME.deep}} className="font-medium">Recorded Complaints:</span>
                <span style={{color: THEME.ink}} className="text-sm font-bold">
                  {count} {count === 1 ? "report" : "reports"}
                </span>
              </div>

              {node.isOwn && (
                <div
                  style={{
                    background: `${THEME.cream}66`,
                    color: THEME.deep,
                    borderColor: THEME.line,
                  }}
                  className="text-[10.5px] font-medium border rounded px-1.5 py-0.5 text-center"
                >
                  Your reported complaint
                </div>
              )}
            </div>
          </div>
        );

        // 3 concentric circles: [1, 0.62, 0.3]
        const concentricScales = [
          {scale: 1.0,  fillOpacity: 0.12, stroke: false, isCore: false},
          {scale: 0.62, fillOpacity: 0.28, stroke: false, isCore: false},
          {scale: 0.30, fillOpacity: 0.90, stroke: true,  isCore: true},
        ];

        return concentricScales.map(({scale, fillOpacity, stroke, isCore}, circleIdx) => (
          <Circle
            key={`node-${node.id || i}-${circleIdx}`}
            center={[node.lat, node.lng]}
            radius={totalRadius * scale}
            pathOptions={{
              stroke,
              weight: isCore ? 1.5 : 0,
              color: isCore ? THEME.off : spotColor,
              fillColor: spotColor,
              fillOpacity,
            }}
          >
            {isCore && (
              <>
                <Tooltip sticky direction="top" offset={[0, -10]} opacity={1}>
                  {themeCard}
                </Tooltip>
                <Popup>
                  {themeCard}
                </Popup>
              </>
            )}
          </Circle>
        ));
      })}
    </>
  );
}

export default function HeatMap({
  hotspots = [],
  className = "",
  variant = "internal",
  labels,
  mode = "heatmap",  // "heatmap" | "enhanced"
  points = [],
  connections = [],
  colorMode = "category",
  showConnections = true,
  highlightedBatchId = null,
}) {
  return (
    <MapContainer
      className={className}
      center={[19.0, 73.4]}
      zoom={7}
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {mode === "heatmap" ? (
        <HeatmapMode hotspots={hotspots} variant={variant} labels={labels}/>
      ) : (
        <EnhancedMode
          points={points}
          connections={connections}
          colorMode={colorMode}
          showConnections={showConnections}
          highlightedBatchId={highlightedBatchId}
        />
      )}
    </MapContainer>
  );
}
