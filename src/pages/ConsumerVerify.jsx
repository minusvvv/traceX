import {Link,useParams} from "react-router-dom";import {ShieldCheck,AlertCircle,MapPin} from "lucide-react";import useAsync from "../hooks/useAsync.js";import {getPublicBatch} from "../services/api.js";
import LoadingState from "../components/common/LoadingState.jsx";import {StageList} from "../components/batch/BatchDossier.jsx";import {Mark} from "../components/brand/TraceXLogo.jsx";import StatusBadge from "../components/common/StatusBadge.jsx";import {useT} from "../i18n/index.jsx";import {fmtDay} from "../utils/formatters.js";import {ErrorState,Notice} from "../components/common/Form.jsx";
export default function ConsumerVerify(){const {batchId}=useParams(),{t}=useT(),{data:b,error,loading,reload}=useAsync(()=>getPublicBatch(batchId),[batchId]);
  if(loading)return <LoadingState/>;
  if(error&&error.status===404)return <div className="max-w-md mx-auto text-center py-16"><AlertCircle className="mx-auto text-review" size={36}/><h1 className="mt-4 text-2xl font-semibold text-deep">{t("verify.notFound")}</h1><p className="text-muted mt-2">{t("verify.notFoundText",{code:batchId})}</p><Link to="/consumer" className="navlink mt-4 inline-block">{t("verify.tryAnother")}</Link></div>;
  if(error)return <ErrorState error={error} onRetry={reload}/>;
  const ok=b.status==="safe",R=({k,v})=><div className="flex justify-between gap-4 py-3"><dt className="text-muted">{k}</dt><dd className="font-medium text-deep text-right">{v}</dd></div>;
  return <div className="max-w-md mx-auto"><div className="text-center"><Mark size={28} className="mx-auto text-deep"/>
    <div className={"mx-auto mt-6 w-16 h-16 rounded-full grid place-items-center "+(ok?"bg-deep text-cream":"bg-review/15 text-review")}>{ok?<ShieldCheck size={30}/>:<AlertCircle size={30}/>}</div>
    <h1 className="mt-5 text-3xl font-semibold tracking-tight text-deep">{ok?t("verify.verified"):t("verify.review")}</h1><p className="text-muted mt-1">{b.id} · {b.product}</p></div>
    {b.regulatory&&<Notice tone="error" className="mt-6">{t("verify.recall",{label:b.regulatory.label,ref:b.regulatory.reference})}</Notice>}
    {!ok&&!b.regulatory&&<p className="mt-6 text-sm border-l-2 border-review pl-4">{t("verify.reviewNote")}</p>}
    <dl className="mt-8 divide-y divide-line text-sm"><R k={t("verify.category")} v={b.categoryLabel}/>{b.brand&&<R k={t("verify.brand")} v={b.brand}/>}{b.lot&&<R k={t("verify.lot")} v={b.lot}/>}<R k={t("verify.made")} v={fmtDay(b.manufacturedOn)}/><R k={t("verify.expiry")} v={b.expiresOn?fmtDay(b.expiresOn):t("verify.na")}/>
      <R k={t("verify.source")} v={<span className="inline-flex items-center gap-1"><MapPin size={14}/>{b.origin||"—"}</span>}/>{b.score!=null&&<R k={t("verify.quality")} v={b.score+"%"}/>}<R k={t("verify.status")} v={<StatusBadge status={b.status}/>}/><R k={t("verify.chain")} v={t("verify.stages",{n:b.route.length})}/></dl>
    <h2 className="mt-10 mb-5 font-semibold text-deep">{t("verify.journey")}</h2><StageList batch={b}/>
    <p className="mt-10 text-center"><Link className="navlink" to={"/consumer/report?batch="+encodeURIComponent(b.id)}>{t("verify.reportBtn")}</Link></p></div>}
