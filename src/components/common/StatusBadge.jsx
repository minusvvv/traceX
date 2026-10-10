import {statusColor,statusLabel} from "../../utils/status.js";
export default function StatusBadge({status,className=""}){const c=statusColor[status]||statusColor.review;
  return <span className={"inline-flex items-center gap-2 text-sm font-medium "+className}><span className="w-2 h-2 rounded-full" style={{background:c}}/>{statusLabel[status]||status}</span>}
