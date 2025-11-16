import { contextBridge } from "electron";
import { IPCInterface } from "./ipc/interface";
import { RendererInterfaceKey } from "@shared/types/constants";

contextBridge.exposeInMainWorld(RendererInterfaceKey, IPCInterface);

// Prevent default navigation when external files dropped on window
const prevent = (e: DragEvent) => { e.preventDefault(); };
window.addEventListener('dragover', prevent);
window.addEventListener('drop', prevent);

console.log("[Preload.js] Preload script loaded");