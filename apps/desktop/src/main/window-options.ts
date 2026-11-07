import type { BrowserWindowConstructorOptions, WebPreferences } from "electron";

export function createSecureWebPreferences(
  preloadPath: string,
): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
    navigateOnDragDrop: false,
  };
}

export function createWindowOptions(
  preloadPath: string,
): BrowserWindowConstructorOptions {
  return {
    width: 1180,
    height: 760,
    minWidth: 880,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f4f5f7",
    // Merge the native title bar into the page so the app can render its
    // own toolbar underneath the traffic-light controls (macOS only).
    titleBarStyle: "hiddenInset",
    webPreferences: createSecureWebPreferences(preloadPath),
  };
}
