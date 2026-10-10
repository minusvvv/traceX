import {useEffect,useRef,useState} from "react";import {motion,useScroll,useSpring,useInView} from "framer-motion";
import {JOURNEY} from "../../content/landing.js";import {StoryImage} from "../story/ImageStorySection.jsx";
function Row({s,i,active,onActive}){
  const ref=useRef(),inView=useInView(ref,{margin:"-45% 0px -45% 0px"});
  useEffect(()=>{if(inView)onActive(i)},[inView]);// eslint-disable-line
  const on=active===i;
  return <li ref={ref} className="relative grid md:grid-cols-[1fr_1fr] gap-8 md:gap-16 py-14 md:py-24 pl-12 md:pl-20 items-center">
    <span className={"absolute left-[7px] md:left-[15px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full transition-all duration-500 "+(on?"bg-cream ring-8 ring-cream/20 scale-125":i<active?"bg-cream":"bg-deep ring-1 ring-cream/40")}/>
    <div className={"transition-opacity duration-500 "+(on?"opacity-100":"opacity-40")}>
      <p className="text-cream/80 text-sm">{String(i+1).padStart(2,"0")} · {s.line}</p>
      <h3 className="mt-2 text-4xl md:text-6xl font-semibold tracking-tight text-off">{s.name}</h3>
      <p className="mt-5 text-off/70 max-w-sm leading-relaxed">{s.text}</p></div>
    <div className={"transition-all duration-700 "+(on?"opacity-100 translate-y-0":"opacity-0 md:opacity-30 translate-y-3")}>
      <StoryImage kind={s.scene} aspect="aspect-[16/10]" label={{title:s.meta[0],lines:[s.meta[1]]}}/></div></li>}
export default function SupplyChainJourney(){
  const ref=useRef(),[active,setActive]=useState(0);
  const {scrollYProgress}=useScroll({target:ref,offset:["start 60%","end 60%"]}),line=useSpring(scrollYProgress,{stiffness:120,damping:30});
  return <section id="how" className="bg-deep text-off py-24 md:py-32"><div className="max-w-7xl mx-auto px-6">
    <h2 className="text-4xl md:text-6xl font-semibold tracking-tight max-w-2xl leading-[1.02]">One batch. <span className="text-cream">Seven recorded steps.</span></h2>
    <p className="mt-5 text-off/70 max-w-md">Scroll to follow a batch from the farm gate to the consumer's phone.</p>
    <ol ref={ref} className="relative mt-16">
      <span aria-hidden className="absolute left-[13px] md:left-[21px] top-0 bottom-0 w-px bg-cream/15"/>
      <motion.span aria-hidden className="absolute left-[13px] md:left-[21px] top-0 bottom-0 w-px bg-cream origin-top" style={{scaleY:line}}/>
      {JOURNEY.map((s,i)=><Row key={s.key} s={s} i={i} active={active} onActive={setActive}/>)}</ol></div></section>}
