import type { MoveableProps } from "react-moveable";
import type { DockerBarItem, FloatingToolbarItem } from "@/lib/ui-editor/widget-modules/types";

/**
 * Which of the interface editor's canvas gestures survive a read-only surface, and what the
 * transform overlay renders as while one is in force.
 *
 * The UI editor is the case the frozen-workspace feature was described by: *"select an element and
 * read its properties, but not modify or move it"*. Measured on a frozen workspace before this
 * existed: element drag, resize, rotate, marquee-insert and layer-tree reorder all still ran, moved
 * the element on screen, and were thrown away on thaw - the editor said yes and then discarded it.
 *
 * The rules match `apps/workspace/components/ui/freezeGuard`, whose {@link FreezeGuard.gesture} is
 * what the workspace hands down to us as a plain boolean:
 *
 *  - **Looking is the entire point.** Selection, hover, container drill-in, pan and zoom are not
 *    writes and are never touched. The properties panel reads the selection, so switching selection
 *    off would empty the one surface the author came here to read.
 *  - **Never half-attached.** A gesture is either whole or absent. A drag that picks up and refuses
 *    to drop reads as a bug in the editor, not as a frozen project - so the transform overlay drops
 *    its handlers *and* goes `pointer-events-none`, rather than keeping handles that move nothing.
 *  - **The table names what KEEPS working**, both for gestures and for the Moveable props, for the
 *    same reason `freezeActionPolicy`'s exemption is a table: the ways to mutate a document grow, and
 *    a gesture nobody remembered to add here would default to writable inside a frozen project.
 *    Getting the allow-list wrong greys out a harmless gesture; getting an opt-out wrong offers a
 *    write.
 */
export type UIEditorReadOnly = {
    /** Whether every write gesture on this surface is inert right now. */
    readonly active: boolean;
    /** Hover text for the controls this state disables. The workspace passes the freeze reason. */
    readonly reason?: string;
};

/** The writable default, so a surface that never opts in behaves exactly as before. */
export const UI_EDITOR_WRITABLE: UIEditorReadOnly = { active: false };

/**
 * Every pointer gesture the surface interaction layer and the layer outline can start.
 *
 * Named individually rather than lumped into "reads" / "writes" so the allow-list below is a list of
 * decisions someone made, not a predicate that has to be re-derived at each call site.
 */
export type SurfaceGesture =
    /** Click, shift-click and marquee selection on the canvas or in the outline. */
    | "select"
    /** Double-click that walks the selection into a container. Moves selection, not the document. */
    | "containerDrill"
    /** Pan tool / middle-drag. */
    | "pan"
    /** Wheel and pinch zoom. */
    | "zoom"
    /** Expanding and collapsing an outline branch - editor state, not project data. */
    | "outlineCollapse"
    /** Moveable drag / resize / rotate. */
    | "transform"
    /** Insert-tool drag that draws a new element onto the canvas. */
    | "insertDraw"
    /** Double-click into a `contenteditable` on the canvas. */
    | "inlineTextEdit"
    /** Double-click into the image crop overlay. */
    | "imageCrop"
    /** Dragging an outline row to reparent or reorder it. */
    | "outlineReorder"
    /** Double-click an outline row to rename the element. */
    | "outlineRename"
    /** The outline's eye toggle, which writes `layout.visible`. */
    | "outlineVisibility";

const READ_ONLY_SURFACE_GESTURES: ReadonlySet<SurfaceGesture> = new Set<SurfaceGesture>([
    "select",
    "containerDrill",
    "pan",
    "zoom",
    "outlineCollapse",
]);

/** Whether `gesture` writes nothing, and so keeps working on a read-only surface. */
export function isSurfaceGestureReadOnlySafe(gesture: SurfaceGesture): boolean {
    return READ_ONLY_SURFACE_GESTURES.has(gesture);
}

/** Whether `gesture` may run right now. The single question every call site asks. */
export function isSurfaceGestureEnabled(gesture: SurfaceGesture, readOnly: UIEditorReadOnly): boolean {
    return !readOnly.active || isSurfaceGestureReadOnlySafe(gesture);
}

/**
 * The Moveable props that stay when the surface is read-only: the two that keep the control box
 * drawn over the right pixels, and nothing else.
 *
 * `zoom` is the viewport scale, without which the box drifts away from the element as the author
 * zooms; `origin` is the centre dot. Every ability flag and every `on*` handler is dropped rather
 * than listed, so a controller that grows a new ability cannot leak it into a frozen project.
 */
