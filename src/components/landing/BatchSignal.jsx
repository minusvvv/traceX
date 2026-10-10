// A small batch marker that glides to `progress` (0..1) along a vertical or horizontal track.
export default function BatchSignal({progress,axis="y",label}){
  const p=Math.max(0,Math.min(1,progress))*100,st=axis==="y"?{top:p+"%",left:15}:{left:p+"%",top:15};
  return <span aria-hidden className="absolute z-10 -translate-x-1/2 -translate-y-1/2 transition-all duration-[900ms] ease-in-out" style={st}>
    <span className="absolute inset-0 -m-3 rounded-full bg-cream/25 animate-ping"/><span className="relative block w-3.5 h-3.5 rounded-full bg-cream ring-4 ring-cream/30"/>
    {label&&<span className="absolute left-6 top-1/2 -translate-y-1/2 whitespace-nowrap text-xs text-cream/90 hidden sm:block">{label}</span>}</span>}
