import {Link} from "react-router-dom";import {fmtDateTime,fmtDay,fmtDate,qualitySeries,stageState,fmtReading} from "../../utils/formatters.js";
import StatusBadge from "../common/StatusBadge.jsx";import QualityChart from "../charts/QualityChart.jsx";import MetricCard from "../common/MetricCard.jsx";import {Empty} from "../common/Form.jsx";
import useAsync from "../../hooks/useAsync.js";import useMeta from "../../hooks/useMeta.js";import {useAuth} from "../../auth/AuthContext.jsx";
import {getBatchLabReports,getInvestigations,getComplaints} from "../../services/api.js";
// Works for internal and public batch objects; `batch.stages` is the category's own stage list (not a fixed dairy list).
export function StageList({batch,flagged}){
  return <ol className="relative">
    <span aria-hidden className="absolute left-[11px] top-2 bottom-2 w-px bg-deep/20"/>
    {batch.stages.map((st,i)=>{const rs=batch.route.filter(x=>x.stage===st),state=stageState(batch,i),bad=flagged===st;
      return <li key={st} className="relative pl-10 pb-6 last:pb-0" aria-current={state==="current"?"step":undefined}>
        <span className={"absolute left-1 top-1.5 w-[15px] h-[15px] rounded-full "+(bad?"bg-susp ring-4 ring-susp/20":state==="pending"?"bg-off ring-1 ring-muted/50":"bg-deep "+(state==="current"?"ring-4 ring-cream":""))}/>
        <p className={"font-medium "+(state==="pending"?"text-muted":"text-deep")}>{st}{state==="current"&&<span className="ml-2 text-xs text-muted font-normal">Current</span>}{bad&&<span className="ml-2 text-xs text-susp font-normal">Quality deviation detected</span>}</p>
        {rs.length?rs.map((r,j)=><p key={r.id??j} className="text-sm text-muted">{fmtDateTime(r.time)} · {r.place}{r.notes&&<><br/>{r.notes}</>}</p>):<p className="text-sm text-muted">{i<batch.cur?"No record":"Pending"}</p>}</li>})}</ol>}
