import {useEffect,useState} from "react";import {motion} from "framer-motion";
import CTAButton from "../common/CTAButton.jsx";import BatchSignal from "./BatchSignal.jsx";import {JOURNEY} from "../../content/landing.js";
function HeroChain(){
  const N=JOURNEY.length,[a,setA]=useState(0);
  useEffect(()=>{const t=setInterval(()=>setA(v=>v>=N+1?0:v+1),1300);return()=>clearInterval(t)},[N]);
  const cur=Math.min(a,N-1);
  return <div className="relative h-[440px] ml-1" role="img" aria-label="Batch travelling from farm to consumer">
    <motion.div aria-hidden className="absolute left-[15px] top-0 bottom-0 w-px bg-cream/20 origin-top" initial={{scaleY:0}} animate={{scaleY:1}} transition={{duration:1.6,ease:"easeInOut"}}/>
    <div aria-hidden className="absolute left-[15px] top-0 w-px bg-cream transition-all duration-[900ms] ease-in-out" style={{height:(cur/(N-1))*100+"%"}}/>
    <BatchSignal progress={cur/(N-1)}/>
    <ol className="relative h-full flex flex-col justify-between">{JOURNEY.map((s,i)=>{const done=i<cur,on=i===cur;
      return <li key={s.key} className="flex items-center gap-5" style={{height:0}}>
        <span className={"w-[9px] ml-[11px] h-[9px] rounded-full transition-all duration-500 "+(on?"bg-cream scale-150":done?"bg-cream/90":"bg-deep ring-1 ring-cream/40")}/>
        <span className={"transition-all duration-500 "+(on?"text-cream text-lg":done?"text-off/80":"text-off/40")}>{s.name}<span className={"ml-3 text-sm transition-opacity duration-500 "+(on?"opacity-70":"opacity-0")}>{s.line}</span></span></li>})}</ol></div>}
export default function Hero(){
  return <section className="relative bg-deep text-off overflow-hidden pt-32 pb-24 min-h-[92vh] flex items-center">
    <div className="hairgrid absolute inset-0" aria-hidden/>
    <div className="relative max-w-7xl mx-auto px-6 w-full grid lg:grid-cols-[1.6fr_1fr] gap-16 items-center">
      <div>
        <motion.h1 initial={{opacity:0,y:22}} animate={{opacity:1,y:0}} transition={{duration:.6,ease:[.22,.61,.36,1]}} className="font-semibold leading-[.98] tracking-tight text-[clamp(2.6rem,6.4vw,6rem)]">Trace every step.<br/><span className="text-cream">Know what changed.</span></motion.h1>
        <motion.p initial={{opacity:0}} animate={{opacity:1}} transition={{delay:.35,duration:.6}} className="mt-8 max-w-md text-lg text-off/70 leading-relaxed">TraceX connects food supply-chain movement, quality testing and consumer reports into one traceable system.</motion.p>
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:.5,duration:.6}} className="mt-10 flex flex-wrap items-center gap-6">
          <CTAButton to="/consumer/verify/MILK-2026-001">Verify a batch</CTAButton><a href="#how" className="navlink text-sm text-off/80 hover:text-cream">See how it works</a></motion.div></div>
      <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:.3,duration:.8}}><HeroChain/></motion.div></div></section>}
