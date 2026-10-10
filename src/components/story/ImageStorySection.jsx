import {motion} from "framer-motion";import Scene from "./Scene.jsx";
// Photograph (or scene) with a small TraceX data label. Pass `src` for real photography.
export function DataLabel({title,lines,className=""}){
  return <div className={"bg-off/92 backdrop-blur text-ink rounded-xl px-4 py-3 text-sm shadow-lg "+className}>
    <p className="font-semibold text-deep">{title}</p>{lines.map(l=><p key={l} className="text-muted">{l}</p>)}</div>}
export function StoryImage({kind,src,label,className="",aspect="aspect-[4/5]"}){
  return <motion.figure initial={{clipPath:"inset(0 0 100% 0)"}} whileInView={{clipPath:"inset(0 0 0% 0)"}} viewport={{once:true,margin:"-80px"}} transition={{duration:.8,ease:[.22,.61,.36,1]}}
    className={"group relative overflow-hidden rounded-3xl bg-sand "+aspect+" "+className}>
    {src?<img src={src} alt={label?.title||""} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"/>
      :<Scene kind={kind} label={label?.title} className="w-full h-full transition-transform duration-700 group-hover:scale-[1.03]"/>}
    {label&&<DataLabel {...label} className="absolute left-4 bottom-4"/>}</motion.figure>}
export default function ImageStorySection({title,children,image,reverse=false,tone="light"}){
  return <div className={"grid md:grid-cols-2 gap-10 md:gap-20 items-center "+(reverse?"md:[&>*:first-child]:order-2":"")}>
    <div><h2 className={"text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05] "+(tone==="dark"?"text-off":"text-deep")}>{title}</h2><div className={"mt-6 space-y-4 max-w-md "+(tone==="dark"?"text-off/75":"text-muted")}>{children}</div></div>
    <StoryImage {...image}/></div>}
