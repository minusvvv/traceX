import {Link, useParams} from "react-router-dom";
import {ShieldCheck, AlertCircle, MapPin, Globe, Sparkles} from "lucide-react";
import useAsync from "../hooks/useAsync.js";
import {getPublicBatch} from "../services/api.js";
import LoadingState from "../components/common/LoadingState.jsx";
import {StageList} from "../components/batch/BatchDossier.jsx";
import {Mark} from "../components/brand/TraceXLogo.jsx";
import StatusBadge from "../components/common/StatusBadge.jsx";
import {useT} from "../i18n/index.jsx";
import {fmtDay} from "../utils/formatters.js";
import {ErrorState, Notice} from "../components/common/Form.jsx";

export default function ConsumerVerify() {
  const {batchId} = useParams(), {t} = useT(), {data: b, error, loading, reload} = useAsync(() => getPublicBatch(batchId), [batchId]);

  if (loading) return <LoadingState />;
  if (error && error.status === 404) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <AlertCircle className="mx-auto text-review" size={36} />
        <h1 className="mt-4 text-2xl font-semibold text-deep">{t("verify.notFound")}</h1>
        <p className="text-muted mt-2">{t("verify.notFoundText", {code: batchId})}</p>
        <Link to="/consumer" className="navlink mt-4 inline-block">{t("verify.tryAnother")}</Link>
      </div>
    );
  }
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const ok = b.status === "safe";
  const R = ({k, v}) => (
    <div className="flex justify-between gap-4 py-3">
      <dt className="text-muted">{k}</dt>
      <dd className="font-medium text-deep text-right">{v}</dd>
    </div>
  );

  return (
    <div className="max-w-md mx-auto">
      <div className="text-center">
        <Mark size={28} className="mx-auto text-deep" />
        <div className={"mx-auto mt-6 w-16 h-16 rounded-full grid place-items-center " + (ok ? "bg-deep text-cream" : "bg-review/15 text-review")}>
          {ok ? <ShieldCheck size={30} /> : <AlertCircle size={30} />}
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-deep">
          {ok ? t("verify.verified") : t("verify.review")}
        </h1>
        <p className="text-muted mt-1">{b.id} · {b.product}</p>
      </div>

      {b.isOpenFoodFacts && (
        <div className="mt-6 p-4 rounded-2xl bg-paper border border-line space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-deep">
            <Globe size={15} className="text-blue-600" />
            <span>Verified via Open Food Facts Global Registry</span>
          </div>
          {b.imageUrl && (
            <div className="w-full flex justify-center py-2">
              <img src={b.imageUrl} alt={b.product} className="max-h-40 rounded-xl object-contain border border-line" />
            </div>
          )}
          {b.ingredients && (
            <div className="text-xs">
              <span className="font-semibold text-deep">Ingredients: </span>
              <span className="text-muted">{b.ingredients}</span>
            </div>
          )}
          {b.nutriscore && (
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-deep">Nutri-Score Grade:</span>
              <span className="px-2 py-0.5 rounded-md font-bold bg-green-600 text-white text-[11px]">
                {b.nutriscore}
              </span>
            </div>
          )}
        </div>
      )}

      {b.notice && !b.regulatory && (
        <p className="mt-4 text-xs text-center text-muted bg-cream/70 p-2.5 rounded-xl border border-line">
          {b.notice}
        </p>
      )}

      {b.regulatory && (
        <Notice tone="error" className="mt-6">
          {t("verify.recall", {label: b.regulatory.label, ref: b.regulatory.reference})}
        </Notice>
      )}
      {!ok && !b.regulatory && (
        <p className="mt-6 text-sm border-l-2 border-review pl-4">{t("verify.reviewNote")}</p>
      )}

      <dl className="mt-8 divide-y divide-line text-sm">
        <R k={t("verify.category")} v={b.categoryLabel || b.category} />
        {b.brand && <R k={t("verify.brand")} v={b.brand} />}
        {b.lot && <R k={t("verify.lot")} v={b.lot} />}
        {b.manufacturedOn && <R k={t("verify.made")} v={fmtDay(b.manufacturedOn)} />}
        {b.expiresOn && <R k={t("verify.expiry")} v={fmtDay(b.expiresOn)} />}
        {b.origin && (
          <R k={t("verify.source")} v={<span className="inline-flex items-center gap-1"><MapPin size={14} />{b.origin}</span>} />
        )}
        {b.score != null && <R k={t("verify.quality")} v={b.score + "%"} />}
        <R k={t("verify.status")} v={<StatusBadge status={b.status} />} />
        {b.route?.length > 0 && <R k={t("verify.chain")} v={t("verify.stages", {n: b.route.length})} />}
      </dl>

      {b.route?.length > 0 && (
        <>
          <h2 className="mt-10 mb-5 font-semibold text-deep">{t("verify.journey")}</h2>
          <StageList batch={b} />
        </>
      )}

      <p className="mt-10 text-center">
        <Link className="navlink" to={"/consumer/report?batch=" + encodeURIComponent(b.id)}>
          {t("verify.reportBtn")}
        </Link>
      </p>
    </div>
  );
}
