import {useState} from "react";import {Link} from "react-router-dom";import {ArrowRight,QrCode,MapPin,ShieldCheck,Route} from "lucide-react";
import Reveal from "../common/Reveal.jsx";import CTAButton from "../common/CTAButton.jsx";import StatusBadge from "../common/StatusBadge.jsx";
import ImageStorySection,{StoryImage} from "../story/ImageStorySection.jsx";import MapPanel from "../map/MapPanel.jsx";import MapInfoPanel from "../map/MapInfoPanel.jsx";
import QualityChart from "../charts/QualityChart.jsx";import EvidenceTimeline from "../timeline/EvidenceTimeline.jsx";import TraceXLogo from "../brand/TraceXLogo.jsx";
import useAsync from "../../hooks/useAsync.js";import {getShowcase} from "../../services/api.js";import {qualitySeries} from "../../utils/formatters.js";
const Wrap=({id,className="",children})=><section id={id} className={"py-24 md:py-36 "+className}><div className="max-w-7xl mx-auto px-6">{children}</div></section>;

export const Problem=()=><Wrap className="on-light">
  <ImageStorySection title={<>Food moves fast.<br/>Evidence gets left behind.</>} image={{kind:"collect",label:{title:"Intake and collection",lines:["Dairy example (demonstration data)","Quality 98%"]}}}>
    <p>Farm records, laboratory reports and transport logs sit in different places. When something goes wrong, it takes days to piece together what happened.</p>
    <p>TraceX keeps them on the batch itself, so the question changes from “who is at fault?” to “where did it change?”</p></ImageStorySection></Wrap>;

export function LiveMap(){
  const {data:batches,error}=useAsync(getShowcase),[id,setId]=useState(null);
  if(error)return <section id="map" className="on-light max-w-7xl mx-auto px-6 py-16"><p role="alert" className="text-muted">The live demonstration map is unavailable right now ({error.message}).</p></section>;
  if(!batches)return <section id="map" className="on-light min-h-[300px]"/>;
  const cur=id||batches[0]?.id;
  return <section id="map" className="on-light">
    <div className="max-w-7xl mx-auto px-6 pt-8 pb-10 flex flex-wrap items-end justify-between gap-6">
      <Reveal><h2 className="text-4xl md:text-6xl font-semibold tracking-tight text-deep leading-[1.02]">Every route, in view.</h2><p className="mt-4 text-muted max-w-md">Every product category and route, with quality and cold-chain readings carried along.</p></Reveal>
      <div className="flex gap-2 flex-wrap" role="tablist" aria-label="Select batch">{batches.map(x=><button key={x.id} role="tab" aria-selected={x.id===cur} onClick={()=>setId(x.id)} className={"text-sm rounded-full px-4 py-1.5 transition-colors "+(x.id===cur?"bg-deep text-off":"bg-sand text-deep hover:bg-cream")}>{x.id.split("-")[0]} {x.id.slice(-3)}</button>)}</div></div>
    <div className="relative h-[78vh] min-h-[500px]"><MapPanel batches={batches} selectedId={cur} onSelect={setId}/>
      <MapInfoPanel batch={batches.find(x=>x.id===cur)||batches[0]} className="absolute z-[500] left-4 bottom-4 md:left-8 md:top-8 md:bottom-auto"/>
      <div className="absolute z-[500] right-4 bottom-4 md:right-8 bg-off/95 rounded-xl px-4 py-3 text-xs text-muted space-y-1 hidden sm:block"><StatusBadge status="safe"/><StatusBadge status="review"/><StatusBadge status="suspicious"/></div></div></section>}

export function Quality(){const {data:bs}=useAsync(getShowcase);
  const pick=(bs||[]).map(b=>({b,s:qualitySeries(b)})).map(x=>({...x,drop:Math.max(0,...x.s.slice(1).map((p,i)=>x.s[i].q-p.q))})).sort((a,c)=>c.drop-a.drop)[0],i=pick?pick.s.findIndex((p,k)=>k&&pick.s[k-1].q-p.q===pick.drop):-1;
  return <Wrap id="quality" className="on-light">
  <div className="grid lg:grid-cols-[1fr_1.3fr] gap-16 items-center">
    <div><Reveal><h2 className="text-4xl md:text-5xl font-semibold tracking-tight text-deep leading-[1.05]">More than a dot on a map.</h2>
      <p className="mt-6 text-muted max-w-md">Every stage carries a quality reading. When one stage drifts from the one before it, TraceX marks the change and points to the stage that needs investigation.</p></Reveal>
      {pick&&pick.drop>0&&i>0&&<Reveal delay={.15} className="mt-10 border-l-2 border-susp pl-5"><p className="font-semibold text-susp">Quality deviation detected</p><p className="text-sm text-muted mt-1">{pick.b.id} · {pick.s[i].stage}, {pick.s[i-1].q}% to {pick.s[i].q}%. Stage requiring investigation.</p></Reveal>}
      <Reveal delay={.25} className="mt-10 max-w-sm"><StoryImage kind="lab" aspect="aspect-[16/9]" label={{title:"Laboratory testing",lines:["Reports attach to the batch"]}}/></Reveal></div>
    <Reveal>{pick?<><p className="text-sm text-muted mb-2">Quality score by stage · {pick.b.id} (demonstration data)</p><QualityChart data={pick.s} height={340}/></>:<p className="text-muted">Quality data is loading.</p>}</Reveal></div></Wrap>}

