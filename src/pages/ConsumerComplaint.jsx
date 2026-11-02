import {useEffect, useRef, useState} from "react";
import {Link, useSearchParams} from "react-router-dom";
import {MapPin, Sparkles, Scan, CheckCircle, Search, ExternalLink} from "lucide-react";
import {submitComplaint, getMeta, reverseGeocode, lookupBarcode} from "../services/api.js";
import useAsync from "../hooks/useAsync.js";
import {Btn, Field, Notice, inputCls, describe} from "../components/common/Form.jsx";
import {useT} from "../i18n/index.jsx";
import {fmtDateTime} from "../utils/formatters.js";
import {useAuth} from "../auth/AuthContext.jsx";
import {scanLabelPhoto} from "../utils/ocr.js";

const TYPES = ["image/jpeg", "image/png", "image/webp"], MAX = 5 * 1024 * 1024, newKey = () => crypto.randomUUID();
const bad = (list, t) => {
  for (const f of list) {
    if (!TYPES.includes(f.type)) return t("report.err.type", {name: f.name});
    if (f.size > MAX) return t("report.err.size", {name: f.name});
  }
  return null;
};

export default function ConsumerComplaint() {
  const {t} = useT(), [sp] = useSearchParams(), {data: meta} = useAsync(getMeta), {user, ready, consumerLogin, registerConsumer} = useAuth(), key = useRef(newKey());
  const [f, setF] = useState({identifier: sp.get("batch") || "", productText: "", description: "", regionKey: "", contact: ""});
  const [img, setImg] = useState(null), [photos, setPhotos] = useState([]), [loc, setLoc] = useState(null), [locMsg, setLocMsg] = useState(null), [det, setDet] = useState(null);
  const [step, setStep] = useState("edit"), [err, setErr] = useState({}), [top, setTop] = useState(null), [busy, setBusy] = useState(false), [done, setDone] = useState(null), [src, setSrc] = useState("manual");
  const [authMode, setAuthMode] = useState(null), [account, setAccount] = useState({name: "", email: "", password: ""}), [authErr, setAuthErr] = useState(null), [authBusy, setAuthBusy] = useState(false);

  // Enhancements: OCR, Open Food Facts & Geocoding state
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrStatus, setOcrStatus] = useState(null);
  const [ocrResult, setOcrResult] = useState(null);
  const [offProduct, setOffProduct] = useState(null);
  const [offSearching, setOffSearching] = useState(false);

  useEffect(() => { if (ready && user?.role !== "consumer") setAuthMode("signup"); }, [ready, user]);
  const set = k => e => setF({...f, [k]: e.target.value});

  const detect = async file => {
    setDet(null);
    if (!file) return;
    if (!("BarcodeDetector" in window)) {
      setDet({m: t("detect.unsupported")});
      return;
    }
    setDet({m: t("detect.checking")});
    try {
      const codes = await new window.BarcodeDetector().detect(await createImageBitmap(file));
      if (codes.length) {
        setDet({m: t("detect.found", {code: codes[0].rawValue}), code: codes[0].rawValue});
      } else {
        setDet({m: t("detect.none")});
      }
    } catch {
      setDet({m: t("detect.none")});
    }
  };

  const runOcr = async file => {
    if (!file) return;
    setOcrRunning(true);
    setOcrStatus("Analyzing packaging image with Tesseract OCR…");
    const res = await scanLabelPhoto(file, s => setOcrStatus(s));
    setOcrRunning(false);
    if (res.success && (res.batch || res.fssai || res.mfd)) {
      setOcrResult(res);
      setOcrStatus(null);
      if (res.batch && !f.identifier) {
        setF(prev => ({...prev, identifier: res.batch}));
        setSrc("image");
      }
    } else {
      setOcrStatus("No batch text detected in this photo. You can type it below.");
    }
  };

  const onImg = e => {
    const file = e.target.files[0] || null;
    setImg(file);
    const b = file && bad([file], t);
    setErr(x => ({...x, img: b}));
    setOcrResult(null);
    setOcrStatus(null);
    if (file && !b) {
      detect(file);
      runOcr(file);
    }
  };

  const checkOpenFoodFacts = async code => {
    const q = code || f.identifier;
    if (!q || !/^\d{8,14}$/.test(q.trim())) return;
    setOffSearching(true);
    try {
      const data = await lookupBarcode(q.trim());
      if (data && data.found) {
        setOffProduct(data);
        if (data.name && !f.productText) {
          setF(prev => ({...prev, productText: `${data.name} (${data.brand || "Verified Brand"})`}));
        }
      } else {
        setOffProduct(null);
      }
    } catch {
      setOffProduct(null);
    } finally {
      setOffSearching(false);
    }
  };

  const onPhotos = e => {
    const l = [...e.target.files];
    setPhotos(l.slice(0, 4));
    setErr(x => ({...x, photos: l.length > 4 ? t("report.err.count") : bad(l, t)}));
  };

  // OpenStreetMap Nominatim Geolocation
  const geo = () => {
    setLocMsg(t("report.locating"));
    if (!navigator.geolocation) {
      setLocMsg(t("report.locationDenied"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async p => {
        const lat = p.coords.latitude, lng = p.coords.longitude;
        setLoc({lat, lng});
        setLocMsg("Resolving district with OpenStreetMap…");
        try {
          const rev = await reverseGeocode(lat, lng);
          if (rev?.ok && rev.location) {
            const locInfo = rev.location;
            if (locInfo.matchedRegionKey) {
              setF(prev => ({...prev, regionKey: locInfo.matchedRegionKey}));
            }
            const placeDesc = [locInfo.district, locInfo.state, locInfo.postcode].filter(Boolean).join(", ");
            setLocMsg(`📍 Located via OpenStreetMap: ${placeDesc || t("report.locationOk")}`);
          } else {
            setLocMsg(t("report.locationOk"));
          }
        } catch {
          setLocMsg(t("report.locationOk"));
        }
      },
      () => setLocMsg(t("report.locationDenied")),
      {timeout: 10000}
    );
  };

  const validate = () => {
    const e = {};
    if (f.description.trim().length < 10) e.description = t("report.err.description");
    if (!f.identifier.trim() && !f.productText.trim() && !img) e.identifier = t("report.err.identify");
    if (img && bad([img], t)) e.img = bad([img], t);
    if (photos.length && bad(photos, t)) e.photos = bad(photos, t);
    return e;
  };

  const review = e => {
    e.preventDefault();
    const v = validate();
    setErr(v);
    if (!Object.keys(v).length) setStep("review");
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setTop(null);
    const fd = new FormData();
    fd.append("description", f.description.trim());
    ["identifier", "productText", "regionKey", "contact"].forEach(k => f[k].trim() && fd.append(k, f[k].trim()));
    fd.append("identifierSource", src);
    fd.append("lang", document.documentElement.lang === "hi" ? "hi" : "en");
    if (loc) {
      fd.append("lat", loc.lat);
      fd.append("lng", loc.lng);
    }
    if (img) fd.append("productImage", img);
    photos.forEach(p => fd.append("photos", p));
    try {
      setDone(await submitComplaint(fd, key.current));
    } catch (x) {
      setErr(x.fields || {});
      setTop(x.message || t("report.err.server"));
      setStep("edit");
    } finally {
      setBusy(false);
    }
  };

  const startSubmit = () => {
    if (user?.role === "consumer") submit();
    else {
      setAuthMode("signup");
      setAuthErr(null);
    }
  };

  const authenticateAndSubmit = async e => {
    e.preventDefault();
    setAuthErr(null);
    setAuthBusy(true);
    try {
      if (authMode === "signup") await registerConsumer({name: account.name.trim(), email: account.email.trim(), password: account.password});
      else await consumerLogin(account.email.trim(), account.password);
      setAuthMode(null);
      if (step === "review") await submit();
    } catch (x) {
      setAuthErr(x.message || t("report.err.server"));
    } finally {
      setAuthBusy(false);
    }
  };

  const region = meta?.regions.find(r => r.key === f.regionKey)?.name;
  const accountDialog = authMode && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-deep/60 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="consumer-auth-title" className="relative w-full max-w-md rounded-3xl bg-cream p-6 shadow-2xl">
        <h2 id="consumer-auth-title" className="pr-10 text-2xl font-semibold text-deep">
          {authMode === "signup" ? t("account.createTitle") : t("account.signInTitle")}
        </h2>
        <p className="mt-2 text-sm text-muted">{t("account.required")}</p>
        <div className="mt-5 flex gap-2">
          <Btn type="button" variant={authMode === "signup" ? "deep" : "ghost"} onClick={() => { setAuthMode("signup"); setAuthErr(null); }}>
            {t("account.create")}
          </Btn>
          <Btn type="button" variant={authMode === "signin" ? "deep" : "ghost"} onClick={() => { setAuthMode("signin"); setAuthErr(null); }}>
            {t("account.signIn")}
          </Btn>
        </div>
        <form onSubmit={authenticateAndSubmit} className="mt-5 space-y-4">
          {authMode === "signup" && (
            <Field id="account-name" label={t("account.name")}>
              <input id="account-name" className={inputCls} autoComplete="name" required minLength={2} maxLength={100} value={account.name} onChange={e => setAccount({...account, name: e.target.value})} />
            </Field>
          )}
          <Field id="account-email" label={t("account.email")}>
            <input id="account-email" type="email" className={inputCls} autoComplete="email" required maxLength={200} value={account.email} onChange={e => setAccount({...account, email: e.target.value})} />
          </Field>
          <Field id="account-password" label={t("account.password")} hint={authMode === "signup" ? t("account.passwordHelp") : undefined}>
            <input id="account-password" type="password" className={inputCls} autoComplete={authMode === "signup" ? "new-password" : "current-password"} required minLength={authMode === "signup" ? 12 : 1} maxLength={200} value={account.password} onChange={e => setAccount({...account, password: e.target.value})} />
          </Field>
          {authErr && <Notice tone="error">{authErr}</Notice>}
          <Btn type="submit" loading={authBusy} className="w-full">
            {authMode === "signup" ? (step === "review" ? t("account.createAndSubmit") : t("account.createAndContinue")) : (step === "review" ? t("account.signInAndSubmit") : t("account.signInAndContinue"))}
          </Btn>
        </form>
      </section>
    </div>
  );

  if (done) {
    return (
      <div className="max-w-xl mx-auto py-8">
        <h1 className="text-3xl font-semibold tracking-tight text-deep">{t("done.title")}</h1>
        {done.duplicate && <Notice tone="info" className="mt-4">{t("done.dup")}</Notice>}
        <dl className="mt-6 divide-y divide-line text-sm">
          <div className="flex justify-between py-3"><dt className="text-muted">{t("done.id")}</dt><dd className="font-medium text-deep">{done.complaintId}</dd></div>
          <div className="flex justify-between py-3"><dt className="text-muted">{t("done.track")}</dt><dd className="font-mono font-semibold text-deep tracking-wider">{done.trackingCode}</dd></div>
          <div className="flex justify-between py-3"><dt className="text-muted">{t("status.received")}</dt><dd>{fmtDateTime(done.receivedAt)}</dd></div>
          <div className="flex justify-between py-3"><dt className="text-muted">{t("st." + done.status) ? t("status.product") : ""}</dt><dd className="text-right">{done.product ? `${done.product.name}${done.product.batchId ? " · " + done.product.batchId : ""}` : "—"}</dd></div>
        </dl>
        <p className="mt-4 text-sm">{done.matched === "batch" ? t("done.matchedBatch", {id: done.product.batchId}) : done.matched === "product" ? t("done.matchedProduct") : t("done.unmatched")}</p>
        <p className="mt-2 text-sm font-medium text-deep">{t("done.save")}</p>
        <p className="mt-1 text-sm text-muted">{t("st." + done.status)}</p>
        <div className="mt-8 flex gap-4">
          <Link className="navlink" to={"/consumer/status/" + done.trackingCode}>{t("done.view")}</Link>
          <button className="navlink" onClick={() => { setDone(null); key.current = newKey(); setStep("edit"); setF({identifier: "", productText: "", description: "", regionKey: "", contact: ""}); setImg(null); setPhotos([]); }}>{t("done.another")}</button>
        </div>
      </div>
    );
  }

  if (step === "review") {
    return (
      <>
        <div className="max-w-xl mx-auto py-8">
          <h1 className="text-3xl font-semibold tracking-tight text-deep">{t("report.reviewTitle")}</h1>
          <p className="text-muted mt-2">{t("report.reviewHelp")}</p>
          <dl className="mt-6 divide-y divide-line text-sm">
            {[
              [t("report.identifier"), f.identifier || t("report.none")],
              [t("report.productName"), f.productText || t("report.none")],
              [t("report.image"), img?.name || t("report.none")],
              [t("report.description"), f.description],
              [t("report.photos"), photos.map(p => p.name).join(", ") || t("report.none")],
              [t("report.location"), loc ? t("report.locationOk") : region || t("report.regionNone")],
              [t("report.contact"), f.contact || t("report.none")],
            ].map(([k, v]) => (
              <div key={k} className="py-3 grid sm:grid-cols-[170px_1fr] gap-1">
                <dt className="text-muted">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
          </dl>
          {top && <Notice tone="error" className="mt-4">{top}</Notice>}
          <div className="mt-6 flex gap-3">
            <Btn variant="ghost" onClick={() => setStep("edit")} disabled={busy}>{t("report.edit")}</Btn>
            <Btn onClick={startSubmit} disabled={busy}>{busy ? t("report.submitting") : t("report.submit")}</Btn>
          </div>
        </div>
        {accountDialog}
      </>
    );
  }

  return (
    <>
      <form onSubmit={review} noValidate className="max-w-xl mx-auto py-8 space-y-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-deep">{t("report.title")}</h1>
          <p className="text-muted mt-2">{t("report.sub")}</p>
        </div>
        {top && <Notice tone="error">{top}</Notice>}

        {/* Product Packaging Photo & OCR Recognition */}
        <Field id="img" label={t("report.image")} hint={t("report.imageHelp")} error={err.img}>
          <input id="img" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={onImg} className="text-sm" aria-describedby={describe("img", true, err.img)} />
          {det && (
            <p className="text-sm mt-2" role="status">
              {det.m} {det.code && (
                <button type="button" className="navlink ml-2" onClick={() => { setF({...f, identifier: det.code}); setSrc("scan"); checkOpenFoodFacts(det.code); }}>
                  {t("detect.use")}
                </button>
              )}
            </p>
          )}

          {/* OCR Status & Feedback */}
          {ocrRunning && (
            <div className="flex items-center gap-2 mt-2 text-xs text-muted animate-pulse">
              <Sparkles size={14} className="text-deep" />
              <span>{ocrStatus}</span>
            </div>
          )}
          {ocrResult && (
            <div className="mt-3 p-3 bg-white/70 border border-deep/20 rounded-xl text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-medium text-deep">
                <CheckCircle size={14} className="text-green-600" />
                <span>Text detected on packaging (Tesseract OCR):</span>
              </div>
              {ocrResult.batch && (
                <p>
                  Batch No: <span className="font-mono font-semibold text-deep">{ocrResult.batch}</span>
                  {f.identifier !== ocrResult.batch && (
                    <button type="button" className="navlink ml-2 font-medium" onClick={() => { setF(prev => ({...prev, identifier: ocrResult.batch})); setSrc("image"); }}>
                      Apply Batch No
                    </button>
                  )}
                </p>
              )}
              {ocrResult.mfd && <p className="text-muted">Mfg Date: {ocrResult.mfd}</p>}
              {ocrResult.exp && <p className="text-muted">Expiry / Best Before: {ocrResult.exp}</p>}
              {ocrResult.fssai && <p className="text-deep font-medium">FSSAI Lic No: {ocrResult.fssai}</p>}
            </div>
          )}
          {ocrStatus && !ocrRunning && !ocrResult && (
            <p className="text-xs text-muted mt-1">{ocrStatus}</p>
          )}
        </Field>

        {/* Batch or Barcode Identifier */}
        <Field id="idf" label={t("report.identifier")} hint={t("report.identifierHelp")} error={err.identifier}>
          <div className="flex gap-2">
            <input
              id="idf"
              className={inputCls}
              value={f.identifier}
              placeholder="e.g. MILK-2026-004 or 8900000000011"
              onChange={e => {
                const val = e.target.value;
                setF(prev => ({...prev, identifier: val}));
                setSrc("manual");
                if (/^\d{8,14}$/.test(val.trim())) checkOpenFoodFacts(val.trim());
              }}
              aria-invalid={!!err.identifier}
              aria-describedby={describe("idf", true, err.identifier)}
            />
            {/^\d{8,14}$/.test(f.identifier.trim()) && (
              <Btn type="button" variant="ghost" onClick={() => checkOpenFoodFacts(f.identifier)} loading={offSearching} className="shrink-0 text-xs px-3">
                <Search size={14} className="mr-1" /> Open Food Facts
              </Btn>
            )}
          </div>
          {offProduct && (
            <div className="mt-2 p-2.5 bg-paper rounded-xl border border-line text-xs flex items-center justify-between">
              <div>
                <span className="font-semibold text-deep">Open Food Facts Match: </span>
                <span>{offProduct.name}</span> · <span className="text-muted">{offProduct.brand}</span>
              </div>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-green-100 text-green-800">
                Verified Global GTIN
              </span>
            </div>
          )}
        </Field>

        <Field id="pn" label={t("report.productName")} hint={t("report.productNameHelp")}>
          <input id="pn" className={inputCls} value={f.productText} onChange={set("productText")} />
        </Field>

        <Field id="ds" label={t("report.description")} hint={t("report.descriptionHelp")} error={err.description}>
          <textarea id="ds" rows={5} maxLength={2000} className={inputCls} value={f.description} onChange={set("description")} aria-invalid={!!err.description} aria-describedby={describe("ds", true, err.description)} />
        </Field>

        <Field id="ph" label={t("report.photos")} hint={t("report.photosHelp")} error={err.photos}>
          <input id="ph" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={onPhotos} className="text-sm" />
        </Field>

        {/* Location with OpenStreetMap Nominatim */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-deep">{t("report.location")}</legend>
          <Btn type="button" variant="ghost" onClick={geo}>
            <MapPin size={16} /> {t("report.useLocation")} (OpenStreetMap)
          </Btn>
          {locMsg && <p role="status" className="text-xs text-deep font-medium bg-paper p-2 rounded-lg border border-line">{locMsg}</p>}
          <Field id="rg" label={t("report.region")} error={err.region}>
            <select id="rg" className={inputCls} value={f.regionKey} onChange={set("regionKey")}>
              <option value="">{t("report.regionNone")}</option>
              {meta?.regions.map(r => (
                <option key={r.key} value={r.key}>{r.name}</option>
              ))}
            </select>
          </Field>
        </fieldset>

        <Field id="ct" label={t("report.contact")} hint={t("report.contactHelp")} optional={t("common.optional") ?? "optional"} error={err.contact}>
          <input id="ct" className={inputCls} value={f.contact} onChange={set("contact")} autoComplete="email" />
        </Field>

        <p className="text-sm text-ink/70">{t("report.privacy")}</p>
        <Btn type="submit">{t("report.review")}</Btn>
      </form>
      {accountDialog}
    </>
  );
}
