import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useOptionalWorkspace } from "@/apps/workspace/context/WorkspaceContext";
import { Services } from "@/lib/workspace/services/services";
import type { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import { ResizableHandle } from "./ResizableHandle";

/**
 * The sidebars that live inside an editor, and the one way they are sized.
 *
 * The workspace's own docks have always been resizable. The panels an editor carries inside its tab
 * - the UI editor's outline, the blueprint editor's layer panel, the scene flow's route list, the
 * motion library's list - were each a fixed Tailwind width, so a long layer name was cut off with no
 * way to make room for it. They are all sized here now: the same seam the docks use (a
 * `ResizableHandle` on the panel's inner edge), the same bounds, and the width remembered per kind of
 * sidebar - drag the outline wider in one interface and every interface's outline is that wide, now
 * and after a restart.
 *
 * The width is the author's arrangement of their workspace, not something about a project, so it is
 * kept in the global settings beside the docks' widths (`ui.editorSidebar.<id>.width`) and never in
 * a project's files. Nothing is written until the author actually drags: an undragged sidebar reads
 * the default from here, so changing a default later reaches everyone who never chose otherwise.
 */
export type EditorSidebarId = "uiOutline" | "blueprintLayers" | "sceneFlowRoutes" | "motionLibrary";

export type EditorSidebarSpec = {
    /** What the sidebar used to be fixed at, and still opens at until the author drags it. */
    defaultWidth: number;
    minWidth: number;
    maxWidth: number;
};

export const EDITOR_SIDEBARS: Readonly<Record<EditorSidebarId, EditorSidebarSpec>> = {
    uiOutline: { defaultWidth: 256, minWidth: 180, maxWidth: 560 },
    blueprintLayers: { defaultWidth: 224, minWidth: 180, maxWidth: 560 },
    sceneFlowRoutes: { defaultWidth: 240, minWidth: 180, maxWidth: 560 },
    motionLibrary: { defaultWidth: 256, minWidth: 180, maxWidth: 560 },
};

/**
 * How much of the editor a sidebar always leaves to the editor itself.
 *
 * A bound on the drag and on the drawn width both, so a sidebar dragged wide in a big window does not
 * swallow the canvas when the window is made small - it gives way down to its minimum, and only
 * below that does the editor get less.
 */
export const EDITOR_SIDEBAR_EDITOR_RESERVE = 240;

export function editorSidebarSettingsKey(id: EditorSidebarId): string {
    return `ui.editorSidebar.${id}.width`;
}

/** A stored width brought back inside the sidebar's bounds; anything that is not a number is the default. */
export function normalizeEditorSidebarWidth(id: EditorSidebarId, value: unknown): number {
    const spec = EDITOR_SIDEBARS[id];
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return spec.defaultWidth;
    }
    return Math.round(Math.min(spec.maxWidth, Math.max(spec.minWidth, value)));
}

/**
 * The width a sidebar is actually drawn at in an editor `containerWidth` wide.
 *
 * The same rule as {@link editorSidebarCssWidth}, for the code that has to know the number - the UI
 * editor fits the interface into what the outline leaves of the canvas.
 */
export function resolveEditorSidebarWidth(id: EditorSidebarId, width: number, containerWidth: number): number {
    const { minWidth } = EDITOR_SIDEBARS[id];
    return Math.max(minWidth, Math.min(width, containerWidth - EDITOR_SIDEBAR_EDITOR_RESERVE));
}

/**
 * The CSS width for a sidebar whose chosen width is `width`, against the element it sits in.
 *
 * `clamp` resolves its lower bound last, so an editor too narrow for both the minimum and the reserve
 * keeps the sidebar at its minimum - the same order {@link resolveEditorSidebarWidth} applies.
 */
export function editorSidebarCssWidth(id: EditorSidebarId, width: number): string {
    const { minWidth } = EDITOR_SIDEBARS[id];
    return `clamp(${minWidth}px, ${width}px, calc(100% - ${EDITOR_SIDEBAR_EDITOR_RESERVE}px))`;
}

// --- The live width ---------------------------------------------------------------------------
//
// Several sidebars of one kind can be mounted at once (every open interface tab has its outline, kept
// alive while hidden), and they are one setting, so the width while it is being dragged is held here
// rather than in any one of them. Once a drag has happened in this window the value here is the
// answer; before that, the stored one is.

const liveWidths = new Map<EditorSidebarId, number>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function setLiveWidth(id: EditorSidebarId, width: number): void {
    if (liveWidths.get(id) === width) {
        return;
    }
    liveWidths.set(id, width);
    listeners.forEach(listener => listener());
}

