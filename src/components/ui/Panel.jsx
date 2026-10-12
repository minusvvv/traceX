// A titled section. `bare` drops the surface for sections that should sit directly on the page.
export default function Panel({title,desc,actions,icon:Icon,children,className="",bare=false,id,as:Tag="section"}){
  return <Tag id={id} aria-labelledby={title?id?id+"-t":undefined:undefined} className={(bare?"":"panel p-5 md:p-6 ")+"min-w-0 "+"scroll-mt-24 "+className}>
    {(title||actions)&&<div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="min-w-0"><h2 id={id?id+"-t":undefined} className="text-base font-semibold text-deep flex items-center gap-2">{Icon&&<Icon size={17} className="text-deep/60 shrink-0" aria-hidden/>}{title}</h2>{desc&&<p className="text-sm text-muted mt-1 max-w-2xl">{desc}</p>}</div>{actions}</div>}
    {children}</Tag>}
