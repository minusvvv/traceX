import {useState} from "react";import {Link} from "react-router-dom";import {motion} from "framer-motion";import {ClipboardList,FileUp,Microscope,CheckCircle2,AlertTriangle,CircleHelp,Clock,Lock,FlaskConical,FileCheck2,Truck,ArrowRight,Check,Package} from "lucide-react";
import useAsync from "../hooks/useAsync.js";import useMeta from "../hooks/useMeta.js";import {useAuth} from "../auth/AuthContext.jsx";
import {getLaboratoryReports,getSampleRequests,getSampleRequest,getBatches,attachmentUrl,getLabCollections,patchCollectionStage} from "../services/api.js";
import LoadingState from "../components/common/LoadingState.jsx";import PageHeader from "../components/common/PageHeader.jsx";import LabReportForm from "../components/lab/LabReportForm.jsx";import {Btn,ErrorState,Empty,Notice} from "../components/common/Form.jsx";import {fmtDate} from "../utils/formatters.js";
import Page from "../components/ui/Page.jsx";import Panel from "../components/ui/Panel.jsx";import StatTile from "../components/ui/StatTile.jsx";

const OUT={confirmed:[AlertTriangle,"text-[#8E2F2B] bg-susp/12"],not_confirmed:[CheckCircle2,"text-[#3F6130] bg-safe/15"],inconclusive:[CircleHelp,"text-[#8A5A12] bg-review/15"]};
const Outcome=({r})=>{const [I,c]=OUT[r.outcome]||OUT.inconclusive;return <span className={"inline-flex items-center gap-1.5 text-xs font-medium rounded-full pl-2 pr-2.5 py-1 "+c}><I size={13} aria-hidden/>{r.status}</span>};
const reveal={initial:{opacity:0,y:6},animate:{opacity:1,y:0},transition:{duration:.2}};

const ALL_STAGES = [
  { key: "collection_scheduled", label: "Collection Scheduled" },
  { key: "collected", label: "Sample Collected" },
  { key: "in_transit", label: "In Transit" },
  { key: "at_lab", label: "At Laboratory" },
  { key: "testing", label: "Testing in Progress" },
  { key: "completed", label: "Completed" }
];

const STAGE_BADGE = {
  collection_scheduled: "bg-blue-100 text-blue-800",
  collected: "bg-indigo-100 text-indigo-800",
  in_transit: "bg-amber-100 text-amber-800",
  at_lab: "bg-purple-100 text-purple-800",
  testing: "bg-cyan-100 text-cyan-800",
  completed: "bg-emerald-100 text-emerald-800",
};

