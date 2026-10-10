import {useState} from "react";import {Link,useNavigate} from "react-router-dom";import {Mark} from "../components/brand/TraceXLogo.jsx";import CTAButton from "../components/common/CTAButton.jsx";import {useT} from "../i18n/index.jsx";
export default function Consumer(){const nav=useNavigate(),{t}=useT(),[q,setQ]=useState("");
  return <div className="max-w-xl mx-auto text-center py-10 md:py-20"><Mark size={40} className="mx-auto text-deep"/>
    <h1 className="mt-6 text-4xl md:text-5xl font-semibold tracking-tight text-deep">{t("verify.title")}</h1><p className="text-muted mt-4">{t("verify.sub")}</p>
    <form onSubmit={e=>{e.preventDefault();q.trim()&&nav("/consumer/verify/"+encodeURIComponent(q.trim()))}} className="mt-8 flex gap-2"><label className="sr-only" htmlFor="c">{t("verify.label")}</label>
      <input id="c" value={q} onChange={e=>setQ(e.target.value)} placeholder="e.g. OIL-2026-001" className="flex-1 min-w-0 border border-line rounded-full px-5 py-3 bg-white/60 outline-none focus:border-deep"/><CTAButton type="submit" variant="deep">{t("verify.button")}</CTAButton></form>
    <p className="mt-6 text-sm text-muted">{t("verify.hint")}</p>
    <p className="mt-4 flex justify-center gap-6 text-sm"><Link className="navlink" to="/consumer/report">{t("nav.report")}</Link><Link className="navlink" to="/consumer/status">{t("nav.status")}</Link><Link className="navlink" to="/consumer/map">{t("nav.map")}</Link></p></div>}
