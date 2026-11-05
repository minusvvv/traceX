import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Bell, Check, X, MapPin, ArrowRight, AlertTriangle, Package } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getNotifications, markNotificationRead, respondNotification } from "../services/api.js";
import { fmtDate } from "../utils/formatters.js";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ notifications: [], unreadCount: 0 });
  const [loading, setLoading] = useState(false);
  const [addressInput, setAddressInput] = useState({});
  const [submittingId, setSubmittingId] = useState(null);
  const [showAddressFormFor, setShowAddressFormFor] = useState(null);
  const bellRef = useRef(null);

  const fetchNotifs = async () => {
    try {
      const res = await getNotifications();
      setData(res || { notifications: [], unreadCount: 0 });
    } catch {
      // ignore background poll errors
    }
  };

  useEffect(() => {
    fetchNotifs();
    const timer = setInterval(fetchNotifs, 30000);
    return () => clearInterval(timer);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (bellRef.current && !bellRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleToggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      fetchNotifs();
    }
  };

  const handleRespond = async (id, decision) => {
    if (decision === "accepted" && !showAddressFormFor) {
      setShowAddressFormFor(id);
      return;
    }

    const address = addressInput[id] || "";
    if (decision === "accepted" && address.trim().length < 5) {
      alert("Please enter a valid pickup address (at least 5 characters).");
      return;
    }

    try {
      setSubmittingId(id);
      await respondNotification(id, decision, address);
      setShowAddressFormFor(null);
      await fetchNotifs();
    } catch (err) {
      alert(err.message || "Failed to submit response.");
    } finally {
      setSubmittingId(null);
    }
  };

  const handleMarkRead = async (id) => {
    try {
      await markNotificationRead(id);
      setData((prev) => ({
        ...prev,
        unreadCount: Math.max(0, prev.unreadCount - 1),
        notifications: prev.notifications.map((n) =>
          n.id === id ? { ...n, readAt: new Date().toISOString() } : n
        ),
      }));
    } catch {
      // ignore
    }
  };

  const pendingCount = data.unreadCount;

  return (
    <div className="relative inline-block" ref={bellRef}>
      <button
        onClick={handleToggle}
        className="relative p-2 rounded-full text-off/75 hover:text-cream hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-cream/40"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell size={18} />
        {pendingCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-susp text-[10px] font-bold text-white shadow-sm animate-pulse">
            {pendingCount > 9 ? "9+" : pendingCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl bg-white text-ink shadow-2xl ring-1 ring-black/10 z-[2000] overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 bg-sand/60 border-b border-line">
              <div className="flex items-center gap-2">
                <Bell size={16} className="text-deep" />
                <span className="font-semibold text-deep text-sm">Notifications & Alerts</span>
              </div>
              <span className="text-xs text-muted">
                {data.notifications.length} total
              </span>
            </div>

            <div className="max-h-[26rem] overflow-y-auto divide-y divide-line/60">
              {data.notifications.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted">
                  No notifications yet.
                </div>
              ) : (
                data.notifications.map((n) => {
                  const isPending = n.status === "pending";
                  const isAccepted = n.status === "accepted";
                  const isDeclined = n.status === "declined";

                  return (
                    <div
                      key={n.id}
                      onClick={() => !n.readAt && handleMarkRead(n.id)}
                      className={`p-4 transition-colors ${
                        !n.readAt ? "bg-amber-50/50" : "bg-white"
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5 rounded-full p-1.5 bg-susp/15 text-susp flex-shrink-0">
                          <AlertTriangle size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-xs text-deep truncate">
                              {n.productName}
                            </span>
                            <span className="text-[10px] text-muted whitespace-nowrap">
                              {fmtDate(n.createdAt)}
                            </span>
                          </div>
                          {n.batchId && (
                            <p className="text-[11px] text-muted font-mono mt-0.5">
                              Batch: {n.batchId}
                            </p>
                          )}
                          <p className="text-xs text-ink/80 mt-1.5 leading-relaxed">
                            Authorities have flagged this product based on consumer complaints.
                            Would you like to send a sample for official laboratory testing?
                          </p>

                          {/* Action area */}
                          {isPending && (
                            <div className="mt-3 space-y-2.5">
                              {showAddressFormFor === n.id ? (
                                <div className="space-y-2 bg-sand/40 p-2.5 rounded-xl border border-line">
                                  <label className="block text-[11px] font-medium text-deep">
                                    Pickup Address for Collection Agent:
                                  </label>
                                  <input
                                    type="text"
                                    placeholder="Enter your street address, area & city"
                                    value={addressInput[n.id] || ""}
                                    onChange={(e) =>
                                      setAddressInput({ ...addressInput, [n.id]: e.target.value })
                                    }
                                    className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-line bg-white focus:outline-none focus:ring-1 focus:ring-deep"
                                  />
                                  <div className="flex items-center gap-2 pt-1">
                                    <button
                                      disabled={submittingId === n.id}
                                      onClick={() => handleRespond(n.id, "accepted")}
                                      className="flex-1 inline-flex items-center justify-center gap-1 text-xs py-1.5 px-3 rounded-lg bg-deep text-cream font-medium hover:bg-deep/90 transition-colors disabled:opacity-50"
                                    >
                                      <Check size={12} /> Confirm Pickup
                                    </button>
                                    <button
                                      onClick={() => setShowAddressFormFor(null)}
                                      className="text-xs py-1.5 px-2.5 rounded-lg border border-line text-muted hover:text-ink transition-colors"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleRespond(n.id, "accepted")}
                                    className="inline-flex items-center gap-1 text-xs py-1 px-3 rounded-lg bg-deep text-cream font-medium hover:bg-deep/90 transition-colors shadow-sm"
                                  >
                                    <Check size={12} /> Yes, Send Sample
                                  </button>
                                  <button
                                    disabled={submittingId === n.id}
                                    onClick={() => handleRespond(n.id, "declined")}
                                    className="inline-flex items-center gap-1 text-xs py-1 px-2.5 rounded-lg border border-line text-muted hover:text-susp transition-colors"
                                  >
                                    <X size={12} /> No Thanks
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                          {isAccepted && (
                            <div className="mt-2.5 flex items-center justify-between text-xs pt-1.5 border-t border-line/60">
                              <span className="inline-flex items-center gap-1 text-[#3F6130] font-medium">
                                <Check size={12} /> Sample requested
                              </span>
                              {n.collectionId && (
                                <Link
                                  to={`/sample-journey/${n.collectionId}`}
                                  onClick={() => setOpen(false)}
                                  className="inline-flex items-center gap-1 font-semibold text-deep hover:underline"
                                >
                                  Track Journey <ArrowRight size={12} />
                                </Link>
                              )}
                            </div>
                          )}

                          {isDeclined && (
                            <div className="mt-2 text-[11px] text-muted italic">
                              You declined to submit a sample.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {data.notifications.length > 0 && (
              <div className="px-4 py-2 bg-sand/30 border-t border-line text-center">
                <span className="text-[11px] text-muted">
                  Official traceX Food Safety Quality Alerts
                </span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