const READ_ONLY_MOVEABLE_KEPT_PROPS = ["zoom", "origin"] as const;

/**
 * Strip a controller's Moveable props down to a non-interactive control box.
 *
 * Moveable keeps drawing its bounding lines with every ability off (`MoveableManager._renderLines`
 * is independent of the abilities), so the author still SEES what is selected - which is why this
 * returns inert props instead of unmounting the overlay. The call site additionally puts
 * `pointer-events-none` on it, following the same trick the editor already uses while an inline text
 * editor has focus: with no handlers left, that is what makes the surface underneath keep receiving
 * the clicks and hovers that selection is built on.
 */
export function toReadOnlyMoveableProps(props: Partial<MoveableProps>): Partial<MoveableProps> {
    const kept: Record<string, unknown> = {};
    for (const key of READ_ONLY_MOVEABLE_KEPT_PROPS) {
        if (props[key] !== undefined) {
            kept[key] = props[key];
        }
    }
    return {
        ...(kept as Partial<MoveableProps>),
        // Stated rather than merely omitted: these three are what the editor already flips off while
        // inline text editing, so an author reading this file finds the same three names twice.
        draggable: false,
        resizable: false,
        rotatable: false,
        clickable: false,
    };
}

/**
 * The floating toolbar rows that keep working: the ones that only navigate.
 *
 * Widget modules contribute their own rows through `createFloatingToolbarItems`, so - exactly as with
 * the top bar's plugin actions - a row this file has never heard of is disabled, not trusted.
 */
const READ_ONLY_FLOATING_TOOLBAR_IDS: ReadonlySet<string> = new Set([
    "open-linked-component",
    // The Frame's "Open <page>" arrow opens the page the frame points at in another tab. On a frozen
    // project it was greyed out, so the one way to follow a frame to its target - reading, and the
    // whole point of looking at a past version - was gone. Opening a tab writes nothing.
    "frame.open-target-page",
]);

/** Grey out every floating-toolbar row that edits, with `reason` on hover. */
export function toReadOnlyFloatingToolbarItems(
    items: FloatingToolbarItem[],
    readOnly: UIEditorReadOnly,
): FloatingToolbarItem[] {
    if (!readOnly.active) {
        return items;
    }
    return items.map(item => {
        if (READ_ONLY_FLOATING_TOOLBAR_IDS.has(item.id)) {
            return item;
        }
        return { ...item, disabled: true, tooltip: readOnly.reason ?? item.tooltip };
    });
}

/**
 * The docker bar rows that keep working: the ones that drive a preview rather than the document.
 *
 * The same shape as {@link READ_ONLY_FLOATING_TOOLBAR_IDS}, and for the same reason - a row nobody
 * remembered to name here is disabled, not trusted.
 *
 * The video widget's transport is the case that made this necessary. Play/Pause and Back-to-start
 * move a preview clock that lives in editor state; nothing about them reaches the document. On a
 * frozen project both were greyed out, which left the author looking at a still frame with no way to
 * watch the video they had opened the past version to see.
 */
const READ_ONLY_DOCKER_BAR_IDS: ReadonlySet<string> = new Set([
    "docker-video-preview-toggle",
    "docker-video-preview-restart",
]);

/**
 * Grey out the docker bar's element controls - align, order, size, and whatever a widget module adds.
 *
 * Almost every one of them writes the document, so the exemptions are named above rather than
 * derived; unlike the palette the rows are data, not JSX, which is why this is a mapper and not a
 * prop on each button. Separators pass through so the bar does not visibly rearrange itself when a
 * workspace freezes.
 */
export function toReadOnlyDockerBarItems(items: DockerBarItem[], readOnly: UIEditorReadOnly): DockerBarItem[] {
    if (!readOnly.active) {
        return items;
    }
    return items.map(item => {
        if (READ_ONLY_DOCKER_BAR_IDS.has(item.id)) {
            return item;
        }
        switch (item.kind) {
            case "separator":
                return item;
            case "number":
                // `readOnly` as well as `disabled`: a disabled number input still accepts a programmatic
                // commit from the deferred-input timer if it was mid-edit when the freeze landed.
                return { ...item, disabled: true, readOnly: true, tooltip: readOnly.reason ?? item.tooltip };
            default:
                return { ...item, disabled: true, tooltip: readOnly.reason ?? item.tooltip };
        }
    });
}
