// Form primitives that reuse the existing look (pill inputs, deep buttons, line borders).
import {AlertCircle,CheckCircle2,Info,Loader2} from "lucide-react";import {motion} from "framer-motion";
export const inputCls="w-full border border-line rounded-2xl px-4 py-2.5 bg-white/60 outline-none focus:border-deep disabled:opacity-60";
export const pillCls="border border-line rounded-full px-5 py-2.5 bg-white/60 outline-none focus:border-deep";
export function Field({id,label,hint,error,optional,children,className=""}){
  return <div className={className}><label htmlFor={id} className="block text-sm font-medium text-deep">{label}{optional&&<span className="ml-2 text-xs font-normal text-ink/60">{optional}</span>}</label>
    {hint&&<p id={id+"-h"} className="text-xs text-ink/65 mt-0.5 mb-1.5">{hint}</p>}<div className={hint?"":"mt-1.5"}>{children}</div>
    {error&&<p id={id+"-e"} role="alert" className="text-sm text-crit mt-1.5">{error}</p>}</div>}
export const describe=(id,hint,error)=>[hint&&id+"-h",error&&id+"-e"].filter(Boolean).join(" ")||undefined;
const T={error:[AlertCircle,"border-susp text-crit"],ok:[CheckCircle2,"border-safe text-deep"],info:[Info,"border-review text-ink"]};
export function Notice({tone="info",title,children,className=""}){const [I,c]=T[tone];
  return <div role={tone==="error"?"alert":"status"} className={"border-l-2 pl-4 py-1 text-sm flex gap-3 "+c+" "+className}><I size={16} className="mt-0.5 shrink-0"/><div>{title&&<p className="font-semibold">{title}</p>}<div className="text-ink/80">{children}</div></div></div>}
const BV={deep:"bg-deep text-off hover:bg-deep-2 shadow-sm",ghost:"border border-deep/25 text-deep hover:bg-deep hover:text-off",cream:"bg-cream text-deep hover:bg-sand",danger:"bg-susp text-white hover:bg-[#9E4440] shadow-sm"};
export function Btn({variant="deep",className="",children,loading=false,disabled,...p}){
  // `loading` disables the button (no double submits) and shows a spinner; the label stays so the width doesn't jump.
  return <button {...p} disabled={disabled||loading} aria-busy={loading||undefined} className={"inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-[background-color,color,transform,box-shadow] duration-150 active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-deep "+BV[variant]+" "+className}>{loading&&<Loader2 size={15} className="animate-spin" aria-hidden/>}{children}</button>}
export const ErrorState=({error,onRetry})=><div role="alert" className="max-w-lg"><Notice tone="error" title="Could not load this page">{error?.message||"Unexpected error."}{onRetry&&<> <button onClick={onRetry} className="underline">Try again</button></>}</Notice></div>;
export const Empty=({children,icon:Icon,className=""})=><div className={"text-sm text-ink/65 py-6 text-center rounded-xl border border-dashed border-line "+className}>{Icon&&<Icon size={20} className="mx-auto mb-2 text-deep/35" aria-hidden/>}{children}</div>;
export const Select=({children,className="",...p})=><select {...p} className={"border border-line rounded-full px-4 py-2 bg-white/60 text-sm outline-none focus:border-deep "+className}>{children}</select>;

export const Tabs=({tabs,value,onChange,label,id="tabs"})=><div role="tablist" aria-label={label} className="flex gap-1 flex-wrap p-1 rounded-full bg-sand/70 w-fit max-w-full">{tabs.map(([k,l])=><button key={k} role="tab" id={id+"-"+k} aria-selected={value===k} aria-controls={id+"-panel"} onClick={()=>onChange(k)} className={"relative text-sm rounded-full px-4 py-1.5 transition-colors duration-150 "+(value===k?"text-off":"text-deep hover:bg-cream/70")}>{value===k&&<motion.span layoutId={id+"-pill"} className="absolute inset-0 rounded-full bg-deep" transition={{duration:.2}}/>}<span className="relative">{l}</span></button>)}</div>;
export const Chip=({active,children,...p})=><button {...p} aria-pressed={active} className={"text-sm rounded-full px-3.5 py-1.5 border transition-colors duration-150 "+(active?"bg-deep text-off border-deep":"border-line bg-white/50 text-deep hover:bg-cream/60")}>{children}</button>;
