import React from "react";
import ReactDOM from "react-dom/client";
import { LocalApp } from "./app/LocalApp";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocalApp />
  </React.StrictMode>
);
