import {useReducedMotion} from "framer-motion";
// Shared look for every Recharts chart: quiet axes, tooltip in the page palette, no animation when the user prefers reduced motion.
export const axis={tickLine:false,axisLine:false,tick:{fill:"#718080",fontSize:12}};
export const tooltip={contentStyle:{background:"#FBF9F3",border:"1px solid #D9D3BF",borderRadius:10,boxShadow:"0 6px 20px #27424516",color:"#203437",fontSize:13},cursor:{fill:"#DFD6AE55"},labelStyle:{color:"#274245",fontWeight:600}};
export const grid={vertical:false,stroke:"#D9D3BF",strokeDasharray:"2 6"};
export const useChartAnim=()=>({isAnimationActive:!useReducedMotion(),animationDuration:600});
// A chart with a title, a one-line takeaway, an accessible description and a text alternative.
export function ChartCard({title,takeaway,label,height=240,empty,children,table}){
  return <figure className="panel p-5 md:p-6 m-0"><figcaption className="mb-4"><span className="block text-base font-semibold text-deep">{title}</span>{takeaway&&<span className="block text-sm text-muted mt-0.5">{takeaway}</span>}</figcaption>
    <div style={{height}} role={empty?undefined:"img"} aria-label={empty?undefined:label||title}>{empty?<div className="h-full grid place-items-center text-sm text-muted rounded-xl border border-dashed border-line">No data for these filters.</div>:children}</div>
    {table&&!empty&&<details className="mt-3 text-sm"><summary className="cursor-pointer text-muted hover:text-deep w-fit">View as table</summary><div className="overflow-x-auto mt-2"><table className="tbl"><thead><tr>{table.cols.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{table.rows.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j} className="!py-2">{v}</td>)}</tr>)}</tbody></table></div></details>}</figure>}
