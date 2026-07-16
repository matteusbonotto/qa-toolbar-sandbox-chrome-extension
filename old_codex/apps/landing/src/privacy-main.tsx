import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrivacyPolicy } from "./PrivacyPolicy";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element was not found");

createRoot(root).render(
  <StrictMode>
    <PrivacyPolicy />
  </StrictMode>,
);
