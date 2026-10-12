import {useState,useEffect} from "react";import {NavLink,Outlet,Link,useLocation,useNavigate} from "react-router-dom";import {Menu,X,LogOut} from "lucide-react";import {motion,AnimatePresence} from "framer-motion";import TraceXLogo from "../brand/TraceXLogo.jsx";
import {useAuth} from "../../auth/AuthContext.jsx";import {useT} from "../../i18n/index.jsx";import useMeta from "../../hooks/useMeta.js";
const STAFF=[["/dashboard","Control tower"],["/supply-chain","Live supply chain"],["/batches","Batches"],["/investigations","Investigations"],["/laboratory","Laboratory"],["/analytics","Analytics"]];
const NAV={reviewer:STAFF,admin:[...STAFF,["/admin","Administration"]],lab:[["/laboratory","Laboratory"],["/batches","Batches"]],provider:[["/provider","Data provider"]]};
const ROLE={reviewer:"FSSAI reviewer",admin:"Administrator",lab:"Laboratory",provider:"Data provider"};
export default function Layout(){const [o,setO]=useState(false),{user,logout}=useAuth(),{lang,setLang,t}=useT(),{pathname}=useLocation(),nav=useNavigate(),{meta}=useMeta();
  useEffect(()=>setO(false),[pathname]);
  const consumer=pathname.startsWith("/consumer"),links=consumer?[["/consumer",t("nav.verify")],["/consumer/report",t("nav.report")],["/consumer/status",t("nav.status")],["/consumer/map",t("nav.map")]]:(NAV[user?.role]||[]);
  const cls=({isActive})=>"whitespace-nowrap rounded-full px-3 py-1.5 transition-colors duration-150 "+(isActive?"bg-white/12 text-cream":"text-off/70 hover:text-off hover:bg-white/6");
  const out=async()=>{await logout();nav("/")};
  return <div className="min-h-screen bg-off text-ink on-light">
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[2000] focus:bg-cream focus:text-deep focus:px-4 focus:py-2 focus:rounded-full">Skip to content</a>
    <header className="sticky top-0 z-[1000] bg-deep-grad shadow-[0_1px_0_#ffffff10,0_8px_24px_-12px_#20343766]"><div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-6">
      <TraceXLogo to="/"/>
      <nav aria-label="Main" className="hidden lg:flex gap-1 text-sm">{links.map(([p,l])=><NavLink key={p} to={p} end={p==="/consumer"} className={cls}>{l}</NavLink>)}</nav>
      <div className="ml-auto hidden sm:flex items-center gap-4 text-sm">
        {consumer&&<button onClick={()=>setLang(lang==="en"?"hi":"en")} className="text-off/70 hover:text-cream" lang={lang==="en"?"hi":"en"} aria-label={t("lang.label")}>{t("lang.switch")}</button>}
        {user?<>{!consumer&&<span className="hidden md:flex items-center gap-2 text-off/80"><span className="grid place-items-center w-7 h-7 rounded-full bg-cream/90 text-deep text-xs font-semibold" aria-hidden>{(user.name||"?").slice(0,1).toUpperCase()}</span><span className="leading-tight text-left"><span className="block text-[13px]">{user.name}</span><span className="block text-[11px] text-off/55">{ROLE[user.role]||user.role}</span></span></span>}
          {consumer&&<Link to={{reviewer:"/dashboard",admin:"/dashboard",lab:"/laboratory",provider:"/provider"}[user.role]} className="text-off/70 hover:text-cream">{t("nav.workspace")}</Link>}
          <button onClick={out} className="inline-flex items-center gap-1.5 text-off/70 hover:text-cream transition-colors"><LogOut size={15} aria-hidden/>Sign out</button></>:<Link to="/login" className="text-off/70 hover:text-cream">{t("nav.staff")}</Link>}</div>
      <button className="lg:hidden ml-auto sm:ml-0 text-off p-1" aria-label={o?"Close menu":"Open menu"} aria-expanded={o} aria-controls="mobile-nav" onClick={()=>setO(!o)}>{o?<X size={22}/>:<Menu size={22}/>}</button></div>
      <AnimatePresence initial={false}>{o&&<motion.nav id="mobile-nav" key="m" className="lg:hidden overflow-hidden" initial={{height:0,opacity:0}} animate={{height:"auto",opacity:1}} exit={{height:0,opacity:0}} transition={{duration:.2}} aria-label="Mobile">
        <div className="px-4 sm:px-6 pb-4 flex flex-col gap-1 text-sm">{links.map(([p,l])=><NavLink key={p} to={p} end={p==="/consumer"} className={cls}>{l}</NavLink>)}
          {consumer&&<button className="text-left text-off/70 px-3 py-1.5" onClick={()=>setLang(lang==="en"?"hi":"en")}>{t("lang.switch")}</button>}
          {user?<button className="text-left text-off/70 px-3 py-1.5" onClick={out}>Sign out{user.name?` (${user.name})`:""}</button>:<Link to="/login" className="text-off/70 px-3 py-1.5">{t("nav.staff")}</Link>}</div></motion.nav>}</AnimatePresence></header>
    {meta?.demoData&&<p className="bg-sand/70 text-xs text-ink/70 text-center px-4 py-1.5">Demonstration data: fictional records, not live government, laboratory or regulatory data.</p>}
    <main id="main" className="max-w-7xl mx-auto px-4 sm:px-6 py-8 md:py-10 min-w-0"><motion.div key={pathname} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{duration:.22,ease:[.22,.61,.36,1]}}><Outlet/></motion.div></main></div>}