export const Investigation=()=>{
  return <Wrap id="investigate" className="bg-sand/60 on-light"><div className="grid lg:grid-cols-[1fr_1fr] gap-16">
    <div><Reveal><h2 className="text-4xl md:text-6xl font-semibold tracking-tight text-deep leading-[1.02]">Trace the change.<br/>Investigate the evidence.</h2>
      <p className="mt-6 text-muted max-w-md">TraceX never assigns blame automatically. It lays out what was recorded, when, and which stage needs a closer look.</p>
      <Link to="/investigations" className="group mt-8 inline-flex items-center gap-2 text-deep font-medium navlink">Open investigations (staff sign-in)<ArrowRight size={16} className="transition-transform group-hover:translate-x-1"/></Link></Reveal></div>
    <div className="lg:pt-6"><p className="text-xs text-muted mb-3">Illustrative example</p><EvidenceTimeline items={[{t:"10:42 AM",title:"Collection recorded",state:"done"},{t:"11:15 AM",title:"Quality test completed",state:"done"},{t:"12:20 PM",title:"Shipment dispatched",state:"done"},{t:"02:45 PM",title:"Quality deviation detected",state:"alert",note:"Possible contamination stage: Distribution"},{t:"04:10 PM",title:"Laboratory sample requested",state:"pending"}]}/></div></div></Wrap>};

export const ConsumerVerify=()=>{
  const steps=[[QrCode,"Scan batch QR","MILK-2026-001"],[MapPin,"Source","Nashik Collection Point"],[ShieldCheck,"Quality","Verified"],[Route,"Supply chain","6 recorded stages"]];
  return <Wrap id="verify" className="on-light"><div className="grid md:grid-cols-2 gap-16 items-center">
    <Reveal><h2 className="text-4xl md:text-5xl font-semibold tracking-tight text-deep leading-[1.05]">Trust you can check from the shelf.</h2>
      <p className="mt-6 text-muted max-w-md">Scan the pack and read the same journey the supply chain recorded. No account needed.</p>
      <div className="mt-8"><CTAButton to="/consumer/verify/MILK-2026-001" variant="deep">Try a verification</CTAButton></div></Reveal>
    <Reveal delay={.1} className="justify-self-center w-full max-w-[320px]"><div className="rounded-[2.5rem] bg-deep p-3 shadow-2xl"><div className="rounded-[2rem] bg-off p-6 pt-8">
      <ol className="space-y-0">{steps.map(([I,k,v],i)=><li key={k} className="relative pl-12 pb-7 last:pb-0"><span className="absolute left-0 top-0 w-9 h-9 rounded-full grid place-items-center bg-deep text-cream"><I size={16}/></span>
        {i<steps.length-1&&<span className="absolute left-[17px] top-9 bottom-0 w-px bg-deep/20"/>}<p className="text-xs text-muted">{k}</p><p className="font-medium text-deep">{v}</p></li>)}</ol></div></div></Reveal></div></Wrap>};

export const CTASection=()=><section className="bg-deep text-center py-32 md:py-44 px-6"><Reveal>
  <h2 className="text-cream font-semibold tracking-tight leading-[.98] text-[clamp(2.8rem,8vw,7rem)]">Trace every step.<br/>Know what changed.</h2>
  <p className="mt-8 text-off/70 text-lg">From source to shelf, TraceX makes the journey visible.</p>
  <div className="mt-10"><CTAButton to="/dashboard">Open the control tower</CTAButton></div></Reveal></section>;

export const Footer=()=><footer className="bg-deep-2 text-off/60 py-12"><div className="max-w-7xl mx-auto px-6 flex flex-wrap items-center justify-between gap-6 text-sm">
  <TraceXLogo/><nav className="flex flex-wrap gap-6" aria-label="Footer">{[["/dashboard","Control tower"],["/batches","Batches"],["/investigations","Investigations"],["/laboratory","Laboratory"],["/analytics","Analytics"],["/consumer","Consumer"]].map(([t,l])=><Link key={t} to={t} className="hover:text-cream transition-colors">{l}</Link>)}</nav>
  <p>© 2026 TraceX · Demonstration build with fictional data</p></div></footer>;
