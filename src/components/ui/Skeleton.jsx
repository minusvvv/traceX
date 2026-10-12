// Page-shaped skeletons keep the layout stable while data loads (no jump when content arrives).
export const Skeleton=({className=""})=><div aria-hidden className={"skeleton "+className}/>;
export default function PageSkeleton({variant="list"}){
  return <div role="status" aria-live="polite" className="space-y-6"><span className="sr-only">Loading…</span>
    <div className="space-y-2"><Skeleton className="h-9 w-64"/><Skeleton className="h-4 w-96 max-w-full"/></div>
    {variant==="map"?<div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6"><Skeleton className="h-[440px] lg:h-[560px] !rounded-2xl"/><div className="space-y-3">{[...Array(6)].map((_,i)=><Skeleton key={i} className="h-12"/>)}</div></div>
    :variant==="cards"?<><div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[...Array(4)].map((_,i)=><Skeleton key={i} className="h-24 !rounded-2xl"/>)}</div><Skeleton className="h-72 !rounded-2xl"/></>
    :<div className="space-y-2">{[...Array(7)].map((_,i)=><Skeleton key={i} className="h-14"/>)}</div>}</div>}
