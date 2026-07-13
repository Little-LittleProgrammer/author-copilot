import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectAgentSdk } from "./sdk-validation.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const smokeMode = process.argv.includes("--smoke");

async function createWindow() {
  const agentSdk = await inspectAgentSdk();
  const window = new BrowserWindow({
    height: 480,
    show: !smokeMode,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(currentDirectory, "preload.mjs"),
      sandbox: true,
    },
    width: 720,
  });

  await window.loadFile(path.join(currentDirectory, "index.html"));
  console.log(
    JSON.stringify({
      agentSdk,
      arch: process.arch,
      platform: process.platform,
      smoke: "passed",
    }),
  );

  if (smokeMode) {
    window.destroy();
    app.quit();
  }
}

app
  .whenReady()
  .then(createWindow)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

app.on("window-all-closed", () => app.quit());
