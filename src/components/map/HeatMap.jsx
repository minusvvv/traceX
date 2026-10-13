import {useEffect} from "react";import {MapContainer,TileLayer,Circle,Popup,useMap} from "react-leaflet";
import {complaintIntensityColor,complaintSeverity,complaintSeverityLabel} from "../../utils/complaintIntensity.js";
// Reusable heat-map module. `variant="internal"` shows investigation detail; `variant="public"` shows only an
// aggregated report count (the server already coarsens and suppresses small areas; this component adds nothing precise).
function Fit({pts}){const map=useMap();useEffect(()=>{map.invalidateSize();if(pts.length)map.fitBounds(pts,{padding:[50,50],maxZoom:9})},[pts,map]);return null}
export default function HeatMap({hotspots=[],className="",variant="internal",labels}){
  const pts=hotspots.map(h=>[h.lat,h.lng]);
  return <MapContainer className={className} center={[19.0,73.4]} zoom={8} scrollWheelZoom={false}>
    <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
    <Fit pts={pts}/>
    {[...hotspots].sort((a,b)=>a.reports-b.reports).flatMap(h=>[1,.62,.3].map((k,i)=>{
      const color=complaintIntensityColor(h.reports),severity=complaintSeverity(h.reports);
      return <Circle key={h.region+h.lat+h.lng+i} center={[h.lat,h.lng]} radius={h.radius*k} pathOptions={{stroke:i===0,weight:1,color,fillColor:color,fillOpacity:.1+i*.07}}>
      {i===0&&<Popup>{variant==="public"?<>{labels?.reports?labels.reports(h.reports):<b>{h.reports} consumer reports</b>}</>
        :<><b>{h.region}</b><br/>Reports: {h.reports} · Affected batches: {h.batches}<br/>Lab confirmed: {h.lab} · Open investigations: {h.open}<br/>Stage requiring investigation: {h.stage}{h.distributionNodes!=null&&<><br/>Distribution nodes: {h.distributionNodes}</>}</>}
        {severity!=="safe"&&<><br/><b>{variant==="public"&&labels?.alert?labels.alert(complaintSeverityLabel[severity]):`${complaintSeverityLabel[severity]} complaint activity alert`}</b></>}</Popup>}</Circle>
    }))}
  </MapContainer>}
