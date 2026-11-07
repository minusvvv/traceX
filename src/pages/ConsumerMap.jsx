import {useEffect, useState, useCallback, useMemo} from "react";
import {Link} from "react-router-dom";
import {MapPinned, MessageSquareWarning, RefreshCw, Navigation, Building2, UserCheck, Layers, Lock} from "lucide-react";
import useAsync from "../hooks/useAsync.js";
import {getPublicCorrelations, getMyComplaints} from "../services/api.js";
import useMeta from "../hooks/useMeta.js";
import HeatMap, {
  THEME,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  batchColor,
  getSeverityAlertColor,
  getSeverityLabel,
} from "../components/map/HeatMap.jsx";
import LoadingState from "../components/common/LoadingState.jsx";
import {ErrorState, Select, Empty} from "../components/common/Form.jsx";
import {useT} from "../i18n/index.jsx";
import {useAuth} from "../auth/AuthContext.jsx";
import {fmtDateTime, fmtDate, fmtAgo} from "../utils/formatters.js";

// Distance helper to determine nearest region from coordinates
function getNearestRegion(lat, lng, regions = []) {
  if (!regions.length || lat == null || lng == null) return null;
  let nearest = null;
  let minD = Infinity;
  for (const r of regions) {
    if (r.lat == null || r.lng == null) continue;
    const d = Math.hypot(r.lat - lat, r.lng - lng);
    if (d < minD) {
      minD = d;
      nearest = r.name;
    }
  }
  return nearest;
}

