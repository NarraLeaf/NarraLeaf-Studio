import { contextBridge } from "electron";
import { IPCInterface } from "./ipc/interface";
import { RendererInterfaceKey } from "@shared/types/constants";

/**
 * A detached editor window (see `detachedWindowGuard`) runs this preload too - Electron gives a
 * popup its opener's webPreferences - and it must not be handed a bridge of its own.
 *
 * The privileged bootstrap bridge is revoked once, by the renderer that used it, on the module
 * instance belonging to ITS document (`harden()` in ipc/interface). A popup gets a fresh module
 * instance, so its bridge would still be un-hardened, and the opener can reach straight into a
 * same-origin popup's globals - handing every workspace renderer a way to conjure back the
 * filesystem access bootstrap took away. Nothing is lost by refusing: the detached window has no
 * scripts of its own, its contents are portalled in from the opener's React tree, and that tree
 * calls IPC through the opener's own bridge.
 *
 * Detected as "opened by another document, and still blank": every real Studio window loads its
 * app:// entry, and only a popup has an opener.
 */
const isDetachedChildDocument = window.opener !== null || location.href === "about:blank";

if (!isDetachedChildDocument) {
    contextBridge.exposeInMainWorld(RendererInterfaceKey, IPCInterface);
}

// Prevent default navigation when external files dropped on window
const prevent = (e: DragEvent) => { e.preventDefault(); };
window.addEventListener('dragover', prevent);
window.addEventListener('drop', prevent);

console.log(`[Preload.js] Preload script loaded${isDetachedChildDocument ? " (detached window: no bridge)" : ""}`);
