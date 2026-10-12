import {lazy,Suspense} from "react";import {Routes,Route,Link} from "react-router-dom";
import Layout from "./components/layout/Layout.jsx";import RequireRole from "./auth/RequireRole.jsx";import LoadingState from "./components/common/LoadingState.jsx";
// Every page is its own chunk, so heavy libraries (Leaflet, Recharts) only load on the routes that use them.
const Landing=lazy(()=>import("./pages/Landing.jsx")),Login=lazy(()=>import("./pages/Login.jsx")),Dashboard=lazy(()=>import("./pages/Dashboard.jsx")),SupplyChain=lazy(()=>import("./pages/SupplyChain.jsx")),
  Batches=lazy(()=>import("./pages/Batches.jsx")),Investigations=lazy(()=>import("./pages/Investigations.jsx")),InvestigationDetail=lazy(()=>import("./pages/InvestigationDetail.jsx")),
  Laboratory=lazy(()=>import("./pages/Laboratory.jsx")),Analytics=lazy(()=>import("./pages/Analytics.jsx")),Admin=lazy(()=>import("./pages/Admin.jsx")),Provider=lazy(()=>import("./pages/Provider.jsx")),
  Consumer=lazy(()=>import("./pages/Consumer.jsx")),ConsumerVerify=lazy(()=>import("./pages/ConsumerVerify.jsx")),ConsumerComplaint=lazy(()=>import("./pages/ConsumerComplaint.jsx")),
  ConsumerStatus=lazy(()=>import("./pages/ConsumerStatus.jsx")),ConsumerMap=lazy(()=>import("./pages/ConsumerMap.jsx"));
// Route guards are for UX; the server enforces the same roles on every API call.
export default function App(){return <Suspense fallback={<div className="max-w-7xl mx-auto px-6 py-10"><LoadingState/></div>}><Routes>
  <Route path="/" element={<Landing/>}/><Route path="/login" element={<Login/>}/>
  <Route element={<Layout/>}>
    <Route path="/consumer" element={<Consumer/>}/><Route path="/consumer/verify/:batchId" element={<ConsumerVerify/>}/><Route path="/consumer/report" element={<ConsumerComplaint/>}/>
    <Route path="/consumer/status" element={<ConsumerStatus/>}/><Route path="/consumer/status/:code" element={<ConsumerStatus/>}/><Route path="/consumer/map" element={<ConsumerMap/>}/>
    <Route element={<RequireRole roles={["reviewer","admin"]}/>}><Route path="/dashboard" element={<Dashboard/>}/><Route path="/supply-chain" element={<SupplyChain/>}/>
      <Route path="/investigations" element={<Investigations/>}/><Route path="/investigations/:id" element={<InvestigationDetail/>}/><Route path="/analytics" element={<Analytics/>}/></Route>
    <Route element={<RequireRole roles={["reviewer","admin","lab"]}/>}><Route path="/batches" element={<Batches/>}/><Route path="/batches/:batchId" element={<Batches/>}/><Route path="/laboratory" element={<Laboratory/>}/></Route>
    <Route element={<RequireRole roles={["admin"]}/>}><Route path="/admin" element={<Admin/>}/></Route>
    <Route element={<RequireRole roles={["provider","admin"]}/>}><Route path="/provider" element={<Provider/>}/></Route></Route>
  <Route path="*" element={<div className="p-16 text-center"><h1 className="text-3xl font-semibold text-deep">404 · Page not found</h1><Link className="underline" to="/">Back to home</Link></div>}/></Routes></Suspense>}
