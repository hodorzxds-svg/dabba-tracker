import React from "react";
import ReactDOM from "react-dom/client";
import DabbaTracker from "./App.jsx";
import "./index.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <DabbaTracker />
  </React.StrictMode>
);
