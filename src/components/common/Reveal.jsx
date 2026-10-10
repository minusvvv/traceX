import {motion} from "framer-motion";
export default function Reveal({children,className="",delay=0,y=18}){
  return <motion.div className={className} initial={{opacity:0,y}} whileInView={{opacity:1,y:0}} viewport={{once:true,margin:"-60px"}} transition={{duration:.5,delay,ease:[.22,.61,.36,1]}}>{children}</motion.div>}
