import {useEffect,useMemo} from "react";
import {MapContainer,TileLayer,Polyline,Marker,Popup,Circle,useMap} from "react-leaflet";import L from "leaflet";
import {statusColor,statusLabel} from "../../utils/status.js";import {fmtDateTime} from "../../utils/formatters.js";
const TILES="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const dot=(c,pulse)=>L.divIcon({className:"",iconSize:[16,16],html:`<div class="mk ${pulse?"mk-pulse":""}" style="background:${c};color:${c}"></div>`});
const focusIcon=L.divIcon({className:"",iconSize:[22,22],html:'<div class="mk-focus"></div>'});
// Records that are lab tests happen at a lab, not on the route; records without coordinates cannot be drawn.
const onRoute=r=>r.kind!=="testing"&&r.lat!=null&&r.lng!=null;
export const routePoints=b=>{const p=b.route.filter(onRoute).map(r=>[r.lat,r.lng]);
  if(!b.destination||!p.length)return {done:p,rest:null};
  const d=[b.destination.lat,b.destination.lng],last=p[p.length-1];
  return {done:p,rest:(last[0]===d[0]&&last[1]===d[1])?null:[last,d]}};
function Fit({points,pad=60,resetKey}){const map=useMap();useEffect(()=>{map.invalidateSize();if(points.length)map.fitBounds(points,{padding:[pad,pad],maxZoom:9})},[points,map,pad,resetKey]);return null}
// "Reset view" control in the same style as the zoom buttons.
function ResetControl({points}){const map=useMap();
  useEffect(()=>{const C=L.Control.extend({onAdd(){const d=L.DomUtil.create("div","leaflet-bar"),a=L.DomUtil.create("a","",d);a.href="#";a.role="button";a.title="Reset view";a.setAttribute("aria-label","Reset map view");a.innerHTML="&#8962;";a.style.cssText="font-size:17px;line-height:30px;text-align:center;cursor:pointer";
    L.DomEvent.disableClickPropagation(d);L.DomEvent.on(a,"click",e=>{L.DomEvent.preventDefault(e);if(points.length)map.fitBounds(points,{padding:[60,60],maxZoom:9})});return d}});
    const c=new C({position:"topleft"});c.addTo(map);return()=>{c.remove()}},[map,points]);return null}
function Focus({pos}){const map=useMap();useEffect(()=>{if(pos)map.flyTo(pos,Math.max(map.getZoom(),9),{duration:.6})},[pos,map]);return null}
// `focusId` highlights one recorded stop (e.g. chosen from the timeline); clicking a stop calls onStopSelect.
export default function MapPanel({batches,selectedId,onSelect,hotspots=[],className="",focusId,onStopSelect}){
  const sel=batches.find(b=>b.id===selectedId)||batches[0];
  const {done,rest}=useMemo(()=>sel?routePoints(sel):{done:[],rest:null},[sel]);
  const fit=useMemo(()=>rest?[...done,...rest]:done,[done,rest]);
  const stops=useMemo(()=>sel?sel.route.filter(onRoute):[],[sel]);
  const focus=stops.find(r=>r.id===focusId);
  if(!sel)return <div className="h-full grid place-items-center text-sm text-muted">No batches to display.</div>;
  const c=statusColor[sel.status];
  return <MapContainer className={className} center={[19.2,73.5]} zoom={7} scrollWheelZoom={false} zoomControl>
    <TileLayer attribution="&copy; OpenStreetMap contributors" url={TILES}/>
    <Fit points={fit} resetKey={sel.id}/><ResetControl points={fit}/><Focus pos={focus&&[focus.lat,focus.lng]}/>
    {hotspots.map(h=><Circle key={h.region+h.lat} center={[h.lat,h.lng]} radius={h.radius} pathOptions={{color:"#274245",weight:1,fillColor:statusColor[h.severity],fillOpacity:.14}}/>)}
    {batches.filter(b=>b.id!==sel.id).map(b=>{const p=routePoints(b).done;return p.length<2?null:<Polyline key={b.id} positions={p} eventHandlers={{click:()=>onSelect?.(b.id)}} pathOptions={{color:"#274245",weight:2,opacity:.28}}/>})}
    {rest&&<Polyline positions={rest} pathOptions={{color:"#274245",weight:2,opacity:.55,dashArray:"4 8"}}/>}
    <Polyline positions={done} className="route-anim" pathOptions={{color:"#274245",weight:4,opacity:.9}}/>
    {stops.map((r,i,arr)=>{const cur=i===arr.length-1,f=r.id===focusId;return <Marker key={r.id??r.stage+i} position={[r.lat,r.lng]} icon={f?focusIcon:dot(cur?c:"#274245",cur&&sel.status!=="safe")} zIndexOffset={f?900:cur?500:0} eventHandlers={{click:()=>onStopSelect?.(r.id)}}>
      <Popup><b>{r.stage}</b><br/>{r.place}<br/>{fmtDateTime(r.time)}{cur&&<><br/><i>Last recorded location · {statusLabel[sel.status]}</i></>}</Popup></Marker>})}
    {sel.destination&&<Marker position={[sel.destination.lat,sel.destination.lng]} icon={dot("#DFD6AE")}><Popup>Destination<br/><b>{sel.destination.place}</b></Popup></Marker>}
  </MapContainer>}
