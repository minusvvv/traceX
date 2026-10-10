import {useCallback,useEffect,useRef,useState} from "react";
// Runs an async function; exposes data/error/loading and reload(). Errors are kept (never swallowed into mock data).
// Changing deps clears the data (so filters never show stale rows); reload() keeps the old data visible while refreshing.
export default function useAsync(fn,deps=[]){
  const [data,setData]=useState(undefined),[error,setError]=useState(null),[n,setN]=useState(0),fnRef=useRef(fn),last=useRef(null);fnRef.current=fn;
  useEffect(()=>{let live=true;const key=JSON.stringify(deps);if(last.current!==key){last.current=key;setData(undefined)}setError(null);
    fnRef.current().then(d=>live&&setData(d)).catch(e=>live&&setError(e));return()=>{live=false}},[...deps,n]);// eslint-disable-line
  const reload=useCallback(()=>setN(x=>x+1),[]);
  return {data,error,loading:data===undefined&&!error,reload};
}
