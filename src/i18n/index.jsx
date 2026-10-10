import {createContext,useCallback,useContext,useState} from "react";
import en from "./en.js";import hi from "./hi.js";
// Extensible: add a dictionary file and register it here. Missing keys fall back to English.
export const LANGS={en:{name:"English",dict:en},hi:{name:"हिन्दी",dict:hi}};
const Ctx=createContext(null);
const stored=()=>{try{const v=localStorage.getItem("tracex.lang");return LANGS[v]?v:"en"}catch{return "en"}};
export function I18nProvider({children}){
  const [lang,set]=useState(stored);
  const setLang=useCallback(l=>{set(l);try{localStorage.setItem("tracex.lang",l)}catch{/* storage unavailable */}document.documentElement.lang=l},[]);
  const t=useCallback((k,v={})=>String(LANGS[lang].dict[k]??en[k]??k).replace(/\{(\w+)\}/g,(_,n)=>v[n]??""),[lang]);
  return <Ctx.Provider value={{lang,setLang,t}}>{children}</Ctx.Provider>}
export const useT=()=>useContext(Ctx);
