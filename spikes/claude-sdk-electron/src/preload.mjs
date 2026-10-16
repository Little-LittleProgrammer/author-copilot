import { contextBridge } from "electron";

contextBridge.exposeInMainWorld(
  "spikeEnvironment",
  Object.freeze({
    architecture: process.arch,
    platform: process.platform,
  }),
);
