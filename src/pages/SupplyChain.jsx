import {useState} from "react";import {MapPin,ArrowRightFromLine,ArrowRightToLine,ShieldCheck,CircleDashed} from "lucide-react";
import useBatches from "../hooks/useBatches.js";import LoadingState from "../components/common/LoadingState.jsx";import PageHeader from "../components/common/PageHeader.jsx";
import MapPanel from "../components/map/MapPanel.jsx";import StatusBadge from "../components/common/StatusBadge.jsx";import {ErrorState,Empty} from "../components/common/Form.jsx";import {fmtDateTime,fmtAgo} from "../utils/formatters.js";
import Page from "../components/ui/Page.jsx";import Panel from "../components/ui/Panel.jsx";import MapLegend from "../components/ui/Legend.jsx";
// A recorded handover. `source` shows where the record came from; a missing value is shown as "Not recorded", never guessed.
const srcLabel=s=>!s?null:s==="demo-seed"?"Demonstration record":"Supplied by data provider";
function Timeline({items,focusId,onFocus,empty}){
  if(!items.length)return <Empty icon={CircleDashed}>{empty}</Empty>;
  return <ol className="relative">
    <span aria-hidden className="absolute left-[13px] top-3 bottom-3 w-px bg-deep/20"/>
    {items.map((r,i)=>{const on=focusId===r.id,hasPos=r.lat!=null&&r.lng!=null;
      return <li key={r.id} className="relative">
        <button type="button" onClick={()=>onFocus(on?null:r.id)} disabled={!hasPos} aria-pressed={on} aria-label={`${r.stage}, ${r.place}${hasPos?", show on map":""}`}
          className={"w-full text-left pl-10 pr-3 py-3 rounded-xl transition-colors duration-150 "+(on?"bg-cream/50":"hover:bg-sand/50")+(hasPos?" cursor-pointer":" cursor-default")}>
          <span className={"absolute left-[7px] top-[18px] w-3.5 h-3.5 rounded-full border-2 border-off "+(on?"bg-deep ring-4 ring-cream":"bg-deep/80")}/>
          <span className="flex items-baseline justify-between gap-3"><span className="text-sm font-medium text-deep">{r.stage}</span><span className="text-xs text-muted tabular-nums shrink-0">{i+1}/{items.length}</span></span>
          <span className="block text-sm text-ink/80">{r.place||<span className="text-muted">Organisation not recorded</span>}</span>
          <span className="block text-xs text-muted mt-0.5"><MapPin size={11} className="inline -mt-0.5 mr-1" aria-hidden/>{r.region||(hasPos?"Coordinates recorded":"Location not recorded")} · {r.time?fmtDateTime(r.time):"Time not recorded"}</span>
          {srcLabel(r.source)&&<span className="block text-[11px] text-muted/80 mt-0.5">{srcLabel(r.source)}</span>}</button></li>})}</ol>}
