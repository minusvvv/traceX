import React from "react";import {createRoot} from "react-dom/client";import {BrowserRouter} from "react-router-dom";import {MotionConfig} from "framer-motion";
import "leaflet/dist/leaflet.css";import "./index.css";import App from "./App.jsx";import {AuthProvider} from "./auth/AuthContext.jsx";import {I18nProvider} from "./i18n/index.jsx";
// reducedMotion="user": every framer-motion animation follows the OS "reduce motion" setting.
createRoot(document.getElementById("root")).render(<BrowserRouter><MotionConfig reducedMotion="user"><I18nProvider><AuthProvider><App/></AuthProvider></I18nProvider></MotionConfig></BrowserRouter>);
