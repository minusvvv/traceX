import {motion} from "framer-motion";import {Check,AlertTriangle,Circle} from "lucide-react";
const ICON={done:[Check,"bg-deep text-cream"],alert:[AlertTriangle,"bg-susp text-off"],pending:[Circle,"bg-transparent text-muted border border-muted/50"]};
// items: [{t,title,state:'done'|'alert'|'pending',note}]
export default function EvidenceTimeline({items,tone="light"}){
  const dark=tone==="dark";
  return <ol className="relative">
    <motion.span aria-hidden className={"absolute left-[15px] top-2 bottom-2 w-px origin-top "+(dark?"bg-cream/30":"bg-deep/20")} initial={{scaleY:0}} whileInView={{scaleY:1}} viewport={{once:true}} transition={{duration:1,ease:"easeOut"}}/>
    {items.map((it,i)=>{const [I,c]=ICON[it.state]||ICON.done;
      return <motion.li key={it.t+it.title} className="relative pl-14 pb-9 last:pb-0" initial={{opacity:0,x:-8}} whileInView={{opacity:1,x:0}} viewport={{once:true,margin:"-40px"}} transition={{delay:.15+i*.14,duration:.4}}>
        <span className={"absolute left-0 top-0 w-8 h-8 rounded-full grid place-items-center "+c}><I size={15} strokeWidth={2.4}/></span>
        <p className={"text-sm "+(dark?"text-off/60":"text-muted")}>{it.t}</p>
        <p className={"text-lg font-medium "+(it.state==="alert"?"text-susp":dark?"text-off":"text-deep")}>{it.title}</p>
        {it.note&&<p className={"text-sm mt-0.5 "+(dark?"text-off/65":"text-muted")}>{it.note}</p>}</motion.li>})}</ol>}