function useGlobalSettings(): GlobalSettingsService | null {
    const workspace = useOptionalWorkspace();
    const context = workspace?.context ?? null;
    const ready = workspace?.isInitialized ?? false;
    return useMemo(() => {
        if (!context || !ready) {
            return null;
        }
        try {
            return context.services.get<GlobalSettingsService>(Services.GlobalSettings);
        } catch {
            return null;
        }
    }, [context, ready]);
}

/** The width the author chose for this kind of sidebar, or its default. Live across every instance. */
export function useEditorSidebarWidth(id: EditorSidebarId): number {
    const settings = useGlobalSettings();
    const read = useCallback(
        () => liveWidths.get(id) ?? normalizeEditorSidebarWidth(id, settings?.getSync<unknown>(editorSidebarSettingsKey(id))),
        [id, settings],
    );
    return useSyncExternalStore(subscribe, read, read);
}

export type EditorSidebarResizeHandleProps = {
    id: EditorSidebarId;
    /**
     * Which edge of the sidebar the handle is on - the one facing the editor. `right` for a sidebar
     * on the editor's left, where dragging right widens it; `left` for one on the right.
     */
    edge: "left" | "right";
    /** Told when a drag starts and ends, for anything that animates with the sidebar's width. */
    onDraggingChange?: (dragging: boolean) => void;
};

/**
 * The seam on a sidebar's inner edge.
 *
 * Rendered INSIDE the sidebar, which must be a positioned element (`relative` or `absolute`): the
 * handle pins itself to that edge, so the sidebar draws no border of its own there - the seam's line
 * is the border, exactly as between the workspace's docks. The bounds of a drag are measured off the
 * sidebar's parent, which is the box `editorSidebarCssWidth` resolves its percentage against.
 */
export function EditorSidebarResizeHandle({ id, edge, onDraggingChange }: EditorSidebarResizeHandleProps) {
    const settings = useGlobalSettings();
    const width = useEditorSidebarWidth(id);
    const anchorRef = useRef<HTMLDivElement>(null);
    // Mid-drag reads must not wait for a render: `onResize` fires per mousemove.
    const widthRef = useRef(width);
    widthRef.current = width;
    const [dragging, setDragging] = useState(false);

    const handleResize = useCallback((delta: number): number => {
        const spec = EDITOR_SIDEBARS[id];
        const containerWidth = anchorRef.current?.parentElement?.parentElement?.clientWidth;
        const ceiling = containerWidth === undefined
            ? spec.maxWidth
            : Math.min(spec.maxWidth, containerWidth - EDITOR_SIDEBAR_EDITOR_RESERVE);
        const current = containerWidth === undefined
            ? widthRef.current
            : resolveEditorSidebarWidth(id, widthRef.current, containerWidth);
        const wanted = edge === "right" ? current + delta : current - delta;
        const next = Math.round(Math.max(spec.minWidth, Math.min(Math.max(spec.minWidth, ceiling), wanted)));
        widthRef.current = next;
        setLiveWidth(id, next);
        // `ResizableHandle` moves its anchor by what is returned: the part of the pointer's travel
        // the width did not follow, so the seam stays under the pointer once the width is clamped.
        const applied = edge === "right" ? next - current : current - next;
        return applied - delta;
    }, [edge, id]);

    const handleDragStart = useCallback(() => {
        setDragging(true);
        onDraggingChange?.(true);
    }, [onDraggingChange]);

    const handleDragEnd = useCallback(() => {
        setDragging(false);
        onDraggingChange?.(false);
        const settled = liveWidths.get(id);
        if (settled === undefined || !settings) {
            return;
        }
        void settings.set(editorSidebarSettingsKey(id), settled).catch(error => {
            console.warn(`[EditorSidebar] could not remember the ${id} width`, error);
        });
    }, [id, onDraggingChange, settings]);

    // A drag that is still going when the sidebar unmounts (its tab closed under the pointer) has
    // nobody to tell; let anything animating with it know it is over.
    useEffect(() => () => {
        if (dragging) onDraggingChange?.(false);
    }, [dragging, onDraggingChange]);

    const hostDocument = anchorRef.current?.ownerDocument ?? null;

    return (
        <>
            <div
                ref={anchorRef}
                className={`absolute inset-y-0 z-20 flex ${edge === "right" ? "right-0" : "left-0"}`}
            >
                <ResizableHandle
                    direction="horizontal"
                    onResize={handleResize}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                />
            </div>
            {/* While dragging, a sheet over the whole window keeps the resize cursor wherever the
                pointer runs to, and keeps the canvas underneath from treating the drag as hover. */}
            {dragging && hostDocument
                ? createPortal(<div className="fixed inset-0 z-[10000] cursor-col-resize" />, hostDocument.body)
                : null}
        </>
    );
}
