import React from "react";
import { createRoot } from "react-dom/client";
import { OptionsApp } from "../../src/options/OptionsApp";
import "../../src/styles/options.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode><OptionsApp /></React.StrictMode>);
