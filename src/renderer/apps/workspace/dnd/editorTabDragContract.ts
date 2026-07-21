/** Custom MIME for dragging an editor tab header between groups (renderer-local). */
export const EDITOR_TAB_DRAG_MIME = "application/x-narraleaf-editor-tab+json";

/** Wire format v1 - short keys, mirroring the asset drag contract. */
export interface EditorTabDragWirePayloadV1 {
    v: 1;
    /** Dragged tab id. */
    t: string;
    /** Group the tab is being dragged out of. */
    g: string;
}

export function encodeEditorTabDragPayload(tabId: string, groupId: string): string {
    const payload: EditorTabDragWirePayloadV1 = { v: 1, t: tabId, g: groupId };
    return JSON.stringify(payload);
}

export function decodeEditorTabDragPayload(raw: string | null | undefined): EditorTabDragWirePayloadV1 | null {
    if (!raw || typeof raw !== "string") {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") {
            return null;
        }
        const o = parsed as Record<string, unknown>;
        if (o.v !== 1 || typeof o.t !== "string" || typeof o.g !== "string" || !o.t || !o.g) {
            return null;
        }
        return { v: 1, t: o.t, g: o.g };
    } catch {
        return null;
    }
}

export function isEditorTabDragEvent(dt: DataTransfer | null | undefined): boolean {
    if (!dt) {
        return false;
    }
    return Array.from(dt.types).includes(EDITOR_TAB_DRAG_MIME);
}

export interface EditorTabDragSession {
    tabId: string;
    groupId: string;
}

/**
 * The tab drag currently in flight, mirrored outside `dataTransfer`.
 *
 * Chromium blanks `dataTransfer.getData()` during dragenter/dragover (only `types` is readable), so
 * a drop target cannot learn *which* tab is coming until the drop itself. Hover feedback needs that
 * earlier - a group must know whether the drag started in itself to reject splitting its own last
 * tab off - so the source records it here. Same workaround as WorkspaceAssetDragProvider, kept as a
 * module singleton because only event handlers read it; nothing renders off it.
 */
let activeSession: EditorTabDragSession | null = null;

export function beginEditorTabDrag(session: EditorTabDragSession): void {
    activeSession = session;
}

export function endEditorTabDrag(): void {
    activeSession = null;
}

export function getActiveEditorTabDrag(): EditorTabDragSession | null {
    return activeSession;
}
