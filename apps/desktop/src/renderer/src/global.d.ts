import type { AuthorCopilotApi } from "../../shared/desktop-api.js";

declare global {
  interface Window {
    readonly authorCopilot: AuthorCopilotApi;
  }
}

export {};
