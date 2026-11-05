import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { 
  Package, 
  Truck, 
  Building2, 
  FlaskConical, 
  CheckCircle2, 
  Clock, 
  ArrowLeft, 
  MapPin, 
  Calendar,
  AlertCircle
} from "lucide-react";
import { getSampleCollection } from "../services/api.js";
import { fmtDate } from "../utils/formatters.js";
import Page from "../components/ui/Page.jsx";
import PageHeader from "../components/common/PageHeader.jsx";
import Panel from "../components/ui/Panel.jsx";
import LoadingState from "../components/common/LoadingState.jsx";
import { ErrorState } from "../components/common/Form.jsx";

const STAGES = [
  {
    key: "collection_scheduled",
    label: "Collection Scheduled",
    desc: "Your sample collection has been scheduled. An agent will contact you for pickup.",
    icon: Calendar,
  },
  {
    key: "collected",
    label: "Sample Collected",
    desc: "The field agent picked up the sample from your address.",
    icon: Package,
  },
  {
    key: "in_transit",
    label: "In Transit to Lab",
    desc: "Sample is securely on its way to the accredited testing laboratory.",
    icon: Truck,
  },
  {
    key: "at_lab",
    label: "Arrived at Laboratory",
    desc: "Sample has reached the testing facility and passed accessioning.",
    icon: Building2,
  },
  {
    key: "testing",
    label: "Laboratory Testing",
    desc: "Chemical and microbiological assays are currently in progress.",
    icon: FlaskConical,
  },
  {
    key: "completed",
    label: "Testing Complete",
    desc: "Laboratory analysis concluded and official report logged.",
    icon: CheckCircle2,
  },
];

export default function SampleJourney() {
  const { collectionId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getSampleCollection(collectionId);
      setData(res);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (collectionId) loadData();
  }, [collectionId]);

  if (loading) return <LoadingState variant="cards" />;
  if (error || !data) {
    return (
      <Page className="space-y-6">
        <Link to="/consumer" className="inline-flex items-center gap-1.5 text-sm font-medium text-deep hover:underline">
          <ArrowLeft size={16} /> Back
        </Link>
        <ErrorState error={error || new Error("Sample journey not found")} onRetry={loadData} />
      </Page>
    );
  }

  const currentIdx = STAGES.findIndex((s) => s.key === data.stage);
  const historyMap = new Map((data.stageHistory || []).map((h) => [h.stage, h]));

  return (
    <Page className="space-y-8 max-w-4xl mx-auto">
      <div>
        <Link
          to="/consumer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-deep hover:underline mb-4"
        >
          <ArrowLeft size={16} /> Back to Consumer Portal
        </Link>
        <PageHeader
          eyebrow="Verification & Testing"
          title={`Sample Journey · ${data.id}`}
          sub={`Live end-to-end custody tracking for ${data.productName}${
            data.batchId ? ` (Batch ${data.batchId})` : ""
          }`}
        />
      </div>

      {/* Summary card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-white border border-line shadow-xs">
          <span className="text-xs text-muted block mb-1">Current Status</span>
          <span className="font-semibold text-deep text-base inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-deep animate-ping" />
            {STAGES[currentIdx]?.label || data.stage}
          </span>
        </div>
        <div className="p-4 rounded-2xl bg-white border border-line shadow-xs">
          <span className="text-xs text-muted block mb-1">Product</span>
          <span className="font-semibold text-deep text-sm block truncate">
            {data.productName}
          </span>
          {data.batchId && (
            <span className="text-xs text-muted font-mono">{data.batchId}</span>
          )}
        </div>
        <div className="p-4 rounded-2xl bg-white border border-line shadow-xs">
          <span className="text-xs text-muted block mb-1">Scheduled On</span>
          <span className="font-medium text-ink text-sm">
            {fmtDate(data.scheduledAt || data.createdAt)}
          </span>
          {data.region && (
            <span className="text-xs text-muted block mt-0.5">Region: {data.region}</span>
          )}
        </div>
      </div>

      {/* Vertical Stepper Journey */}
      <Panel
        icon={Truck}
        title="Sample Tracking Timeline"
        desc="Real-time custody milestones from pickup at your address to laboratory verification."
      >
        <div className="py-4 px-2 sm:px-6">
          <ol className="relative border-l-2 border-line/80 ml-5 sm:ml-7 space-y-9">
            {STAGES.map((st, i) => {
              const hist = historyMap.get(st.key);
              const isPast = i < currentIdx;
              const isCurrent = i === currentIdx;
              const isFuture = i > currentIdx;
              const IconComponent = st.icon;

              let circleClasses = "bg-white border-2 border-line text-muted";
              if (isPast) circleClasses = "bg-deep text-cream border-deep";
              if (isCurrent) circleClasses = "bg-amber-500 text-white border-amber-500 ring-4 ring-amber-100 animate-pulse";

              return (
                <motion.li
                  key={st.key}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1, duration: 0.3 }}
                  className="relative pl-8 sm:pl-10"
                >
                  <span
                    className={`absolute -left-[1.3rem] sm:-left-[1.55rem] top-0 flex items-center justify-center w-10 h-10 rounded-full transition-all ${circleClasses}`}
                  >
                    <IconComponent size={18} />
                  </span>

                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4
                        className={`text-base font-semibold ${
                          isCurrent
                            ? "text-deep font-bold"
                            : isPast
                            ? "text-deep"
                            : "text-muted"
                        }`}
                      >
                        {st.label}
                      </h4>
                      {isCurrent && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900">
                          Active Stage
                        </span>
                      )}
                      {hist?.at && (
                        <span className="text-xs text-muted">
                          · {fmtDate(hist.at)}
                        </span>
                      )}
                    </div>

                    <p
                      className={`text-sm leading-relaxed ${
                        isFuture ? "text-muted/70" : "text-ink/80"
                      }`}
                    >
                      {hist?.note || st.desc}
                    </p>
                  </div>
                </motion.li>
              );
            })}
          </ol>
        </div>
      </Panel>
    </Page>
  );
}