export default function Laboratory(){const {user}=useAuth(),{meta}=useMeta(),isLab=user.role==="lab",[sel,setSel]=useState(null),[routine,setRoutine]=useState(false);
  const [activeTab, setActiveTab] = useState("requests"); // "requests" | "collections" | "reports"
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [advancingStage, setAdvancingStage] = useState("");
  const [stageNote, setStageNote] = useState("");
  const [stageLabReportId, setStageLabReportId] = useState("");
  const [updatingStage, setUpdatingStage] = useState(false);

  const {data:srs,loading:l1,error:e1,reload:r1}=useAsync(()=>getSampleRequests()),{data:reps,loading:l2,error:e2,reload:r2}=useAsync(getLaboratoryReports),{data:batches}=useAsync(()=>isLab?getBatches():Promise.resolve([]),[isLab]);
  const {data:collections,loading:lCol,error:eCol,reload:rCol}=useAsync(()=>getLabCollections());
  const {data:detail,loading:ld}=useAsync(()=>sel?getSampleRequest(sel):Promise.resolve(null),[sel]);

  if(e1||e2||eCol)return <ErrorState error={e1||e2||eCol} onRetry={()=>{r1();r2();rCol()}}/>;
  if(l1||l2||lCol)return <LoadingState variant="cards"/>;

  const now=Date.now(),pending=srs.filter(s=>["requested","submitted"].includes(s.status)),overdue=pending.filter(s=>s.dueBy&&new Date(s.dueBy)<now),done=()=>{r1();r2();rCol()};
  const focusForm=()=>setTimeout(()=>document.getElementById("submission")?.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"start"}),50);
  const open=id=>{setSel(sel===id?null:id);setRoutine(false);if(sel!==id)focusForm()};

  const currentIdx = selectedCollection ? ALL_STAGES.findIndex(s => s.key === selectedCollection.stage) : -1;
  const validNextStages = selectedCollection ? ALL_STAGES.slice(currentIdx + 1) : [];

  const handleAdvanceStage = async () => {
    if (!advancingStage) return alert("Select the next stage.");
    try {
      setUpdatingStage(true);
      await patchCollectionStage(selectedCollection.id, {
        stage: advancingStage,
        note: stageNote || undefined,
        lab_report_id: stageLabReportId || undefined
      });
      setAdvancingStage("");
      setStageNote("");
      setStageLabReportId("");
      setSelectedCollection(null);
      await rCol();
    } catch (err) {
      alert(err.message || "Failed to advance stage");
    } finally {
      setUpdatingStage(false);
    }
  };

  return <Page className="space-y-8">
    <PageHeader eyebrow="Evidence" title="Laboratory" sub="Sample requests, physical specimen custody tracking, and test reports. Reports attach to the batch as evidence and cannot be overwritten."/>

    {/* Metric StatTiles */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
      <StatTile label="Pending requests" value={pending.length} icon={ClipboardList}/>
      <StatTile label="Sample Collections" value={collections?.length || 0} icon={Truck} hint="Field custody tracking"/>
      <StatTile label="Past due date" value={overdue.length} icon={Clock} tone={overdue.length?"attention":"default"} hint={overdue.length?"Results are overdue":"None overdue"}/>
      <StatTile label="Reports on file" value={reps.length} icon={FileCheck2}/>
    </div>

    {/* Tab navigation */}
    <div className="flex border-b border-line gap-2">
      <button
        onClick={() => setActiveTab("requests")}
        className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
          activeTab === "requests"
            ? "border-deep text-deep"
            : "border-transparent text-muted hover:text-ink"
        }`}
      >
        Sample Requests ({pending.length})
      </button>
      <button
        onClick={() => setActiveTab("collections")}
        className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
          activeTab === "collections"
            ? "border-deep text-deep"
            : "border-transparent text-muted hover:text-ink"
        }`}
      >
        <Truck size={15} /> Sample Collections ({collections?.length || 0})
      </button>
      <button
        onClick={() => setActiveTab("reports")}
        className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
          activeTab === "reports"
            ? "border-deep text-deep"
            : "border-transparent text-muted hover:text-ink"
        }`}
      >
        Test Results ({reps.length})
      </button>
    </div>

    {/* TAB 1: Sample Requests */}
    {activeTab === "requests" && (
      <>
        <Panel id="pending" icon={ClipboardList} title="Pending sample requests" desc="Requested by reviewers after complaints or a quality deviation.">
          {pending.length?<><div className="overflow-x-auto -mx-2 hidden md:block"><table className="tbl"><thead><tr><th>Request</th><th>Product and batch</th><th>Reason</th><th>Due</th><th>Complaints</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{pending.map(s=>{const late=s.dueBy&&new Date(s.dueBy)<now;return <tr key={s.id} className={sel===s.id?"bg-cream/40":""}>
            <td className="font-medium text-deep whitespace-nowrap">{s.id}<span className="block text-xs font-normal text-muted">requested {fmtDate(s.requestedAt)}</span></td>
            <td>{s.product}<span className="block text-xs text-muted">{s.batch?<Link className="navlink" to={"/batches/"+s.batch}>{s.batch}</Link>:"Batch to be identified by the laboratory"} · {s.categoryLabel}</span></td>
            <td className="text-ink/80 max-w-[18rem]">{s.reason}{s.status==="submitted"&&<span className="block text-xs text-muted">Inconclusive result submitted</span>}</td>
            <td className="whitespace-nowrap">{fmtDate(s.dueBy)}{late&&<span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-[#8A5A12]"><Clock size={12} aria-hidden/>Overdue</span>}</td><td className="tabular-nums">{s.complaintCount}</td>
            <td className="text-right whitespace-nowrap">{isLab?<Btn variant={sel===s.id?"deep":"ghost"} className="!py-1.5" aria-expanded={sel===s.id} onClick={()=>open(s.id)}>{sel===s.id?"Close form":"Enter results"}</Btn>:<span className="text-xs text-muted">View only</span>}</td></tr>})}</tbody></table></div>
            <ul className="md:hidden space-y-3">{pending.map(s=>{const late=s.dueBy&&new Date(s.dueBy)<now;return <li key={s.id} className="rounded-xl border border-line p-4"><div className="flex justify-between gap-2"><b className="text-deep">{s.id}</b>{late&&<span className="text-xs font-medium text-[#8A5A12] inline-flex items-center gap-1"><Clock size={12} aria-hidden/>Overdue</span>}</div>
              <p className="text-sm mt-1">{s.product} · {s.batch||"batch to be identified"}</p><p className="text-xs text-muted mt-1">{s.reason} · due {fmtDate(s.dueBy)} · {s.complaintCount} complaint{s.complaintCount===1?"":"s"}</p>
              {isLab&&<Btn variant={sel===s.id?"deep":"ghost"} className="mt-3 !py-1.5" onClick={()=>open(s.id)}>{sel===s.id?"Close form":"Enter results"}</Btn>}</li>})}</ul></>:<Empty icon={ClipboardList}>No pending sample requests.</Empty>}
        </Panel>

        <Panel id="submission" icon={FileUp} title="Report submission" desc={isLab?"Enter results for a sample request above, or submit a routine report for any batch you tested.":undefined}
          actions={isLab&&<Btn variant="ghost" aria-expanded={routine} onClick={()=>{setRoutine(!routine);setSel(null);if(!routine)focusForm()}}>{routine?"Close routine form":"Submit a routine report"}</Btn>}>
          {!isLab&&<Notice tone="info" title="Submission is limited to accredited laboratories">Reviewers and administrators can read all reports here but cannot submit or alter them. This is enforced on the server as well.</Notice>}
          {isLab&&!sel&&!routine&&<p className="text-sm text-muted flex items-center gap-2"><Lock size={14} aria-hidden/>Choose “Enter results” on a request, or open the routine form. Submitted reports are immutable; corrections create a new, linked report.</p>}
          {isLab&&sel&&<motion.div {...reveal} className="rounded-2xl bg-sand/50 p-5 md:p-7">{ld||!detail?<LoadingState/>:<div className="space-y-7">
            <div><h3 className="text-lg font-semibold text-deep">{detail.id} · {detail.product}</h3><p className="text-sm text-muted">{detail.categoryLabel}{detail.batchInfo&&` · lot ${detail.batchInfo.lot||"n/a"} · ${detail.batchInfo.qty} · ${detail.batchInfo.facility}`}</p></div>
            <div><h4 className="font-semibold text-deep text-sm mb-1">Related consumer complaints <span className="font-normal text-muted">(unverified; no contact details shown)</span></h4>{detail.complaints.length?<ul className="divide-y divide-line/70 text-sm">{detail.complaints.map(c=><li key={c.id} className="py-1.5">“{c.text}” <span className="text-muted">· {c.region||"area n/a"} · {fmtDate(c.date)}</span></li>)}</ul>:<Empty>None.</Empty>}</div>
            <LabReportForm key={detail.id} sr={detail} user={user} batches={batches||[]} meta={meta} onDone={done}/></div>}</motion.div>}
          {isLab&&routine&&<motion.div {...reveal} className="rounded-2xl bg-sand/50 p-5 md:p-7"><h3 className="text-lg font-semibold text-deep mb-4">Routine laboratory report</h3><LabReportForm key="routine" user={user} batches={batches||[]} meta={meta} onDone={done}/></motion.div>}
        </Panel>
      </>
    )}

    {/* TAB 2: Physical Sample Collections & Journey */}
    {activeTab === "collections" && (
      <div className="space-y-6">
        <Panel
          icon={Truck}
          title="Physical Sample Custody & Journey Tracking"
          desc="Track and advance physical consumer samples from home pickup through transit and lab receipt."
        >
          {collections?.length ? (
            <div className="overflow-x-auto -mx-2">
              <table className="tbl min-w-[700px]">
                <thead>
                  <tr>
                    <th>Collection ID</th>
                    <th>Product & Batch</th>
                    <th>Consumer Region</th>
                    <th>Sample Request</th>
                    <th>Current Stage</th>
                    <th>Last Updated</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {collections.map((c) => {
                    const isSelected = selectedCollection?.id === c.id;
                    const lastHistory = c.stage_history?.[c.stage_history.length - 1];
                    const stageLabel = ALL_STAGES.find((s) => s.key === c.stage)?.label || c.stage;

                    return (
                      <tr key={c.id} className={isSelected ? "bg-cream/40" : ""}>
                        <td className="font-semibold text-deep">{c.id}</td>
                        <td>
                          {c.productName}
                          {c.batchId && (
                            <span className="block text-xs font-mono text-muted">
                              Batch: {c.batchId}
                            </span>
                          )}
                        </td>
                        <td>{c.region || "Not specified"}</td>
                        <td className="font-mono text-xs">{c.sample_request_id || "Direct"}</td>
                        <td>
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                              STAGE_BADGE[c.stage] || "bg-sand text-ink"
                            }`}
                          >
                            {stageLabel}
                          </span>
                        </td>
                        <td className="text-xs text-muted">
                          {fmtDate(lastHistory?.at || c.created_at)}
                        </td>
                        <td className="text-right">
                          <Btn
                            variant={isSelected ? "deep" : "ghost"}
                            className="!py-1 text-xs"
                            onClick={() => {
                              setSelectedCollection(isSelected ? null : c);
                              setAdvancingStage("");
                            }}
                          >
                            {isSelected ? "Close" : "Manage Stage"}
                          </Btn>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon={Truck}>No sample collections recorded yet.</Empty>
          )}
        </Panel>

        {/* Selected Collection Detail & Advance Stage Panel */}
        {selectedCollection && (
          <motion.div {...reveal} className="rounded-2xl bg-white border border-line p-6 shadow-sm space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-line">
              <div>
                <h3 className="text-lg font-bold text-deep flex items-center gap-2">
                  <Package size={20} />
                  Custody Management · {selectedCollection.id}
                </h3>
                <p className="text-sm text-muted">
                  {selectedCollection.productName} · Region: {selectedCollection.region || "Unspecified"}
                </p>
              </div>
              <Link
                to={`/sample-journey/${selectedCollection.id}`}
                target="_blank"
                className="text-xs font-semibold text-deep hover:underline inline-flex items-center gap-1"
              >
                View Public Stepper <ArrowRight size={13} />
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* History Timeline */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted">
                  Stage Audit History
                </h4>
                <ol className="relative border-l border-line ml-3 space-y-4">
                  {selectedCollection.stage_history?.map((h, i) => (
                    <li key={i} className="pl-5 relative">
                      <span className="absolute -left-1.5 top-1 w-3 h-3 rounded-full bg-deep" />
                      <span className="text-xs font-semibold text-deep block">
                        {ALL_STAGES.find((s) => s.key === h.stage)?.label || h.stage}
                      </span>
                      <span className="text-[11px] text-muted block">{fmtDate(h.at)}</span>
                      {h.note && (
                        <p className="text-xs text-ink/80 mt-0.5">{h.note}</p>
                      )}
                    </li>
                  ))}
                </ol>
              </div>

              {/* Advance Stage Form */}
              <div className="bg-sand/30 p-5 rounded-xl border border-line space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-deep">
                  Advance Custody Stage
                </h4>

                {validNextStages.length === 0 ? (
                  <div className="p-3 bg-emerald-50 rounded-lg text-xs text-emerald-800 font-medium">
                    This sample journey has completed all milestones.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-deep mb-1">
                        Select Next Stage
                      </label>
                      <select
                        value={advancingStage}
                        onChange={(e) => setAdvancingStage(e.target.value)}
                        className="w-full text-xs p-2 rounded-lg border border-line bg-white focus:ring-1 focus:ring-deep"
                      >
                        <option value="">-- Choose Next Stage --</option>
                        {validNextStages.map((st) => (
                          <option key={st.key} value={st.key}>
                            {st.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-deep mb-1">
                        Note / Chain-of-Custody Comments (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Received at sample desk, temperature 4°C"
                        value={stageNote}
                        onChange={(e) => setStageNote(e.target.value)}
                        className="w-full text-xs p-2 rounded-lg border border-line bg-white focus:ring-1 focus:ring-deep"
                      />
                    </div>

                    {advancingStage === "completed" && (
                      <div>
                        <label className="block text-xs font-medium text-deep mb-1">
                          Linked Lab Report ID (Optional)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. LAB-2001"
                          value={stageLabReportId}
                          onChange={(e) => setStageLabReportId(e.target.value)}
                          className="w-full text-xs p-2 rounded-lg border border-line bg-white focus:ring-1 focus:ring-deep"
                        />
                      </div>
                    )}

                    <Btn
                      variant="deep"
                      className="w-full !py-2 text-xs font-semibold"
                      disabled={!advancingStage || updatingStage}
                      onClick={handleAdvanceStage}
                    >
                      {updatingStage ? "Advancing Stage..." : "Confirm & Advance Stage"}
                    </Btn>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </div>
    )}

    {/* TAB 3: Test Results */}
    {activeTab === "reports" && (
      <Panel id="results" icon={Microscope} title="Laboratory test results" desc="Original reports are never edited. A corrected report links back to the one it supersedes.">
        {reps.length?<div className="overflow-x-auto -mx-2"><table className="tbl min-w-[860px]"><thead><tr>{["Report","Batch","Laboratory","Date","Results","Outcome"].map(h=><th key={h}>{h}</th>)}</tr></thead>
          <tbody>{reps.map(r=><tr key={r.id} className={r.reportStatus==="superseded"?"text-muted":""}><td className="font-medium text-deep whitespace-nowrap">{r.id}{r.supersedes&&<span className="block text-xs font-normal text-muted">corrects {r.supersedes}</span>}{r.reportStatus==="superseded"&&<span className="block text-xs font-normal">Superseded</span>}</td>
            <td><Link className="navlink" to={"/batches/"+r.batch}>{r.batch}</Link><span className="block text-xs text-muted">{r.product}</span></td><td>{r.lab}<span className="block text-xs text-muted">{r.accreditationRef}</span></td><td className="whitespace-nowrap">{fmtDate(r.date)}</td>
            <td>{r.resultRows.map(x=>`${x.label} ${x.value}${x.unit?(x.unit==="%"?"%":" "+x.unit):""}`).join(" · ")}{r.attachments.map(a=><a key={a.id} className="block navlink text-xs w-fit" href={attachmentUrl(a.id)}>{a.name}</a>)}</td>
            <td><Outcome r={r}/>{r.contaminationType&&<span className="block text-xs text-muted mt-1">{r.contaminationType}</span>}</td></tr>)}</tbody></table></div>:<Empty icon={Microscope}>No laboratory reports yet.</Empty>}
      </Panel>
    )}
  </Page>;
}
