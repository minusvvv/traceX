// Date helpers: the API returns ISO timestamps; the UI keeps its existing "10 Sep 05:40" look.
const pad=n=>String(n).padStart(2,"0"),MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const fmtDate=iso=>{if(!iso)return "—";const d=new Date(iso);return isNaN(d)?String(iso):`${d.getDate()} ${MON[d.getMonth()]}`};
export const fmtDateTime=iso=>{if(!iso)return "—";const d=new Date(iso);return isNaN(d)?String(iso):`${d.getDate()} ${MON[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`};
export const fmtDay=iso=>{if(!iso)return "—";const d=new Date(iso.length<=10?iso+"T00:00:00":iso);return isNaN(d)?String(iso):`${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`};
// Quality score per recorded stage, for charts. Labels repeat when a stage has several records, so they are numbered.
export const qualitySeries=b=>{const seen={};return b.route.filter(r=>r.qs!=null).map(r=>{seen[r.stage]=(seen[r.stage]||0)+1;return {stage:seen[r.stage]>1?`${r.stage} ${seen[r.stage]}`:r.stage,q:r.qs}})};
export const stageState=(batch,i)=>i<batch.cur?"done":i===batch.cur?"current":"pending";
// Display a reading with its unit, using the category's test definitions.
export const fmtReading=(t,v)=>v==null?"—":t.type==="number"?`${v}${t.unit?(t.unit==="%"?"%":" "+t.unit):""}`:String(v);
// "12 min ago" style label for data-freshness hints; falls back to the date for older items.
export const fmtAgo=iso=>{if(!iso)return "";const d=new Date(iso),s=(Date.now()-d)/1000;if(isNaN(d)||s<0)return "";if(s<60)return "just now";if(s<3600)return `${Math.floor(s/60)} min ago`;if(s<86400)return `${Math.floor(s/3600)} h ago`;if(s<86400*7)return `${Math.floor(s/86400)} d ago`;return ""};
export const fmtTime=d=>`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
