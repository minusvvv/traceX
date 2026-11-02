import {useEffect, useState} from "react";
import {MapContainer, TileLayer, Circle, Polyline, Popup, Marker, useMap} from "react-leaflet";
import {complaintIntensityColor, complaintSeverity, complaintSeverityLabel} from "../../utils/complaintIntensity.js";
import {Network, Layers} from "lucide-react";

function Fit({pts}) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    if (pts.length) map.fitBounds(pts, {padding: [50, 50], maxZoom: 9});
  }, [pts, map]);
  return null;
}

export default function HeatMap({
  hotspots = [],
  correlations = null,
  className = "",
  variant = "internal",
  labels,
  initialConnect = false,
}) {
  const [connectAreas, setConnectAreas] = useState(initialConnect);
  const pts = [
    ...hotspots.map(h => [h.lat, h.lng]),
    ...(correlations?.nodes?.map(n => [n.lat, n.lng]) || []),
  ].filter(([lat, lng]) => lat && lng);

  const links = correlations?.links || [];
  const facilityNodes = correlations?.nodes?.filter(n => n.type === "facility") || [];

  return (
    <div className="relative w-full h-full">
      {/* Floating Toggle for Correlation Graph */}
      {correlations && correlations.links?.length > 0 && (
        <div className="absolute top-3 right-3 z-[1000] bg-white/95 backdrop-blur-md rounded-xl p-2 shadow-md border border-line flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setConnectAreas(prev => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-colors ${
              connectAreas
                ? "bg-deep text-white shadow-sm"
                : "bg-paper text-muted hover:text-deep hover:bg-cream"
            }`}
          >
            <Network size={14} aria-hidden />
            {connectAreas ? "Hide Connected Areas" : "Connect Problem Areas"}
          </button>
          <span className="text-[11px] text-muted pr-1">
            ({correlations.links.length} links)
          </span>
        </div>
      )}

      <MapContainer className={className} center={[19.0, 73.4]} zoom={8} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Fit pts={pts} />

        {/* 1. Hotspot Circles */}
        {[...hotspots]
          .sort((a, b) => a.reports - b.reports)
          .flatMap(h =>
            [1, 0.62, 0.3].map((k, i) => {
              const color = complaintIntensityColor(h.reports);
              const severity = complaintSeverity(h.reports);
              return (
                <Circle
                  key={h.region + h.lat + h.lng + i}
                  center={[h.lat, h.lng]}
                  radius={h.radius * k}
                  pathOptions={{
                    stroke: i === 0,
                    weight: 1,
                    color,
                    fillColor: color,
                    fillOpacity: 0.1 + i * 0.07,
                  }}
                >
                  {i === 0 && (
                    <Popup>
                      {variant === "public" ? (
                        <>
                          {labels?.reports ? (
                            labels.reports(h.reports)
                          ) : (
                            <b>{h.reports} consumer reports</b>
                          )}
                        </>
                      ) : (
                        <>
                          <b>{h.region}</b>
                          <br />
                          Reports: {h.reports} · Affected batches: {h.batches}
                          <br />
                          Lab confirmed: {h.lab} · Open investigations: {h.open}
                          <br />
                          Stage requiring investigation: {h.stage}
                          {h.distributionNodes != null && (
                            <>
                              <br />
                              Distribution nodes: {h.distributionNodes}
                            </>
                          )}
                        </>
                      )}
                      {severity !== "safe" && (
                        <>
                          <br />
                          <b>
                            {variant === "public" && labels?.alert
                              ? labels.alert(complaintSeverityLabel[severity])
                              : `${complaintSeverityLabel[severity]} complaint activity alert`}
                          </b>
                        </>
                      )}
                    </Popup>
                  )}
                </Circle>
              );
            })
          )}

        {/* 2. Facility Nodes (Origin Factories) */}
        {connectAreas &&
          facilityNodes.map(f => (
            <Circle
              key={f.id}
              center={[f.lat, f.lng]}
              radius={7000}
              pathOptions={{
                color: "#1e3a8a",
                fillColor: "#3b82f6",
                fillOpacity: 0.8,
                weight: 2,
              }}
            >
              <Popup>
                <b>🏭 Origin / Manufacturing Facility</b>
                <br />
                {f.name}
                <br />
                <span className="text-muted">Originating problem batch(es): {f.batches.join(", ")}</span>
              </Popup>
            </Circle>
          ))}

        {/* 3. Connection Arcs & Correlation Lines */}
        {connectAreas &&
          links.map(l => {
            const isCorrelation = l.type === "batch_correlation";
            const color = isCorrelation
              ? l.status === "critical"
                ? "#dc2626"
                : "#ea580c"
              : "#2563eb";

            return (
              <Polyline
                key={l.id}
                positions={[l.from, l.to]}
                pathOptions={{
                  color,
                  weight: isCorrelation ? 3.5 : 2,
                  dashArray: isCorrelation ? "8, 8" : undefined,
                  opacity: isCorrelation ? 0.9 : 0.6,
                }}
              >
                <Popup>
                  <div className="text-xs space-y-1">
                    <p className="font-semibold text-deep">
                      {isCorrelation ? "🔗 Cross-Region Batch Correlation" : "🚚 Batch Distribution Transit"}
                    </p>
                    <p>
                      <b>{l.fromName}</b> ➔ <b>{l.toName}</b>
                    </p>
                    <p className="text-muted">
                      Batch ID: <span className="font-mono text-deep font-semibold">{l.batchId}</span>
                      <br />
                      Product: {l.product}
                    </p>
                    {isCorrelation && (
                      <p className="text-crit font-medium">
                        Both locations report issues for the same batch! Joint reports: {l.jointReports}
                      </p>
                    )}
                  </div>
                </Popup>
              </Polyline>
            );
          })}
      </MapContainer>
    </div>
  );
}