const F=({k,v,wide})=><div className={wide?"col-span-2":""}><dt className="text-[11px] font-medium tracking-wide uppercase text-muted">{k}</dt><dd className="text-sm font-medium text-deep mt-0.5">{v}</dd></div>,NR=<span className="font-normal text-muted">Not recorded</span>;
export default function SupplyChain(){const {batches,loading,error,reload}=useBatches(),[id,setId]=useState(null),[focus,setFocus]=useState(null);if(error)return <ErrorState error={error} onRetry={reload}/>;if(loading)return <LoadingState variant="map"/>;
  if(!batches.length)return <Empty>No batches recorded yet.</Empty>;
  const b=batches.find(x=>x.id===id)||batches[0],last=b.route[b.route.length-1],pick=v=>{setId(v);setFocus(null)};
  const groups=[...new Set(batches.map(x=>x.categoryLabel))],visible=b.route.filter(r=>r.kind!=="testing"),back=visible.filter(r=>r.side==="upstream"||r.side==="manufacturer").reverse(),fwd=visible.filter(r=>r.side==="downstream");
  const lastTime=last?.time||b.lastUpdate;
  return <Page className="space-y-8"><PageHeader eyebrow="Traceability" title="Live supply chain" sub="Follow one batch along its recorded route. Everything shown comes from recorded handovers; gaps are marked as not recorded."/>
    <section aria-label="Selected batch" className="panel overflow-hidden">
      <div className="bg-deep-grad text-off px-5 md:px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0"><p className="text-xs tracking-[.14em] uppercase text-cream/70">Selected batch · {b.categoryLabel}</p><p className="text-2xl font-semibold tracking-tight">{b.id}<span className="text-off/60 font-normal text-lg"> · {b.product}</span></p></div>
        <div className="flex items-center gap-3 flex-wrap"><StatusBadge status={b.status} className="!bg-off"/>
          <div><label htmlFor="sel" className="sr-only">Choose batch</label><select id="sel" value={b.id} onChange={e=>pick(e.target.value)} className="bg-white/10 text-off border border-white/25 rounded-full px-4 py-2 text-sm focus-visible:outline-cream max-w-[16rem]">{groups.map(g=><optgroup key={g} label={g} className="text-ink">{batches.filter(x=>x.categoryLabel===g).map(x=><option key={x.id} value={x.id} className="text-ink">{x.id} · {x.product}</option>)}</optgroup>)}</select></div></div></div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_330px]">
        <div className="relative h-[400px] lg:h-[580px] border-b lg:border-b-0 lg:border-r border-line"><MapPanel batches={batches} selectedId={b.id} onSelect={pick} focusId={focus} onStopSelect={setFocus}/><MapLegend className="absolute z-[500] right-3 bottom-3"/></div>
        <aside className="p-5 md:p-6 bg-paper" aria-label="Batch summary"><h2 className="text-sm font-semibold text-deep mb-4">Where it is now</h2>
          <div className="rounded-xl bg-cream/40 px-4 py-3 mb-5"><p className="text-[11px] font-medium tracking-wide uppercase text-muted">Current stage</p><p className="text-lg font-semibold text-deep">{b.stages[b.cur]}</p>
            <div aria-hidden className="mt-2 flex gap-1">{b.stages.map((s,i)=><span key={s} className={"h-1 flex-1 rounded-full "+(i<=b.cur?"bg-deep":"bg-deep/15")}/>)}</div><p className="text-xs text-muted mt-1.5">Stage {b.cur+1} of {b.stages.length}</p></div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
            <F k="Origin" v={b.origin||NR} wide/><F k="Manufacturing facility" v={b.facility||NR} wide/><F k="Destination" v={b.destination?.place||NR} wide/>
            <F k="Last update" v={lastTime?<>{fmtDateTime(lastTime)}{fmtAgo(lastTime)&&<span className="block text-xs font-normal text-muted">{fmtAgo(lastTime)}</span>}</>:NR}/>
            <F k="Quality" v={b.score!=null?b.score+"%":NR}/>
            {b.temp!=null&&<F k="Temperature" v={<>{b.temp} °C{b.temp>8&&<span className="block text-xs font-normal text-[#8A5A12]">Above 8 °C: review</span>}</>}/>}
            <F k="Risk" v={b.risk.assessed?`${b.risk.level} (${b.risk.score}/100)`:<span className="font-normal text-muted">Not assessed</span>}/></dl>
          <p className="mt-5 text-xs text-muted flex gap-2"><ShieldCheck size={14} className="shrink-0 mt-0.5" aria-hidden/>The formal traceability and risk assessment for a contamination case runs from the investigation, after a laboratory report confirms contamination.</p></aside></div></section>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
      <Panel icon={ArrowRightFromLine} title="Backward trace" desc="From the manufacturer to upstream handlers, as recorded. Select a stop to see it on the map." id="back"><Timeline items={back} focusId={focus} onFocus={setFocus} empty="No upstream records."/></Panel>
      <Panel icon={ArrowRightToLine} title="Forward trace" desc="Warehouses, distributors and retailers that received this batch." id="fwd"><Timeline items={fwd} focusId={focus} onFocus={setFocus} empty="No downstream records yet."/></Panel></div></Page>}