export default function ConsumerMap() {
  const {t} = useT();
  const {meta} = useMeta();
  const {user} = useAuth();

  // Filters state
  const [selectedCategory, setSelectedCategory] = useState(""); // "" means "All"
  const [days, setDays] = useState(90);
  const [filterCityOnly, setFilterCityOnly] = useState(false);
  const [filterMineOnly, setFilterMineOnly] = useState(false);
  useEffect(() => {
    if (user?.role !== "consumer") setFilterMineOnly(false);
  }, [user]);
  const [detectedCity, setDetectedCity] = useState("");
  const [cityInput, setCityInput] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState(Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [highlightedBatchId, setHighlightedBatchId] = useState(null);

  // Auto-detect consumer's city on mount
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const regions = [
            {name: "Pune", lat: 18.5204, lng: 73.8567},
            {name: "Mumbai Suburban", lat: 19.076, lng: 72.8777},
            {name: "Thane", lat: 19.2183, lng: 72.9781},
            {name: "Nashik", lat: 19.9975, lng: 73.7898},
            {name: "Nagpur", lat: 21.1458, lng: 79.0882},
            {name: "Navi Mumbai", lat: 19.033, lng: 73.0297},
            {name: "Solapur", lat: 17.6599, lng: 75.9064},
          ];
          const found = getNearestRegion(pos.coords.latitude, pos.coords.longitude, regions);
          if (found) {
            setDetectedCity(found);
            if (!cityInput) setCityInput(found);
          }
        },
        () => {
          if (!detectedCity) setDetectedCity("Pune");
        },
        {timeout: 6000}
      );
    } else {
      if (!detectedCity) setDetectedCity("Pune");
    }
  }, []);

  const activeCity = cityInput.trim() || detectedCity;

  // Active query parameters for correlations / enhanced complaint map
  const queryParams = useMemo(() => {
    const params = {days};
    if (selectedCategory) params.category = selectedCategory;
    if (filterCityOnly && activeCity) params.city = activeCity;
    if (filterMineOnly && user?.id) params.userId = user.id;
    if (user?.id) params.viewerUserId = user.id;
    return params;
  }, [days, selectedCategory, filterCityOnly, activeCity, filterMineOnly, user?.id]);

  // Main map query (only actual filter dimensions in deps to prevent clearing data on background sync)
  const mapQuery = useAsync(
    () => getPublicCorrelations(queryParams),
    [queryParams.category, queryParams.days, queryParams.city, queryParams.userId, queryParams.viewerUserId]
  );

  // Real-time synchronization (silent background reload keeps map state intact)
  const triggerReload = useCallback(() => {
    setIsRefreshing(true);
    mapQuery.reload();
    setTimeout(() => setIsRefreshing(false), 500);
  }, [mapQuery.reload]);

  // Poll every 5 seconds for live multi-user updates without unmounting map or resetting camera
  useEffect(() => {
    const timer = setInterval(() => {
      mapQuery.reload();
    }, 5000);
    return () => clearInterval(timer);
  }, [mapQuery.reload]);

  // Listen for local and cross-tab complaint submission events
  useEffect(() => {
    const handleComplaintSubmitted = () => {
      triggerReload();
    };
    const handleStorageChange = (e) => {
      if (e.key === "tracex_last_complaint") {
        triggerReload();
      }
    };
    window.addEventListener("tracex:complaint-submitted", handleComplaintSubmitted);
    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener("tracex:complaint-submitted", handleComplaintSubmitted);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [triggerReload]);

  const mapData = mapQuery.data || {nodes: [], connections: [], batches: [], summary: {totalComplaints: 0}};
  const mapPoints = mapData.nodes || [];
  const mapConnections = mapData.connections || [];

  const uniqueBatchIds = useMemo(() => {
    return [...new Set(mapPoints.map(p => p.batchId).filter(Boolean))];
  }, [mapPoints]);

  // Hierarchical Grouping: Product -> Batch -> Complaint Records
  const productHierarchy = useMemo(() => {
    const complaintsList = mapData.complaints || [];

    // Fallback if complaints array is not populated yet
    let records = [...complaintsList];
    if (!records.length && mapPoints.length) {
      records = mapPoints.map(p => ({
        id: p.id,
        trackingCode: p.id,
        batchId: p.batchId || null,
        lot: p.lot || null,
        productId: p.productId || "PRD-UNKNOWN",
        productName: p.productName || "Product",
        category: p.category || "other",
        region: p.region || "Reported Area",
        createdAt: p.createdAt,
        description: "Consumer reported issue recorded for this product.",
        severity: p.severity || "safe",
        isOwn: p.isOwn || false,
      }));
    }

    const prodMap = new Map();
    for (const c of records) {
      const prodName = c.productName || "Unspecified Product";
      const prodKey = c.productId || prodName;

      let pItem = prodMap.get(prodKey);
      if (!pItem) {
        pItem = {
          productId: c.productId,
          productName: prodName,
          category: c.category || "other",
          totalCount: 0,
          batchesMap: new Map(),
        };
        prodMap.set(prodKey, pItem);
      }
      pItem.totalCount++;

      const batchKey = c.batchId || "Direct / Unassigned Batch";
      let bItem = pItem.batchesMap.get(batchKey);
      if (!bItem) {
        bItem = {
          batchId: c.batchId || null,
          batchLabel: c.batchId ? `Batch: ${c.batchId}` : "Direct / Unassigned Batch",
          lot: c.lot || null,
          severity: c.severity || "safe",
          records: [],
        };
        pItem.batchesMap.set(batchKey, bItem);
      }
      bItem.records.push(c);
    }

    return [...prodMap.values()].map(p => ({
      ...p,
      batches: [...p.batchesMap.values()].map(b => ({
        ...b,
        count: b.records.length,
      })),
    }));
  }, [mapData.complaints, mapPoints]);

  return (
    <div className="space-y-6 font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1
            style={{color: THEME.deep}}
            className="text-3xl md:text-4xl font-semibold tracking-tight flex items-center gap-2.5"
          >
            <MapPinned style={{color: THEME.deep}} className="shrink-0" size={32} />
            {t("map.title") || "TraceX Live Complaint & Batch Correlation Map"}
          </h1>
          <p style={{color: THEME.muted}} className="mt-1 max-w-2xl text-sm">
            Real-time spatial visualization of consumer food complaints, suspect batch propagation networks, and localized contamination activity.
          </p>
        </div>

        {/* Live sync status & manual refresh button */}
        <div className="flex items-center gap-3 shrink-0">
          <div
            style={{
              background: THEME.paper,
              borderColor: THEME.line,
              color: THEME.deep,
            }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border shadow-sm"
          >
            <span
              style={{backgroundColor: THEME.safe}}
              className="w-2 h-2 rounded-full animate-pulse"
            />
            <span className="font-medium">Live Sync Active</span>
          </div>
          <button
            type="button"
            onClick={triggerReload}
            disabled={isRefreshing}
            style={{
              background: THEME.off,
              borderColor: THEME.line,
              color: THEME.deep,
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium shadow-sm hover:opacity-90 transition"
            title="Refresh Map Now"
          >
            <RefreshCw size={13} className={isRefreshing ? "animate-spin" : ""} style={{color: THEME.deep3}} />
            Refresh
          </button>
        </div>
      </div>

      {/* Multi-Level Controls & Filters Styled Strictly with Theme Tokens */}
      <div
        style={{
          background: THEME.paper,
          borderColor: THEME.line,
        }}
        className="border rounded-3xl p-5 shadow-sm space-y-4"
      >
        {/* Row 1: Category Filter & View Toggles */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Category Filter">
            <span
              style={{color: THEME.deep}}
              className="text-xs font-semibold uppercase tracking-wider mr-1 flex items-center gap-1"
            >
              <Layers size={14} /> Category:
            </span>

            {/* All Categories Button */}
            <button
              type="button"
              role="tab"
              aria-selected={selectedCategory === ""}
              onClick={() => setSelectedCategory("")}
              style={{
                background: selectedCategory === "" ? THEME.deep : `${THEME.sand}80`,
                color: selectedCategory === "" ? THEME.off : THEME.deep,
                borderColor: selectedCategory === "" ? THEME.deep : THEME.line,
              }}
              className="px-3.5 py-1.5 rounded-full text-xs font-medium border transition shadow-sm"
            >
              All Categories
            </button>

            {/* Dairy / Milk Button */}
            <button
              type="button"
              role="tab"
              aria-selected={selectedCategory === "dairy"}
              onClick={() => setSelectedCategory("dairy")}
              style={{
                background: selectedCategory === "dairy" ? THEME.deep3 : `${THEME.sand}80`,
                color: selectedCategory === "dairy" ? THEME.off : THEME.deep,
                borderColor: selectedCategory === "dairy" ? THEME.deep3 : THEME.line,
              }}
              className="px-3.5 py-1.5 rounded-full text-xs font-medium border transition shadow-sm"
            >
              Dairy / Milk
            </button>

            {/* Edible Oils Button */}
            <button
              type="button"
              role="tab"
              aria-selected={selectedCategory === "edible_oil"}
              onClick={() => setSelectedCategory("edible_oil")}
              style={{
                background: selectedCategory === "edible_oil" ? THEME.review : `${THEME.sand}80`,
                color: selectedCategory === "edible_oil" ? THEME.off : THEME.deep,
                borderColor: selectedCategory === "edible_oil" ? THEME.review : THEME.line,
              }}
              className="px-3.5 py-1.5 rounded-full text-xs font-medium border transition shadow-sm"
            >
              Edible Oils
            </button>

            {/* Beverages Button */}
            <button
              type="button"
              role="tab"
              aria-selected={selectedCategory === "beverage"}
              onClick={() => setSelectedCategory("beverage")}
              style={{
                background: selectedCategory === "beverage" ? THEME.sage : `${THEME.sand}80`,
                color: selectedCategory === "beverage" ? THEME.off : THEME.deep,
                borderColor: selectedCategory === "beverage" ? THEME.sage : THEME.line,
              }}
              className="px-3.5 py-1.5 rounded-full text-xs font-medium border transition shadow-sm"
            >
              Beverages
            </button>

            {/* Snacks Button */}
            <button
              type="button"
              role="tab"
              aria-selected={selectedCategory === "snack"}
              onClick={() => setSelectedCategory("snack")}
              style={{
                background: selectedCategory === "snack" ? THEME.susp : `${THEME.sand}80`,
                color: selectedCategory === "snack" ? THEME.off : THEME.deep,
                borderColor: selectedCategory === "snack" ? THEME.susp : THEME.line,
              }}
              className="px-3.5 py-1.5 rounded-full text-xs font-medium border transition shadow-sm"
            >
              Snacks
            </button>

            {/* Grains Button */}
            <button
              type="button"
              role="tab"
              aria-selected={selectedCategory === "grain"}
              onClick={() => setSelectedCategory("grain")}
              style={{
                background: selectedCategory === "grain" ? THEME.deep : `${THEME.sand}80`,
                color: selectedCategory === "grain" ? THEME.off : THEME.deep,
                borderColor: selectedCategory === "grain" ? THEME.deep : THEME.line,
              }}
              className="px-3.5 py-1.5 rounded-full text-xs font-medium border transition shadow-sm"
            >
              Grains
            </button>
          </div>

          {/* Time window selector */}
          <div className="flex items-center gap-2">
            <span style={{color: THEME.muted}} className="text-xs">Window:</span>
            <Select id="time-window" value={days} onChange={e => setDays(+e.target.value)}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last 1 year</option>
            </Select>
          </div>
        </div>

        {/* Row 2: Multi-Level Filters ("All Complaints in Your City" & "My Complaints") */}
        <div
          style={{borderColor: `${THEME.line}99`}}
          className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t"
        >
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Quick Filter: All Complaints in Your City */}
            <button
              type="button"
              aria-pressed={filterCityOnly}
              onClick={() => setFilterCityOnly(!filterCityOnly)}
              style={{
                background: filterCityOnly ? THEME.deep : THEME.off,
                color: filterCityOnly ? THEME.off : THEME.deep,
                borderColor: filterCityOnly ? THEME.deep : THEME.line,
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition shadow-sm"
            >
              <Building2 size={14} style={{color: filterCityOnly ? THEME.cream : THEME.muted}} />
              All Complaints in Your City {activeCity ? `(${activeCity})` : ""}
            </button>

            {/* Quick Filter: My Complaints */}
            {user?.role === "consumer" ? (
              <button
                type="button"
                aria-pressed={filterMineOnly}
                onClick={() => setFilterMineOnly(!filterMineOnly)}
                style={{
                  background: filterMineOnly ? THEME.deep : THEME.off,
                  color: filterMineOnly ? THEME.off : THEME.deep,
                  borderColor: filterMineOnly ? THEME.deep : THEME.line,
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition shadow-sm"
              >
                <UserCheck size={14} style={{color: filterMineOnly ? THEME.cream : THEME.muted}} />
                View your complaints
              </button>
            ) : (
              <Link
                to="/login"
                style={{
                  background: THEME.off,
                  color: THEME.muted,
                  borderColor: THEME.line,
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition hover:opacity-80 shadow-sm"
                title="Sign in to view your complaints"
              >
                <Lock size={13} style={{color: THEME.muted}} />
                Sign in to view your complaints
              </Link>
            )}
          </div>

          {/* City search / filter input */}
          <div className="flex items-center gap-1.5">
            <span style={{color: THEME.muted}} className="text-xs flex items-center gap-1">
              <Navigation size={12} /> City:
            </span>
            <input
              type="text"
              value={cityInput}
              onChange={e => setCityInput(e.target.value)}
              placeholder="e.g. Pune, Thane, Mumbai"
              style={{
                background: THEME.off,
                borderColor: THEME.line,
                color: THEME.ink,
              }}
              className="border rounded-full px-3 py-1 text-xs outline-none focus:border-[#274245] w-36 shadow-sm"
            />
            {cityInput && (
              <button
                type="button"
                onClick={() => setCityInput("")}
                style={{color: THEME.muted}}
                className="text-[11px] hover:underline"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Map + Sidebar */}
      {mapQuery.error ? (
        <ErrorState error={mapQuery.error} onRetry={triggerReload} />
      ) : mapQuery.loading && !mapData.nodes.length ? (
        <LoadingState />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,1fr)] gap-5 items-start">
          {/* Spatial Visualization Container */}
          <div className="space-y-4">
            <div
              style={{borderColor: `${THEME.deep}33`}}
              className="h-[520px] rounded-3xl overflow-hidden ring-1 shadow-sm relative"
            >
              <HeatMap
                mode="enhanced"
                points={mapPoints}
                connections={mapConnections}
                colorMode={selectedCategory ? "batch" : "category"}
                showConnections={true}
                highlightedBatchId={highlightedBatchId}
              />
            </div>

            {/* Dynamic Legend and Strict Theme Visualizer */}
            <div
              style={{
                background: THEME.paper,
                borderColor: THEME.line,
              }}
              className="border rounded-3xl p-4 shadow-sm space-y-3 text-xs"
            >
              <div
                style={{borderColor: THEME.line}}
                className="flex items-center justify-between border-b pb-2"
              >
                <span style={{color: THEME.deep}} className="font-semibold">
                  {selectedCategory
                    ? `Batch Propagation Network (${CATEGORY_LABELS[selectedCategory] || selectedCategory})`
                    : "TraceX Category Color Palette (All Categories View)"}
                </span>
                <span style={{color: THEME.muted}}>
                  {mapPoints.length} hotspot {mapPoints.length === 1 ? "node" : "nodes"} · {mapConnections.length} network {mapConnections.length === 1 ? "edge" : "edges"}
                </span>
              </div>

              {/* Requirement 1: Category Theme Tokens */}
              {!selectedCategory ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {Object.entries(CATEGORY_COLORS).map(([catKey, hex]) => (
                    <span key={catKey} className="inline-flex items-center gap-1.5">
                      <span
                        className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                        style={{backgroundColor: hex}}
                      />
                      <span style={{color: THEME.ink}} className="font-medium">
                        {CATEGORY_LABELS[catKey] || catKey}
                      </span>
                    </span>
                  ))}
                </div>
              ) : (
                /* Requirement 1 & 2: Batch theme breakdown in category view */
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {uniqueBatchIds.length ? (
                    uniqueBatchIds.map((bid) => {
                      const c = batchColor(bid, uniqueBatchIds);
                      return (
                        <span
                          key={bid}
                          style={{
                            background: THEME.off,
                            borderColor: THEME.line,
                          }}
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border"
                        >
                          <span className="w-3 h-3 rounded-full shrink-0" style={{backgroundColor: c}} />
                          <span style={{color: THEME.ink}} className="font-mono font-semibold">{bid}</span>
                        </span>
                      );
                    })
                  ) : (
                    <span style={{color: THEME.muted}}>No specific batches recorded for this category view.</span>
                  )}
                </div>
              )}

              {/* Requirement 3: Severity Alert Tokens */}
              <div
                style={{borderColor: `${THEME.line}99`}}
                className="pt-2 border-t flex flex-wrap items-center justify-between gap-y-2"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span style={{color: THEME.deep}} className="font-medium">Alert Intensity:</span>
                  {[
                    {label: "Low (1–2)", col: THEME.safe},
                    {label: "Moderate (3–4)", col: THEME.review},
                    {label: "High (5–9)", col: THEME.susp},
                    {label: "Critical (10+)", col: THEME.crit},
                  ].map(({label, col}) => (
                    <span key={label} className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: col}} />
                      <span style={{color: THEME.ink}}>{label}</span>
                    </span>
                  ))}
                </div>
                <div style={{color: THEME.muted}} className="text-[11px]">
                  <span>Radial Bloom Spots: Outermost halo (0.12) · Middle bloom (0.28) · Core dot (0.9)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Sidebar: Active Node Details & Live Reports Feed */}
          <aside
            aria-label="Complaints and batches"
            style={{
              background: THEME.paper,
              borderColor: THEME.line,
            }}
            className="border rounded-2xl p-5 max-h-[600px] overflow-y-auto space-y-4 shadow-sm"
          >
            <div>
              <div className="flex items-center justify-between">
                <h2
                  style={{color: THEME.deep}}
                  className="inline-flex items-center gap-2 text-base font-semibold"
                >
                  <MessageSquareWarning size={18} style={{color: THEME.review}} />
                  {filterMineOnly
                    ? "My Complaints"
                    : filterCityOnly
                    ? `Complaints in ${activeCity}`
                    : "Active Regional Complaints"}
                </h2>
                <span
                  style={{
                    background: `${THEME.sand}80`,
                    color: THEME.deep,
                    borderColor: THEME.line,
                  }}
                  className="text-xs font-semibold px-2 py-0.5 rounded-full border"
                >
                  {mapPoints.reduce((acc, p) => acc + (p.count || 1), 0)} total reports
                </span>
              </div>
              <p style={{color: THEME.muted}} className="text-xs mt-0.5">
                {filterMineOnly
                  ? "Displaying complaints filed from your authenticated consumer account."
                  : "All live user reports and pre-seeded incident records synchronized in real time."}
              </p>
            </div>

            {/* Hierarchical Grouping: Product -> Batch -> Complaint Records */}
            {productHierarchy.length ? (
              <div className="space-y-4 max-h-[560px] overflow-y-auto pr-1">
                {productHierarchy.map((prod) => {
                  const catKey = prod.category || "other";
                  const catColor = CATEGORY_COLORS[catKey] || THEME.muted;
                  const catLabel = CATEGORY_LABELS[catKey] || catKey.replace("_", " ");

                  return (
                    <section
                      key={prod.productId || prod.productName}
                      className="p-4 space-y-3"
                      style={{
                        background: THEME.paper,
                        border: `1px solid ${THEME.line}`,
                        borderRadius: "16px",
                        boxShadow: "var(--shadow-soft)",
                      }}
                    >
                      {/* Top Level: Product Heading */}
                      <div className="flex items-start justify-between gap-3 border-b pb-2.5" style={{borderColor: THEME.line}}>
                        <div>
                          <h3 style={{color: THEME.deep}} className="text-lg font-semibold tracking-tight leading-snug">
                            {prod.productName}
                          </h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span
                              style={{background: catColor, color: THEME.off}}
                              className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0"
                            >
                              {catLabel}
                            </span>
                            <span style={{color: THEME.muted}} className="text-xs">
                              {prod.batches.length} {prod.batches.length === 1 ? "batch affected" : "batches affected"}
                            </span>
                          </div>
                        </div>
                        <span
                          style={{
                            background: `${THEME.sand}80`,
                            color: THEME.deep,
                            borderColor: THEME.line,
                          }}
                          className="text-xs font-semibold px-2.5 py-1 rounded-full border shrink-0"
                        >
                          {prod.totalCount} {prod.totalCount === 1 ? "complaint" : "complaints"}
                        </span>
                      </div>

                      {/* Mid Level: Batch Sub-Boxes */}
                      <div className="space-y-3 pt-1">
                        {prod.batches.map((batch) => {
                          const isHighlighted = highlightedBatchId && batch.batchId === highlightedBatchId;
                          const sevColor = getSeverityAlertColor(batch.severity || batch.count);
                          const sevLabel = getSeverityLabel(batch.severity || batch.count);

                          return (
                            <div
                              key={batch.batchId || batch.batchLabel}
                              className="border rounded-xl overflow-hidden mb-3 last:mb-0 transition-all"
                              style={{
                                background: "rgba(255, 255, 255, 0.7)",
                                borderColor: isHighlighted ? THEME.deep : THEME.line,
                                boxShadow: isHighlighted ? "0 0 0 1.5px #274245" : "none",
                              }}
                            >
                              {/* Batch Header */}
                              <div
                                className="px-3.5 py-2 border-b flex justify-between items-center gap-2"
                                style={{
                                  background: isHighlighted ? `${THEME.sand}99` : `${THEME.sand}4D`,
                                  borderColor: THEME.line,
                                }}
                              >
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span
                                    style={{color: THEME.deep}}
                                    className="font-mono font-medium text-sm"
                                  >
                                    {batch.batchId ? `Batch: ${batch.batchId}` : batch.batchLabel}
                                  </span>
                                  {batch.lot && (
                                    <span style={{color: THEME.muted}} className="text-xs font-mono">
                                      (LOT: {batch.lot})
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  <span
                                    style={{
                                      background: THEME.off,
                                      borderColor: `${THEME.line}CC`,
                                      color: THEME.deep,
                                    }}
                                    className="text-xs font-medium border px-2 py-0.5 rounded-full"
                                  >
                                    {batch.count} {batch.count === 1 ? "complaint filed" : "complaints filed"}
                                  </span>

                                  {batch.batchId && (
                                    <button
                                      type="button"
                                      onClick={() => setHighlightedBatchId(isHighlighted ? null : batch.batchId)}
                                      style={{
                                        background: isHighlighted ? THEME.deep : THEME.off,
                                        color: isHighlighted ? THEME.off : THEME.deep,
                                        borderColor: isHighlighted ? THEME.deep : THEME.line,
                                      }}
                                      className="text-[11px] font-medium border px-2 py-0.5 rounded-full transition hover:opacity-90 shadow-2xs"
                                      title="Isolate and highlight this batch on the map"
                                    >
                                      {isHighlighted ? "Highlighted" : "Highlight"}
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Inner Level: Complaint Records */}
                              <div
                                className="divide-y"
                                style={{borderColor: `${THEME.line}99`}}
                              >
                                {batch.records.map((c, rIdx) => {
                                  const recSevColor = getSeverityAlertColor(c.severity || batch.severity);
                                  const recSevLabel = getSeverityLabel(c.severity || batch.severity);
                                  const timeStr = fmtAgo(c.createdAt) || fmtDate(c.createdAt);

                                  return (
                                    <div
                                      key={c.id || c.trackingCode || rIdx}
                                      className="p-3 space-y-1.5 transition-colors"
                                    >
                                      {/* Date, Region, and Severity Badge */}
                                      <div className="flex items-center justify-between gap-2 text-xs">
                                        <span style={{color: THEME.muted}} className="font-medium">
                                          -record {rIdx + 1}: {timeStr ? `${timeStr} · ` : ""}{c.region || "Reported Area"}
                                        </span>
                                        <span
                                          style={{
                                            backgroundColor: `${recSevColor}1a`,
                                            color: recSevColor,
                                            borderColor: `${recSevColor}44`,
                                          }}
                                          className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border shrink-0"
                                        >
                                          {recSevLabel}
                                        </span>
                                      </div>

                                      {/* Truncated problem description snippet */}
                                      <p
                                        className="text-xs leading-relaxed line-clamp-2 pl-2.5 border-l-2"
                                        style={{
                                          borderColor: THEME.line,
                                          color: "rgba(32, 52, 55, 0.85)",
                                        }}
                                      >
                                        {c.description || "Consumer issue recorded."}
                                      </p>

                                      {/* Tracking code / status snippet */}
                                      <div className="flex items-center justify-between text-[11px] pt-0.5">
                                        <span style={{color: THEME.muted}}>
                                          Ref: <span className="font-mono font-medium" style={{color: THEME.deep}}>{c.trackingCode || c.id}</span>
                                        </span>
                                        <div className="flex items-center gap-2">
                                          {user && c.isOwn ? (
                                            <>
                                              <span
                                                style={{
                                                  background: `${THEME.cream}66`,
                                                  color: THEME.deep,
                                                  borderColor: THEME.line,
                                                }}
                                                className="text-[10px] font-medium border px-1.5 py-0.5 rounded"
                                              >
                                                Your filing
                                              </span>
                                              <Link
                                                to={`/consumer/status/${encodeURIComponent(c.trackingCode || c.id)}`}
                                                className="navlink text-xs font-medium"
                                                style={{color: THEME.deep}}
                                              >
                                                View report
                                              </Link>
                                            </>
                                          ) : null}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : (
              <Empty icon={MessageSquareWarning}>
                No complaints found for the selected category or filters.
              </Empty>
            )}

            {/* Quick action to report a problem */}
            <div style={{borderColor: THEME.line}} className="pt-3 border-t text-center">
              <Link
                to="/consumer/report"
                style={{
                  background: THEME.deep,
                  color: THEME.off,
                }}
                className="inline-flex items-center justify-center w-full px-4 py-2 rounded-xl text-xs font-semibold hover:opacity-90 transition shadow-sm"
              >
                File a Product Complaint
              </Link>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
