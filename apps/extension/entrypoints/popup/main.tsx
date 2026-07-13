import React from "react";
import { createRoot } from "react-dom/client";
import { PopupApp } from "../../src/popup/PopupApp";
import "../../src/styles/base.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>,
);
