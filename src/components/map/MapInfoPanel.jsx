import {statusColor} from "../../utils/status.js";import StatusBadge from "../common/StatusBadge.jsx";
export default function MapInfoPanel({batch,className=""}){
  const F=({k,v})=><div><dt className="text-xs text-muted">{k}</dt><dd className="font-medium text-deep">{v}</dd></div>,n=batch.stages.length;
  return <div className={"bg-off/95 backdrop-blur text-ink rounded-2xl p-5 shadow-xl w-64 "+className}>
    <p className="text-xs text-muted">Batch · {batch.categoryLabel}</p><p className="text-lg font-semibold text-deep tracking-tight">{batch.id}</p>
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm"><F k="Current stage" v={batch.stages[batch.cur]}/><F k="Quality" v={batch.score!=null?batch.score+"%":"—"}/>{batch.temp!=null&&<F k="Temperature" v={batch.temp+" °C"}/>}<div><dt className="text-xs text-muted">Status</dt><dd><StatusBadge status={batch.status}/></dd></div></dl>
    <div className="mt-4 h-1 rounded-full bg-sand overflow-hidden"><div className="h-full rounded-full" style={{width:((batch.cur+1)/n*100)+"%",background:statusColor[batch.status]==="#6B8E5A"?"#274245":statusColor[batch.status]}}/></div>
    <p className="text-xs text-muted mt-1.5">Stage {batch.cur+1} of {n}</p></div>}
