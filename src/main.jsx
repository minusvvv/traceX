import React from "react";import {createRoot} from "react-dom/client";import {BrowserRouter} from "react-router-dom";
import "leaflet/dist/leaflet.css";import "./index.css";import App from "./App.jsx";import {AuthProvider} from "./auth/AuthContext.jsx";import {I18nProvider} from "./i18n/index.jsx";
createRoot(document.getElementById("root")).render(<BrowserRouter><I18nProvider><AuthProvider><App/></AuthProvider></I18nProvider></BrowserRouter>);
