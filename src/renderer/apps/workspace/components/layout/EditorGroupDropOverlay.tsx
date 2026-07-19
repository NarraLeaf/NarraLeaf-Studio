import { editorDropZonePreviewRect, type EditorDropZone } from "./editorDropZones";

interface EditorGroupDropOverlayProps {
    /** The zone under the pointer, or null when nothing is hovering this group. */
    zone: EditorDropZone | null;
}

/**
 * Drop preview for an editor group: a themed wash over exactly the area the dropped editor will
 * occupy. The shape carries the meaning — half the pane for an edge split, the whole pane for a
 * plain tab drop — so no label is needed.
 */
export function EditorGroupDropOverlay({ zone }: EditorGroupDropOverlayProps) {
    if (!zone) {
        return null;
    }

    return (
        <div className="pointer-events-none absolute inset-0 z-20" aria-hidden>
            <div className="absolute inset-0 bg-primary/5" />
            <div
                className="absolute bg-primary/20 ring-1 ring-inset ring-primary/60 transition-all duration-100"
                style={editorDropZonePreviewRect(zone)}
            />
        </div>
    );
}
