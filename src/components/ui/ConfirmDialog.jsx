import {useEffect,useRef} from "react";import {AlertTriangle} from "lucide-react";import {Btn} from "../common/Form.jsx";
// Native <dialog>: focus is trapped, Esc closes, and the backdrop blocks the page behind it.
export default function ConfirmDialog({open,title,children,confirmLabel="Confirm",danger=false,busy=false,onConfirm,onCancel}){
  const ref=useRef();
  useEffect(()=>{const d=ref.current;if(!d)return;if(open&&!d.open)d.showModal();if(!open&&d.open)d.close()},[open]);
  return <dialog ref={ref} className="dlg" onCancel={e=>{e.preventDefault();if(!busy)onCancel()}} onClick={e=>{if(e.target===ref.current&&!busy)onCancel()}} aria-labelledby="cd-t">
    <div className="p-6"><div className="flex gap-3"><span className={"mt-0.5 grid place-items-center w-9 h-9 rounded-full shrink-0 "+(danger?"bg-susp/15 text-susp":"bg-sand text-deep")}><AlertTriangle size={18} aria-hidden/></span>
      <div><h2 id="cd-t" className="text-lg font-semibold text-deep">{title}</h2><div className="text-sm text-ink/80 mt-1.5">{children}</div></div></div>
      <div className="mt-6 flex justify-end gap-3"><Btn variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Btn><Btn variant={danger?"danger":"deep"} onClick={onConfirm} loading={busy}>{confirmLabel}</Btn></div></div></dialog>}
