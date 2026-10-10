import {useEffect,useState} from "react";import {Link} from "react-router-dom";import {Menu,X} from "lucide-react";
import TraceXLogo from "../brand/TraceXLogo.jsx";
const L=[["How it works","#how"],["Live map","#map"],["Quality","#quality"],["Investigation","#investigate"],["Verify","#verify"]];
export default function Nav(){const [s,setS]=useState(false),[o,setO]=useState(false);
  useEffect(()=>{const f=()=>setS(scrollY>24);f();addEventListener("scroll",f,{passive:true});return()=>removeEventListener("scroll",f)},[]);
  return <header className={"fixed inset-x-0 top-0 z-[1000] transition-all duration-300 "+(s||o?"bg-deep/90 backdrop-blur-md shadow-[0_1px_0_#DFD6AE22]":"")}>
    <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
      <TraceXLogo/>
      <nav aria-label="Primary" className="hidden md:flex gap-8 text-sm text-off/70">{L.map(([l,h])=><a key={l} href={h} className="navlink hover:text-cream transition-colors">{l}</a>)}</nav>
      <div className="flex items-center gap-4"><Link to="/login" className="hidden sm:block text-sm text-off/70 hover:text-cream transition-colors">Sign in</Link>
        <Link to="/dashboard" className="text-sm bg-cream text-deep rounded-full px-4 py-1.5 font-medium transition-colors hover:bg-off">Control tower</Link>
        <button className="md:hidden text-off" aria-label="Menu" aria-expanded={o} onClick={()=>setO(!o)}>{o?<X size={22}/>:<Menu size={22}/>}</button></div></div>
    {o&&<nav className="md:hidden px-6 pb-5 flex flex-col gap-3 text-off/80" aria-label="Mobile">{L.map(([l,h])=><a key={l} href={h} onClick={()=>setO(false)}>{l}</a>)}<Link to="/login">Sign in</Link></nav>}</header>}
