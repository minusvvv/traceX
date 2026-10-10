import {Link} from "react-router-dom";
export function Mark({size=22,className=""}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
  <path d="M3 17c4 0 4-10 9-10s5 10 9 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><circle cx="3" cy="17" r="2" fill="currentColor"/><circle cx="21" cy="17" r="2" fill="currentColor"/><circle cx="12" cy="7" r="2.4" fill="#DFD6AE" stroke="currentColor" strokeWidth="1.4"/></svg>}
export default function TraceXLogo({tone="light",to="/"}){
  return <Link to={to} className={"inline-flex items-center gap-2 font-semibold tracking-tight text-lg "+(tone==="light"?"text-off":"text-deep")}>
    <Mark className={tone==="light"?"text-cream":"text-deep"}/><span>Trace<span className={tone==="light"?"text-cream":"text-deep/70"}>X</span></span></Link>}
