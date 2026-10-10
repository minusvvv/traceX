import {Routes,Route,Link} from "react-router-dom";
import Layout from "./components/layout/Layout.jsx";import Landing from "./pages/Landing.jsx";import Login from "./pages/Login.jsx";import Dashboard from "./pages/Dashboard.jsx";
import SupplyChain from "./pages/SupplyChain.jsx";import Batches from "./pages/Batches.jsx";import Investigations from "./pages/Investigations.jsx";import InvestigationDetail from "./pages/InvestigationDetail.jsx";
import Laboratory from "./pages/Laboratory.jsx";import Analytics from "./pages/Analytics.jsx";import Admin from "./pages/Admin.jsx";import Provider from "./pages/Provider.jsx";
import Consumer from "./pages/Consumer.jsx";import ConsumerVerify from "./pages/ConsumerVerify.jsx";import ConsumerComplaint from "./pages/ConsumerComplaint.jsx";import ConsumerStatus from "./pages/ConsumerStatus.jsx";import ConsumerMap from "./pages/ConsumerMap.jsx";
import RequireRole from "./auth/RequireRole.jsx";
// Route guards are for UX; the server enforces the same roles on every API call.
export default function App(){return <Routes>
  <Route path="/" element={<Landing/>}/><Route path="/login" element={<Login/>}/>
  <Route element={<Layout/>}>
    <Route path="/consumer" element={<Consumer/>}/><Route path="/consumer/verify/:batchId" element={<ConsumerVerify/>}/><Route path="/consumer/report" element={<ConsumerComplaint/>}/>
    <Route path="/consumer/status" element={<ConsumerStatus/>}/><Route path="/consumer/status/:code" element={<ConsumerStatus/>}/><Route path="/consumer/map" element={<ConsumerMap/>}/>
    <Route element={<RequireRole roles={["reviewer","admin"]}/>}><Route path="/dashboard" element={<Dashboard/>}/><Route path="/supply-chain" element={<SupplyChain/>}/>
      <Route path="/investigations" element={<Investigations/>}/><Route path="/investigations/:id" element={<InvestigationDetail/>}/><Route path="/analytics" element={<Analytics/>}/></Route>
    <Route element={<RequireRole roles={["reviewer","admin","lab"]}/>}><Route path="/batches" element={<Batches/>}/><Route path="/batches/:batchId" element={<Batches/>}/><Route path="/laboratory" element={<Laboratory/>}/></Route>
    <Route element={<RequireRole roles={["admin"]}/>}><Route path="/admin" element={<Admin/>}/></Route>
    <Route element={<RequireRole roles={["provider","admin"]}/>}><Route path="/provider" element={<Provider/>}/></Route></Route>
  <Route path="*" element={<div className="p-16 text-center"><h1 className="text-3xl font-semibold text-deep">404 · Page not found</h1><Link className="underline" to="/">Back to home</Link></div>}/></Routes>}
