import {useEffect,useMemo,useState} from "react";
import {MapContainer,TileLayer,Polyline,Marker,Popup,Circle,useMap} from "react-leaflet";import L from "leaflet";
import {statusColor,statusLabel} from "../../utils/status.js";import {fmtDateTime} from "../../utils/formatters.js";
const TILES="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const dot=(c,pulse)=>L.divIcon({className:"",iconSize:[16,16],html:`<div class="mk ${pulse?"mk-pulse":""}" style="background:${c};color:${c}"></div>`});
const batchIcon=L.divIcon({className:"",iconSize:[22,22],html:'<div class="mk-batch"></div>'});
// Records that are lab tests happen at a lab, not on the route; records without coordinates cannot be drawn.
const onRoute=r=>r.kind!=="testing"&&r.lat!=null&&r.lng!=null;
export const routePoints=b=>{const p=b.route.filter(onRoute).map(r=>[r.lat,r.lng]);
  if(!b.destination||!p.length)return {done:p,rest:null};
  const d=[b.destination.lat,b.destination.lng],last=p[p.length-1];
  return {done:p,rest:(last[0]===d[0]&&last[1]===d[1])?null:[last,d]}};
function Fit({points,pad=60}){const map=useMap();useEffect(()=>{map.invalidateSize();if(points.length)map.fitBounds(points,{padding:[pad,pad],maxZoom:9})},[points,map,pad]);return null}
// Moves a marker back and forth along the travelled path.
function useAlong(pts){const [pos,setPos]=useState(pts[0]);
  useEffect(()=>{setPos(pts[0]);if(pts.length<2)return;
    const seg=[];let tot=0;for(let i=1;i<pts.length;i++){const d=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);seg.push(d);tot+=d}
    let raf;const t0=performance.now(),D=9000;
    const tick=t=>{let f=((t-t0)%D)/D;f=f<.85?f/.85:1;let d=f*tot,i=0;while(i<seg.length-1&&d>seg[i]){d-=seg[i];i++}
      const k=seg[i]?Math.min(d/seg[i],1):1;setPos([pts[i][0]+(pts[i+1][0]-pts[i][0])*k,pts[i][1]+(pts[i+1][1]-pts[i][1])*k]);raf=requestAnimationFrame(tick)};
    raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf)},[pts]);
  return pos}
function Moving({pts,batch}){const pos=useAlong(pts);if(!pos)return null;return <Marker position={pos} icon={batchIcon} zIndexOffset={1000}><Popup><b>{batch.id}</b><br/>{statusLabel[batch.status]}</Popup></Marker>}
export default function MapPanel({batches,selectedId,onSelect,hotspots=[],className=""}){
  const sel=batches.find(b=>b.id===selectedId)||batches[0];
  const {done,rest}=useMemo(()=>sel?routePoints(sel):{done:[],rest:null},[sel]);
  const fit=useMemo(()=>rest?[...done,...rest]:done,[done,rest]);
  if(!sel)return <div className="h-full grid place-items-center text-sm text-muted">No batches to display.</div>;
  const c=statusColor[sel.status];
  return <MapContainer className={className} center={[19.2,73.5]} zoom={7} scrollWheelZoom={false} zoomControl>
    <TileLayer attribution="&copy; OpenStreetMap contributors" url={TILES}/>
    <Fit points={fit}/>
    {hotspots.map(h=><Circle key={h.region+h.lat} center={[h.lat,h.lng]} radius={h.radius} pathOptions={{color:"#274245",weight:1,fillColor:statusColor[h.severity],fillOpacity:.14}}/>)}
    {batches.filter(b=>b.id!==sel.id).map(b=>{const p=routePoints(b).done;return p.length<2?null:<Polyline key={b.id} positions={p} eventHandlers={{click:()=>onSelect?.(b.id)}} pathOptions={{color:"#274245",weight:2,opacity:.28}}/>})}
    {rest&&<Polyline positions={rest} pathOptions={{color:"#274245",weight:2,opacity:.55,dashArray:"4 8"}}/>}
    <Polyline positions={done} className="route-anim" pathOptions={{color:"#274245",weight:4,opacity:.9}}/>
    {sel.route.filter(onRoute).map((r,i,arr)=>{const cur=i===arr.length-1;return <Marker key={r.id??r.stage+i} position={[r.lat,r.lng]} icon={dot(cur?c:"#274245",cur&&sel.status!=="safe")}><Popup><b>{r.stage}</b><br/>{r.place}<br/>{fmtDateTime(r.time)}</Popup></Marker>})}
    {sel.destination&&<Marker position={[sel.destination.lat,sel.destination.lng]} icon={dot("#DFD6AE")}><Popup>Destination<br/><b>{sel.destination.place}</b></Popup></Marker>}
    <Moving pts={done} batch={sel}/>
  </MapContainer>}
