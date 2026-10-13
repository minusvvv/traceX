import {useState} from "react";import {useNavigate,useParams} from "react-router-dom";import useAsync from "../hooks/useAsync.js";import {getComplaintStatus} from "../services/api.js";import {apiUrl} from "../services/http.js";import {Btn,Notice,ErrorState,inputCls} from "../components/common/Form.jsx";import LoadingState from "../components/common/LoadingState.jsx";import {useT} from "../i18n/index.jsx";import {fmtDateTime} from "../utils/formatters.js";
function ComplaintPhoto({photo,t}){const [failed,setFailed]=useState(false),url=apiUrl("/public/complaint-attachments/"+encodeURIComponent(photo.id));
  return failed?<div role="img" aria-label={t("status.photoUnavailable")} className="grid h-24 w-24 place-items-center rounded-xl border border-line bg-sand/50 p-2 text-center text-xs text-muted">{t("status.photoUnavailable")}</div>
    :<a href={url} target="_blank" rel="noreferrer"><img className="h-24 w-24 rounded-xl border border-line object-cover" src={url} alt={t("status.similarPhoto")} loading="lazy" onError={()=>setFailed(true)}/></a>}
function Result({code}){const {t}=useT(),{data:c,error,loading,reload}=useAsync(()=>getComplaintStatus(code),[code]);
  if(loading)return <LoadingState/>;if(error?.status===404)return <Notice tone="error" className="mt-6">{t("status.notFound")}</Notice>;if(error)return <ErrorState error={error} onRetry={reload}/>;
  const R=({k,v})=><div className="py-3 grid sm:grid-cols-[170px_1fr] gap-1"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>;
  return <div className="mt-8"><p className="text-2xl font-semibold text-deep">{t("st."+c.status)}</p>
    {c.status==="received_unmatched"&&<Notice tone="info" className="mt-4">{t("status.unmatchedHelp")}</Notice>}
    {!!c.similarReports?.count&&<section className="mt-5"><h2 className="text-lg font-semibold text-deep">{t("status.similarFound",{n:c.similarReports.count})}</h2><p className="mt-1 text-sm text-muted">{t("status.similarPrivacy")}</p>
      <ul className="mt-3 space-y-3">{c.similarReports.reports.map((r,i)=><li key={`${r.batchId||r.product}-${r.receivedAt}-${i}`} className="rounded-2xl border border-line bg-white/60 p-4">
        <p className="text-sm font-medium text-deep">{r.product||t("status.productUnmatched")}{r.batchId?` · ${t("status.batch")} ${r.batchId}`:""}</p>
        <p className="mt-1 text-xs text-muted">{fmtDateTime(r.receivedAt)} · {t("st."+r.status)}</p>
        <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{r.description}</p>
        {!!r.photos.length&&<div className="mt-3 flex flex-wrap gap-2">{r.photos.map(photo=><ComplaintPhoto key={photo.id} photo={photo} t={t}/>)}</div>}
      </li>)}</ul>
    </section>}
    <dl className="mt-4 divide-y divide-line text-sm"><R k={t("done.id")} v={c.complaintId}/><R k={t("status.received")} v={fmtDateTime(c.receivedAt)}/><R k={t("status.product")} v={c.product?`${c.product.name} (${c.product.category.replace("_"," ")})`:"—"}/>{c.product?.batchId&&<R k={t("status.batch")} v={c.product.batchId}/>}{c.region&&<R k={t("status.area")} v={c.region}/>}<R k={t("status.attachments")} v={c.attachments}/><R k={t("report.description")} v={c.description}/></dl>
    {c.sampleRequested&&<Notice tone="info" className="mt-6" title={t("status.sample")}>{t("status.sampleNote")}</Notice>}<p className="mt-6 text-sm text-ink/70">{t("status.disclaimer")}</p></div>}
export default function ConsumerStatus(){const {code}=useParams(),nav=useNavigate(),{t}=useT(),[q,setQ]=useState(code||"");
  return <div className="max-w-xl mx-auto py-8"><h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-deep">{t("status.title")}</h1><p className="text-muted mt-2">{t("status.sub")}</p>
    <form onSubmit={e=>{e.preventDefault();q.trim()&&nav("/consumer/status/"+q.trim().toUpperCase())}} className="mt-6 flex gap-2"><label htmlFor="tc" className="sr-only">{t("status.code")}</label><input id="tc" className={inputCls+" font-mono"} placeholder="XXXX-XXXX-XXXX" value={q} onChange={e=>setQ(e.target.value)}/><Btn type="submit">{t("status.check")}</Btn></form>
    {code&&<Result code={code}/>}</div>}
