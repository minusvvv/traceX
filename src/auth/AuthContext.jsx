import {createContext,useCallback,useContext,useEffect,useState} from "react";
import {getSession,login as apiLogin,logout as apiLogout} from "../services/api.js";
const Ctx=createContext(null);
export const useAuth=()=>useContext(Ctx);
export const HOME={reviewer:"/dashboard",admin:"/dashboard",lab:"/laboratory",provider:"/provider"};
export function AuthProvider({children}){
  const [user,setUser]=useState(null),[ready,setReady]=useState(false);
  useEffect(()=>{getSession().then(r=>setUser(r.user)).catch(()=>setUser(null)).finally(()=>setReady(true))},[]);
  useEffect(()=>{const f=()=>setUser(null);addEventListener("tracex:unauthorized",f);return()=>removeEventListener("tracex:unauthorized",f)},[]);
  const login=useCallback(async(e,p)=>{const r=await apiLogin(e,p);setUser(r.user);return r.user},[]);
  const logout=useCallback(async()=>{try{await apiLogout()}finally{setUser(null)}},[]);
  return <Ctx.Provider value={{user,ready,login,logout}}>{children}</Ctx.Provider>}
