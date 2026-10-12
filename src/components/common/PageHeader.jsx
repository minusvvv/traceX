export default function PageHeader({title,sub,eyebrow,children}){
  return <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 mb-8">
    <div className="min-w-0">{eyebrow&&<p className="text-xs font-medium tracking-[.18em] uppercase text-deep/55 mb-2">{eyebrow}</p>}
      <h1 className="text-3xl md:text-[2.1rem] leading-tight font-semibold tracking-tight text-deep">{title}</h1>{sub&&<p className="text-muted mt-2 max-w-2xl">{sub}</p>}</div>{children&&<div className="flex items-center gap-3 flex-wrap">{children}</div>}</div>}
