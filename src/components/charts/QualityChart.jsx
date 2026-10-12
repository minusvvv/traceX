import {useChartAnim} from "./ChartKit.jsx";import {ResponsiveContainer,ComposedChart,Area,Line,XAxis,YAxis,Tooltip,CartesianGrid,ReferenceDot} from "recharts";
// data: [{stage,q}]. Anomaly = first point that drops 5+ points below the previous one.
export const findDeviation=d=>{for(let i=1;i<d.length;i++)if(d[i-1].q-d[i].q>=5)return i;return -1};
export default function QualityChart({data,height=280,domain=[80,100]}){
  const dev=findDeviation(data),anim=useChartAnim();
  return <div style={{height}} role="img" aria-label="Quality score by supply-chain stage"><ResponsiveContainer>
    <ComposedChart data={data} margin={{top:24,right:24,left:4,bottom:0}}>
      <defs><linearGradient id="qa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#DFD6AE" stopOpacity=".7"/><stop offset="1" stopColor="#DFD6AE" stopOpacity="0"/></linearGradient></defs>
      <CartesianGrid vertical={false} stroke="#D9D3BF" strokeDasharray="2 6"/>
      <XAxis dataKey="stage" tickLine={false} axisLine={false} tick={{fill:"#718080",fontSize:12}}/>
      <YAxis domain={domain} tickLine={false} axisLine={false} tick={{fill:"#718080",fontSize:12}} unit="%" width={44}/>
      <Tooltip cursor={{stroke:"#274245",strokeOpacity:.2}} formatter={v=>[v+"%","Quality"]} contentStyle={{background:"#F5F2E9",border:"1px solid #D9D3BF",borderRadius:10,boxShadow:"none",color:"#203437"}}/>
      <Area type="monotone" dataKey="q" stroke="none" fill="url(#qa)" {...anim}/>
      <Line type="monotone" dataKey="q" stroke="#274245" strokeWidth={2.5} dot={{r:4,fill:"#F5F2E9",stroke:"#274245",strokeWidth:2}} activeDot={{r:6,fill:"#DFD6AE",stroke:"#274245",strokeWidth:2}} {...anim}/>
      {dev>0&&<ReferenceDot x={data[dev].stage} y={data[dev].q} r={7} fill="#B85450" stroke="#F5F2E9" strokeWidth={2} ifOverflow="extendDomain"/>}
    </ComposedChart></ResponsiveContainer></div>}
