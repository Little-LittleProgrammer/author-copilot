import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TooltipProvider } from "@/components/ui/tooltip.js";

import { App } from "./App.js";
import "./styles.css";

async function bootstrap(): Promise<void> {
  const root = document.getElementById("root");
  if (root === null) throw new Error("Renderer root element is missing");
  const context = await window.authorCopilot.tabs.getContext();
  document.body.dataset.rendererContext = context.kind;
  createRoot(root).render(
    <StrictMode>
      <TooltipProvider>
        <App context={context} />
      </TooltipProvider>
    </StrictMode>,
  );
}

void bootstrap();
