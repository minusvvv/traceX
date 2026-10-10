export default function PageHeader({title,sub,children}){
  return <div className="flex flex-wrap items-end justify-between gap-4 pb-6 mb-8 border-b border-line">
    <div><h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-deep">{title}</h1>{sub&&<p className="text-muted mt-2 max-w-xl">{sub}</p>}</div>{children}</div>}
