import {CheckCircle2,Eye,AlertTriangle,OctagonAlert} from "lucide-react";import {statusLabel} from "../../utils/status.js";
// Icon + text + tint: status never relies on colour alone.
const S={safe:[CheckCircle2,"text-[#3F6130] bg-safe/15"],review:[Eye,"text-[#8A5A12] bg-review/18"],suspicious:[AlertTriangle,"text-[#8E2F2B] bg-susp/15"],critical:[OctagonAlert,"text-crit bg-crit/12"]};
export default function StatusBadge({status,className=""}){const [I,c]=S[status]||S.review;
  return <span className={"inline-flex items-center gap-1.5 text-xs font-medium rounded-full pl-2 pr-2.5 py-1 whitespace-nowrap "+c+" "+className}><I size={13} aria-hidden/>{statusLabel[status]||status}</span>}
