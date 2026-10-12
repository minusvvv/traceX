import {motion} from "framer-motion";
// Gentle entrance for page content. Never blocks navigation (no exit animation); reduced motion is handled by MotionConfig.
export default function Page({children,className=""}){
  return <motion.div className={className} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{duration:.22,ease:[.22,.61,.36,1]}}>{children}</motion.div>}