const OUT={confirmed:"text-crit",not_confirmed:"text-deep",inconclusive:"text-ink"};
export default function BatchDossier({batch}){
  const {user}=useAuth(),staff=user?.role==="reviewer"||user?.role==="admin",{meta}=useMeta(),an=batch.anomaly,tests=(meta?.categories[batch.category]?.tests||[]).filter(t=>batch.route.some(r=>r.readings?.[t.code]!=null));
  const {data:lab}=useAsync(()=>getBatchLabReports(batch.id),[batch.id]),{data:inv}=useAsync(()=>staff?getInvestigations({batch:batch.id}):Promise.resolve([]),[batch.id,staff]),{data:cs}=useAsync(()=>staff?getComplaints({batch:batch.id}):Promise.resolve([]),[batch.id,staff]);
  const D=({k,v})=><div><dt className="text-xs text-muted">{k}</dt><dd className="font-medium text-deep">{v??"—"}</dd></div>;
  return <article className="space-y-14">
    <header className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 border-b border-line pb-10">
      <div><p className="text-sm text-muted">Batch</p><h2 className="text-3xl font-semibold tracking-tight text-deep">{batch.id}</h2><p className="text-muted mt-1">{batch.product} · {batch.qty}</p></div>
      <div><p className="text-sm text-muted">Status</p><p className="mt-2 text-lg"><StatusBadge status={batch.status}/></p></div>
      <MetricCard label="Quality" value={batch.score!=null?batch.score+"%":"—"}/><MetricCard label="Source" value={(batch.origin||"—").split(" ")[0]} hint={batch.origin}/></header>
    <section aria-label="Product batch details"><h3 className="text-xl font-semibold text-deep mb-5">Product batch details</h3>
      <dl className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-5 text-sm">
        <D k="Category" v={batch.categoryLabel}/><D k="Brand" v={batch.brand}/><D k="Manufacturer" v={batch.manufacturer}/><D k="Manufacturing facility" v={batch.facility}/>
        <D k="Lot" v={batch.lot}/><D k="Manufactured" v={fmtDay(batch.manufacturedOn)}/><D k="Best before / expiry" v={batch.expiresOn?fmtDay(batch.expiresOn):"Not applicable"}/><D k="Laboratory status" v={batch.labLabel}/>
        <D k="Consumer complaints" v={`${batch.complaintCount} total · ${batch.complaintWindowCount} in last ${batch.threshold.windowDays} days (threshold ${batch.threshold.count})`}/>
        <D k="Risk assessment" v={batch.risk.assessed?`${batch.risk.level} (${batch.risk.score}/100)`:"Not assessed (needs confirmed contamination)"}/>
        <D k="Regulatory status" v={batch.recall.label+(batch.recall.reference?` · ${batch.recall.reference}`:"")}/><D k="Complaint flag" v={batch.flagged?"Flagged: threshold reached":"Not flagged"}/></dl>
      {batch.flagged&&batch.labStatus!=="confirmed"&&<p className="mt-4 text-sm text-ink/80 max-w-2xl">This batch is flagged for review because complaints reached the threshold. Complaints are unverified reports: this is not a finding of contamination and not a recall.</p>}</section>
    {an&&<section className="border-l-2 border-susp pl-5"><h3 className="font-semibold text-susp">Quality deviation detected</h3>
      <p className="text-sm text-ink/80 mt-1">Possible contamination stage: <b>{an.from} → {an.to}</b>. Readings changed between these stages. This is a stage requiring investigation and laboratory verification, not a finding against any participant.</p></section>}
    <div className="grid lg:grid-cols-2 gap-14">
      <section><h3 className="text-xl font-semibold text-deep mb-6">Supply-chain timeline</h3><StageList batch={batch} flagged={an?.flagged}/></section>
      <section><h3 className="text-xl font-semibold text-deep mb-4">Quality history</h3>{batch.route.some(r=>r.qs!=null)?<QualityChart data={qualitySeries(batch)} height={240} domain={[80,100]}/>:<Empty>No quality scores recorded.</Empty>}
        {tests.length>0&&<div className="overflow-x-auto mt-6"><table className="w-full text-sm"><thead><tr className="text-left text-muted border-b border-line"><th className="py-2 font-normal">Stage</th>{tests.map(t=><th key={t.code} className="font-normal pr-3">{t.label}{t.unit&&t.type==="number"?` (${t.unit})`:""}</th>)}</tr></thead>
          <tbody>{batch.route.filter(r=>r.readings&&Object.keys(r.readings).length).map(r=><tr key={r.id} className={"border-b border-line/60 "+(an?.flagged===r.stage?"text-susp":"")}><td className="py-2 pr-3">{r.stage}</td>{tests.map(t=><td key={t.code} className="pr-3">{r.readings[t.code]??"—"}</td>)}</tr>)}</tbody></table></div>}</section></div>
    <div className="grid lg:grid-cols-2 gap-14 border-t border-line pt-10">
      <section><h3 className="text-xl font-semibold text-deep mb-4">Laboratory evidence</h3>{lab?.length?<ul className="divide-y divide-line">{lab.map(r=><li key={r.id} className="py-3 flex justify-between gap-4 text-sm"><span><b className="font-medium">{r.id}</b> · {r.lab}<br/><span className="text-muted">{r.resultRows.map(x=>`${x.label} ${x.value}${x.unit&&x.unit!=="%"?" "+x.unit:x.unit}`).join(" · ")}</span></span><span className={OUT[r.outcome]}>{r.status}</span></li>)}</ul>:<Empty>No laboratory reports linked.</Empty>}</section>
      <section><h3 className="text-xl font-semibold text-deep mb-4">Investigation status</h3>{!staff?<Empty>Investigation records are available to FSSAI reviewers and administrators.</Empty>:inv?.length?<ul className="divide-y divide-line">{inv.map(i=><li key={i.id} className="py-3 text-sm"><Link className="navlink font-medium" to={"/investigations/"+i.id}>{i.id}</Link> · {i.status}<br/><span className="text-muted">{i.title}</span></li>)}</ul>:<Empty>No investigation.</Empty>}</section></div>
    {staff&&<section className="border-t border-line pt-10"><h3 className="text-xl font-semibold text-deep mb-1">Consumer complaints</h3><p className="text-sm text-muted mb-4">Unverified reports. Contact details are masked; precise locations are not stored in this view.</p>
      {cs?.length?<ul className="divide-y divide-line text-sm">{cs.map(c=><li key={c.id} className="py-2.5">“{c.text}”<br/><span className="text-muted">{c.id} · {c.region||"area not given"} · {fmtDate(c.date)} · {c.statusLabel}</span></li>)}</ul>:<Empty>No complaints recorded for this batch.</Empty>}</section>}
  </article>}
