import { clipboard } from "electron";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import {
    isStudioClipboardKind,
    STUDIO_CLIPBOARD_FORMATS,
    STUDIO_CLIPBOARD_MAX_BYTES,
} from "@shared/types/studioClipboard";
import { WindowAppType } from "@shared/types/window";
import type { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * The platform clipboard, for the editor selections that travel between project windows.
 *
 * Main owns this because it is the only part of Studio holding the clipboard, and because both
 * limits below have to hold whatever a renderer asks for: the surface is shared with every other
 * application on the machine.
 *
 *  - **Only Studio's own format names.** The kind is looked up in a fixed table rather than taken
 *    as a format string, so no caller can write over a format another application owns.
 *  - **Only a workspace window.** A preview or dev-mode window runs a game, and a game has no
 *    editor selection to copy.
 *
 * See `@shared/types/studioClipboard` for why the browser's `copy` event is not the route here.
 */
function isClipboardWindow(window: AppWindow): boolean {
    return window.getWindowType() === WindowAppType.Workspace;
}

export class ClipboardWriteEditorSelectionHandler extends IPCHandler<IPCEventType.clipboardWriteEditorSelection> {
    readonly name = IPCEventType.clipboardWriteEditorSelection;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
        { kind, payload }: IPCEvents[IPCEventType.clipboardWriteEditorSelection]["data"],
    ): RequestStatus<{ stored: boolean }> {
        if (!isClipboardWindow(window) || !isStudioClipboardKind(kind) || typeof payload !== "string") {
            return this.success({ stored: false });
        }
        const buffer = Buffer.from(payload, "utf8");
        if (buffer.byteLength === 0 || buffer.byteLength > STUDIO_CLIPBOARD_MAX_BYTES) {
            return this.success({ stored: false });
        }
        try {
            clipboard.writeBuffer(STUDIO_CLIPBOARD_FORMATS[kind], buffer);
            return this.success({ stored: true });
        } catch (error) {
            // A clipboard another application is holding open is a transient platform condition,
            // not a fault of the copy. The window keeps its own copy of the selection either way.
            window.app.logger.warn(`[Clipboard] could not write ${kind}: ${String(error)}`);
            return this.success({ stored: false });
        }
    }
}

export class ClipboardReadEditorSelectionHandler extends IPCHandler<IPCEventType.clipboardReadEditorSelection> {
    readonly name = IPCEventType.clipboardReadEditorSelection;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
        { kind }: IPCEvents[IPCEventType.clipboardReadEditorSelection]["data"],
    ): RequestStatus<{ payload: string | null }> {
        if (!isClipboardWindow(window) || !isStudioClipboardKind(kind)) {
            return this.success({ payload: null });
        }
        try {
            // An absent format answers with an empty buffer rather than throwing, which is the
            // ordinary case: the clipboard is holding text, or something another application wrote.
            const buffer = clipboard.readBuffer(STUDIO_CLIPBOARD_FORMATS[kind]);
            if (!buffer || buffer.byteLength === 0 || buffer.byteLength > STUDIO_CLIPBOARD_MAX_BYTES) {
                return this.success({ payload: null });
            }
            return this.success({ payload: buffer.toString("utf8") });
        } catch (error) {
            window.app.logger.warn(`[Clipboard] could not read ${kind}: ${String(error)}`);
            return this.success({ payload: null });
        }
    }
}
