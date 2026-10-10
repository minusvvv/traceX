import {Navigate,Outlet,useLocation,Link} from "react-router-dom";
import {HOME,useAuth} from "./AuthContext.jsx";import LoadingState from "../components/common/LoadingState.jsx";
// Client-side guard for UX only. The server enforces the same rules on every API route.
export default function RequireRole({roles}){
  const {user,ready}=useAuth(),loc=useLocation();
  if(!ready)return <LoadingState/>;
  if(!user)return <Navigate to="/login" state={{from:loc.pathname}} replace/>;
  if(!roles.includes(user.role))return <div role="alert" className="max-w-md mx-auto text-center py-16"><h1 className="text-2xl font-semibold text-deep">Not permitted</h1><p className="text-muted mt-2">Your role ({user.role}) does not have access to this page.</p><Link className="navlink mt-4 inline-block" to={HOME[user.role]||"/"}>Go to your workspace</Link></div>;
  return <Outlet/>}
