import {Link} from "react-router-dom";import {ArrowRight} from "lucide-react";
const V={cream:"bg-cream text-deep hover:bg-off",deep:"bg-deep text-off hover:bg-deep-2",ghost:"border border-deep/25 text-deep hover:bg-deep hover:text-off"};
export default function CTAButton({to,children,variant="cream",className="",type,onClick}){
  const cls="group inline-flex items-center gap-2 rounded-full px-6 py-3 text-[15px] font-medium transition-all duration-300 hover:-translate-y-0.5 "+V[variant]+" "+className;
  const inner=<>{children}<ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1"/></>;
  return to?<Link to={to} className={cls}>{inner}</Link>:<button type={type} onClick={onClick} className={cls}>{inner}</button>}
