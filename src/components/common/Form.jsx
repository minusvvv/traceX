// Form primitives that reuse the existing look (pill inputs, deep buttons, line borders).
import {AlertCircle,CheckCircle2,Info} from "lucide-react";
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
const BV={deep:"bg-deep text-off hover:bg-deep-2",ghost:"border border-deep/25 text-deep hover:bg-deep hover:text-off",cream:"bg-cream text-deep hover:bg-sand"};
export function Btn({variant="deep",className="",children,...p}){
  return <button {...p} className={"inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none "+BV[variant]+" "+className}>{children}</button>}
export const ErrorState=({error,onRetry})=><div role="alert" className="max-w-lg"><Notice tone="error" title="Could not load this page">{error?.message||"Unexpected error."}{onRetry&&<> <button onClick={onRetry} className="underline">Try again</button></>}</Notice></div>;
export const Empty=({children})=><p className="text-sm text-ink/65 py-3">{children}</p>;
export const Tabs=({tabs,value,onChange,label})=><div role="tablist" aria-label={label} className="flex gap-2 flex-wrap">{tabs.map(([k,l])=><button key={k} role="tab" aria-selected={value===k} onClick={()=>onChange(k)} className={"text-sm rounded-full px-4 py-1.5 transition-colors "+(value===k?"bg-deep text-off":"bg-sand text-deep hover:bg-cream")}>{l}</button>)}</div>;
export const Select=({children,className="",...p})=><select {...p} className={"border border-line rounded-full px-4 py-2 bg-white/60 text-sm outline-none focus:border-deep "+className}>{children}</select>;
