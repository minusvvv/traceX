import useAsync from "./useAsync.js";import {getMeta} from "../services/api.js";
// Category definitions (stages, tests) come from the server so the UI never assumes dairy.
export default function useMeta(){const {data,error}=useAsync(getMeta);return {meta:data,error};}
