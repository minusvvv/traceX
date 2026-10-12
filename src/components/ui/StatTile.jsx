import {motion} from "framer-motion";
// Compact summary tile. `tone="attention"` adds a quiet amber edge (not a wall of red) when the number needs a look.
export default function StatTile({label,value,hint,icon:Icon,tone="default"}){
  const edge=tone==="attention"?"before:bg-review":"before:bg-deep/70";
  return <div className={"panel relative overflow-hidden p-4 md:p-5 before:absolute before:left-0 before:top-4 before:bottom-4 before:w-[3px] before:rounded-full "+edge}>
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium tracking-wide uppercase text-muted">{label}</p>{Icon&&<Icon size={16} className="text-deep/45" aria-hidden/>}</div>
    <motion.p key={String(value)} initial={{opacity:.35,y:3}} animate={{opacity:1,y:0}} transition={{duration:.2}} className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-deep">{value}</motion.p>
    {hint&&<p className="text-xs text-muted mt-1">{hint}</p>}</div>}
