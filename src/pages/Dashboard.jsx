import {useEffect,useState} from "react";import {Link} from "react-router-dom";import {Boxes,Truck,BellRing,FlaskConical,RefreshCw,AlertTriangle,Info,CircleAlert,Flag,Package} from "lucide-react";
import useBatches from "../hooks/useBatches.js";import useAsync from "../hooks/useAsync.js";import useMeta from "../hooks/useMeta.js";import {getDashboard,getHotspots,getPrioritization} from "../services/api.js";
import LoadingState from "../components/common/LoadingState.jsx";import StatusBadge from "../components/common/StatusBadge.jsx";import PageHeader from "../components/common/PageHeader.jsx";
import MapPanel from "../components/map/MapPanel.jsx";import MapInfoPanel from "../components/map/MapInfoPanel.jsx";import {ErrorState,Select,Empty,Btn} from "../components/common/Form.jsx";
import Page from "../components/ui/Page.jsx";import Panel from "../components/ui/Panel.jsx";import StatTile from "../components/ui/StatTile.jsx";import MapLegend from "../components/ui/Legend.jsx";import {fmtDateTime,fmtAgo,fmtTime} from "../utils/formatters.js";
const EV={alert:[AlertTriangle,"bg-review/18 text-[#8A5A12]","Needs attention"],warn:[CircleAlert,"bg-review/12 text-[#8A5A12]","Review"]},EV_DEFAULT=[Info,"bg-sand text-deep/70",null];
export default function Dashboard(){const [cat,setCat]=useState(""),{meta}=useMeta(),{batches,loading,error,reload}=useBatches(),{data:dash,reload:rd,error:de}=useAsync(getDashboard),{data:hot}=useAsync(getHotspots),{data:pri,reload:rp}=useAsync(getPrioritization),[id,setId]=useState(null),[updated,setUpdated]=useState(null),[busy,setBusy]=useState(false);
  const refresh=()=>{setBusy(true);rd();rp();reload();setTimeout(()=>setBusy(false),6000)};
  // Live view = periodic refresh of real server data (30 s). Nothing on this page is simulated.
  useEffect(()=>{const t=setInterval(()=>{rd();rp();reload()},30000);return()=>clearInterval(t)},[rd,rp,reload]);
  useEffect(()=>{if(dash){setUpdated(new Date());setBusy(false)}},[dash]);
  if(error||de)return <ErrorState error={error||de} onRetry={()=>{reload();rd()}}/>;if(loading||!dash)return <LoadingState variant="cards"/>;
  const shown=batches.filter(b=>!cat||b.category===cat),sel=shown.find(x=>x.id===id)||shown[0],n=dash.network,flagged=(pri?.flagged||[]).filter(f=>!cat||f.category===cat);
  return <Page className="space-y-8">
    <PageHeader eyebrow="Operations" title="Control tower" sub="Product batches across all categories: where they are, what needs attention, and what is waiting on a laboratory.">
      <span className="text-xs text-muted text-right leading-snug" aria-live="polite">{updated&&<>Updated {fmtTime(updated)}<br/></>}Refreshes every 30 s</span>
      <Btn variant="ghost" onClick={refresh} loading={busy} aria-label="Refresh data now"><RefreshCw size={15} aria-hidden/>Refresh</Btn></PageHeader>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
      <StatTile label="Active batches" value={n.active} icon={Boxes}/><StatTile label="In transit" value={n.inTransit} icon={Truck}/>
      <StatTile label="Open alerts" value={n.alerts} icon={BellRing} tone={n.alerts>0?"attention":"default"} hint={n.alerts>0?"Complaint flags and quality deviations":"Nothing needs attention"}/>
      <StatTile label="Pending samples" value={n.pendingSamples} icon={FlaskConical} hint="Awaiting laboratory results"/></div>
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3"><div className="flex items-center gap-3"><label htmlFor="cat" className="text-sm text-muted">Category</label><Select id="cat" value={cat} onChange={e=>{setCat(e.target.value);setId(null)}}><option value="">All categories</option>{meta&&Object.values(meta.categories).map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</Select></div>
          <p className="text-sm text-muted">{shown.length} batch{shown.length===1?"":"es"} on the map · click a route to select</p></div>
        <div className="relative h-[420px] lg:h-[560px] rounded-2xl overflow-hidden border border-line shadow-[var(--shadow-soft)]"><MapPanel batches={shown} selectedId={sel?.id} onSelect={setId} hotspots={hot||[]}/>
          {sel&&<MapInfoPanel batch={sel} className="absolute z-[500] left-3 bottom-3 !w-56 hidden sm:block"/>}<MapLegend hotspots className="absolute z-[500] right-2 bottom-2 sm:right-3 sm:bottom-3"/></div></div>
      <Panel title="Recent events" desc="Newest first, from recorded activity." id="events" className="lg:max-h-[640px] lg:overflow-y-auto">
        {dash.events.length?<ul className="space-y-1 -mx-2">{dash.events.map((e,i)=>{const [I,c,tag]=EV[e.tone]||EV_DEFAULT;return <li key={e.at+i} className={"flex gap-3 rounded-xl px-2 py-2.5 "+(e.tone==="alert"?"bg-review/8":"")}>
          <span className={"mt-0.5 grid place-items-center w-7 h-7 rounded-full shrink-0 "+c}><I size={14} aria-hidden/></span>
          <span className="text-sm min-w-0"><span className="block text-xs text-muted"><time dateTime={e.at}>{fmtDateTime(e.at)}</time>{fmtAgo(e.at)&&<> · {fmtAgo(e.at)}</>}{tag&&<span className="ml-2 font-medium text-[#8A5A12]">{tag}</span>}</span>
            {e.batch&&<Link className="font-medium text-deep navlink" to={"/batches/"+e.batch}>{e.batch}</Link>}{e.batch&&" · "}<span className="text-ink/80">{e.text}</span></span></li>})}</ul>:<Empty icon={Info}>No events yet.</Empty>}</Panel></div>
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
      <Panel icon={Flag} title="Flagged for review" desc="Ranked by complaint volume and recency. A flag means a complaint threshold was reached. It is not a finding of contamination or a recall.">
        {flagged.length?<div className="overflow-x-auto -mx-2"><table className="tbl min-w-[520px]"><thead><tr><th>#</th><th>Batch</th><th>Complaints</th><th>Investigation</th><th>Status</th></tr></thead><tbody>{flagged.map(f=><tr key={f.flagId}>
          <td className="tabular-nums text-muted">{f.rank}</td><td>{f.batchId?<Link className="navlink font-medium text-deep" to={"/batches/"+f.batchId}>{f.batchId}</Link>:<span className="font-medium text-deep">Batch unknown</span>}<span className="block text-xs text-muted">{f.product}</span></td>
          <td><span className="tabular-nums">{f.count}</span> in {f.windowDays} d<span className="block text-xs text-muted">threshold {f.threshold}</span><span aria-hidden className="block mt-1 h-1 w-24 rounded-full bg-sand overflow-hidden"><span className="block h-full bg-review" style={{width:Math.min(100,f.count/f.threshold*100)+"%"}}/></span></td>
          <td>{f.investigationId?<Link className="navlink" to={"/investigations/"+f.investigationId}>{f.investigationId}</Link>:<span className="text-muted">None yet</span>}</td><td><StatusBadge status={f.status}/></td></tr>)}</tbody></table></div>:<Empty icon={Flag}>Nothing is currently flagged.</Empty>}</Panel>
      <Panel icon={Package} title="Batches" desc="Everything in the selected category." actions={<Link to="/batches" className="text-sm navlink text-deep">All batches</Link>}>
        {shown.length?<div className="overflow-x-auto -mx-2"><table className="tbl min-w-[460px]"><thead><tr><th>Batch</th><th>Product</th><th>Quality</th><th>Status</th></tr></thead><tbody>{shown.map(x=><tr key={x.id}><td><Link className="navlink font-medium text-deep" to={"/batches/"+x.id}>{x.id}</Link></td><td>{x.product}<span className="block text-xs text-muted">{x.categoryLabel}</span></td><td className="tabular-nums">{x.score!=null?x.score+"%":<span className="text-muted">—</span>}</td><td><StatusBadge status={x.status}/></td></tr>)}</tbody></table></div>:<Empty icon={Package}>No batches in this category.</Empty>}</Panel></div></Page>}
