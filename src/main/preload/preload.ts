import { contextBridge } from "electron";
import { IPCInterface } from "./ipc/interface";
import { RendererInterfaceKey } from "@shared/types/constants";

contextBridge.exposeInMainWorld(RendererInterfaceKey, IPCInterface);

console.log("[Preload.js] Preload script loaded");