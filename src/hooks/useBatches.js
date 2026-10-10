import useAsync from "./useAsync.js";import {getBatches} from "../services/api.js";
export default function useBatches(category){const {data,error,loading,reload}=useAsync(()=>getBatches(category),[category]);return {batches:data,loading,error,reload};}
