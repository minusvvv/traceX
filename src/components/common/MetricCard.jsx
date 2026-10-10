// Deliberately light: a number with a label, no box.
export default function MetricCard({label,value,hint,tone="default"}){
  return <div><p className={"text-3xl font-semibold tabular-nums tracking-tight "+(tone==="alert"?"text-susp":"")}>{value}</p>
    <p className="text-sm text-muted mt-1">{label}</p>{hint&&<p className="text-xs text-muted/80 mt-0.5">{hint}</p>}</div>}
