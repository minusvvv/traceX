import {useState} from "react";import {useLocation,useNavigate} from "react-router-dom";import TraceXLogo from "../components/brand/TraceXLogo.jsx";import CTAButton from "../components/common/CTAButton.jsx";import Scene from "../components/story/Scene.jsx";
import {HOME,useAuth} from "../auth/AuthContext.jsx";import useMeta from "../hooks/useMeta.js";
// Defined at module level on purpose: declaring it inside Login remounted the input on every keystroke and dropped focus.
const F=({id,label,type="text",ph,v,set,ac})=><div><label htmlFor={id} className="text-sm text-off/70">{label}</label><input id={id} type={type} value={v} onChange={e=>set(e.target.value)} autoComplete={ac} required placeholder={ph} className="mt-1 w-full bg-transparent border-b border-off/30 focus:border-cream outline-none py-2 text-off placeholder:text-off/30"/></div>;
export default function Login(){const nav=useNavigate(),loc=useLocation(),{login}=useAuth(),{meta}=useMeta(),[em,setEm]=useState(""),[pw,setPw]=useState(""),[err,setErr]=useState(null),[busy,setBusy]=useState(false);
  const submit=async e=>{e.preventDefault();setErr(null);setBusy(true);try{const u=await login(em.trim(),pw);nav(loc.state?.from||HOME[u.role]||"/",{replace:true})}catch(x){setErr(x.message)}finally{setBusy(false)}};
  return <div className="min-h-screen grid lg:grid-cols-2 bg-deep text-off">
    <div className="p-8 md:p-16 flex flex-col"><TraceXLogo/>
      <form onSubmit={submit} className="my-auto max-w-sm w-full space-y-6"><div><h1 className="text-4xl font-semibold tracking-tight">Sign in</h1><p className="text-off/60 mt-2">For laboratory staff, FSSAI reviewers, administrators and data providers. Consumers don't need an account.</p></div>
        <F id="em" label="Work email" type="email" ph="you@company.com" v={em} set={setEm} ac="username"/><F id="pw" label="Password" type="password" ph="••••••••" v={pw} set={setPw} ac="current-password"/>
        {err&&<p role="alert" className="text-sm text-[#F2B8B5]">{err}</p>}<CTAButton type="submit">{busy?"Signing in…":"Continue"}</CTAButton>
        {meta?.demoData&&<p className="text-xs text-off/55 leading-relaxed">Demonstration accounts (admin@, reviewer@, lab.nashik@, lab.pune@, provider@ tracex.demo) exist when the server was started with demo seeding. The shared password is the DEMO_PASSWORD in the server's .env.</p>}</form></div>
    <div className="hidden lg:block relative"><Scene kind="farm" className="absolute inset-0 w-full h-full opacity-90" label="Farmland at dawn"/></div></div>}
