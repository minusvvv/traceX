import {useState} from "react";import {NavLink,Outlet,Link,useLocation,useNavigate} from "react-router-dom";import {Menu,X} from "lucide-react";import TraceXLogo from "../brand/TraceXLogo.jsx";
import {useAuth} from "../../auth/AuthContext.jsx";import {useT,LANGS} from "../../i18n/index.jsx";import useMeta from "../../hooks/useMeta.js";
const STAFF=[["/dashboard","Control tower"],["/supply-chain","Live supply chain"],["/batches","Batches"],["/investigations","Investigations"],["/laboratory","Laboratory"],["/analytics","Analytics"]];
const NAV={reviewer:STAFF,admin:[...STAFF,["/admin","Administration"]],lab:[["/laboratory","Laboratory"],["/batches","Batches"]],provider:[["/provider","Data provider"]]};
export default function Layout(){const [o,setO]=useState(false),{user,logout}=useAuth(),{lang,setLang,t}=useT(),{pathname}=useLocation(),nav=useNavigate(),{meta}=useMeta();
  const consumer=pathname.startsWith("/consumer"),links=consumer?[["/consumer",t("nav.verify")],["/consumer/report",t("nav.report")],["/consumer/status",t("nav.status")],["/consumer/map",t("nav.map")]]:(NAV[user?.role]||[]);
  const cls=({isActive})=>"navlink whitespace-nowrap transition-colors "+(isActive?"text-cream":"text-off/70 hover:text-off");
  const out=async()=>{await logout();nav("/login")};
  return <div className="min-h-screen bg-off text-ink on-light">
    <header className="sticky top-0 z-[1000] bg-deep"><div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-10">
      <TraceXLogo to="/"/>
      <nav aria-label="Main" className="hidden lg:flex gap-6 text-sm">{links.map(([p,l])=><NavLink key={p} to={p} end={p==="/consumer"} className={cls}>{l}</NavLink>)}</nav>
      <div className="ml-auto hidden sm:flex items-center gap-5 text-sm">
        {consumer&&<button onClick={()=>setLang(lang==="en"?"hi":"en")} className="text-off/70 hover:text-cream" lang={lang==="en"?"hi":"en"} aria-label={t("lang.label")}>{t("lang.switch")}</button>}
        {user?<><span className="text-off/50 hidden xl:inline">{user.name}</span>{consumer&&<Link to={{reviewer:"/dashboard",admin:"/dashboard",lab:"/laboratory",provider:"/provider"}[user.role]} className="text-off/70 hover:text-cream">{t("nav.workspace")}</Link>}<button onClick={out} className="text-off/70 hover:text-cream">Sign out</button></>:<Link to="/login" className="text-off/70 hover:text-cream">{t("nav.staff")}</Link>}</div>
      <button className="lg:hidden ml-auto sm:ml-0 text-off" aria-label="Menu" aria-expanded={o} onClick={()=>setO(!o)}>{o?<X size={22}/>:<Menu size={22}/>}</button></div>
      {o&&<nav className="lg:hidden px-6 pb-4 flex flex-col gap-3 text-sm" aria-label="Mobile">{links.map(([p,l])=><NavLink key={p} to={p} end={p==="/consumer"} onClick={()=>setO(false)} className={cls}>{l}</NavLink>)}
        {consumer&&<button className="text-left text-off/70" onClick={()=>setLang(lang==="en"?"hi":"en")}>{t("lang.switch")}</button>}
        {user?<button className="text-left text-off/70" onClick={out}>Sign out</button>:<Link to="/login" className="text-off/70">{t("nav.staff")}</Link>}</nav>}</header>
    {meta?.demoData&&<p className="bg-sand/70 text-xs text-ink/70 text-center px-6 py-1.5">Demonstration data: fictional records, not live government, laboratory or regulatory data.</p>}
    <main className="max-w-7xl mx-auto px-6 py-10"><Outlet/></main></div>}
