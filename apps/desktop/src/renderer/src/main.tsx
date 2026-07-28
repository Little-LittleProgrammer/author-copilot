import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TooltipProvider } from "@/components/ui/tooltip.js";

import { App } from "./App.js";
import "./styles.css";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Renderer root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
