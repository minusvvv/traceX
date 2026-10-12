// Map legend that mirrors exactly what MapPanel draws.
const Dot=({c,ring})=><span aria-hidden className="inline-block w-3 h-3 rounded-full border-2 border-off" style={{background:c,boxShadow:ring?"0 0 0 3px #DFD6AE":"0 0 0 1px #27424566"}}/>;
export default function MapLegend({hotspots=false,className=""}){
  return <div className={"bg-off/95 backdrop-blur rounded-xl px-3.5 py-2.5 text-xs text-ink shadow-md border border-line "+className} aria-label="Map legend" role="group">
    <ul className="space-y-1.5">
      <li className="flex items-center gap-2"><span aria-hidden className="inline-block w-5 h-0.5 bg-deep"/>Recorded route</li>
      <li className="flex items-center gap-2"><span aria-hidden className="inline-block w-5 border-t-2 border-dashed border-deep/60"/>Remaining route</li>
      <li className="flex items-center gap-2"><Dot c="#274245"/>Recorded stop</li>
      <li className="flex items-center gap-2"><Dot c="#C58B3A"/>Last recorded location</li>
      <li className="flex items-center gap-2"><Dot c="#DFD6AE"/>Destination</li>
      {hotspots&&<li className="flex items-center gap-2"><span aria-hidden className="inline-block w-3 h-3 rounded-full bg-susp/25 border border-deep"/>Complaint cluster</li>}</ul></div>}
