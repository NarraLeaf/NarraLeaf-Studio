import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { DevTools } from "narraleaf-react";
import type { StoryTransformProps } from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { StoryScenePreviewController } from "./useStoryScenePreviewController";
import {
    alignFromBox,
    gizmoLiveOffsets,
    gizmoStartScale,
    gizmoTransformPatch,
    moveGizmo,
    scaleGizmo,
    STAGE_SAFE_INSET,
    writeGizmoTransform,
    type GizmoBox,
    type GizmoContainer,
    type GizmoCorner,
    type GizmoGuide,
    type GizmoStartScale,
    type StageGizmoBlockedReason,
    type StageGizmoRow,
} from "./stageGizmoModel";

/** How far a press on the box may travel and still be a click (Windows' `SM_CXDRAG`, as everywhere). */
const DRAG_SLOP_PX = 4;

/** A corner handle: drawn the same size whatever the stage's scale, like the motion editor's. */
const HANDLE_CLASS = "pointer-events-auto absolute h-2.5 w-2.5 rounded-sm border border-primary bg-white";

const CORNERS: readonly { corner: GizmoCorner; className: string }[] = [
    { corner: { sx: -1, sy: -1 }, className: "-left-1.5 -top-1.5 cursor-nwse-resize" },
    { corner: { sx: 1, sy: -1 }, className: "-right-1.5 -top-1.5 cursor-nesw-resize" },
    { corner: { sx: -1, sy: 1 }, className: "-bottom-1.5 -left-1.5 cursor-nesw-resize" },
    { corner: { sx: 1, sy: 1 }, className: "-bottom-1.5 -right-1.5 cursor-nwse-resize" },
];

const BLOCKED_KEY: Record<StageGizmoBlockedReason, "story.preview.gizmo.blockedReadOnly" | "story.preview.gizmo.blockedOperation" | "story.preview.gizmo.blockedMotion" | "story.preview.gizmo.blockedText" | "story.preview.gizmo.blockedNotSprite"> = {
    readOnly: "story.preview.gizmo.blockedReadOnly",
    operation: "story.preview.gizmo.blockedOperation",
    motion: "story.preview.gizmo.blockedMotion",
    text: "story.preview.gizmo.blockedText",
    notSprite: "story.preview.gizmo.blockedNotSprite",
};

type NlrImage = Parameters<typeof DevTools.getDisplayableTransformProps>[0];

/** What one measure of the stage found: the element, its drawn box, and the stage box it sits in. */
type Measured = {
    element: NlrImage;
    box: GizmoBox;
    container: GizmoContainer;
    /** The container's top-left inside the overlay, so a container-space box can be drawn. */
    origin: { x: number; y: number };
};

type Drag = {
    pointerId: number;
    kind: "move" | "scale";
    corner: GizmoCorner | null;
    startX: number;
    startY: number;
    start: Measured;
    startScale: GizmoStartScale;
    /** The offsets the element is drawn with, which the new shares must leave room for. */
    offsets: { xoffset?: number; yoffset?: number };
    /** The live props the drag overwrites, to put back if it is cancelled. */
    restore: Record<string, unknown>;
    moved: boolean;
};

type DragView = {
    box: GizmoBox;
    guides: GizmoGuide[];
    readout: string;
};

/**
 * Find the object on the visible stage buffer and read where it is drawn.
 *
 * The engine draws an image (a character's sprite is one) as a transform box holding a child tagged
 * with the element's id, so the id the compile gave the element leads straight to the box. Only the
 * top buffer is searched: a rebuild paints the next frame beneath it, and the two buffers' injected
 * elements share ids.
 */
function measureStageObject(
    overlay: HTMLElement,
    stageRoot: HTMLElement,
    controller: StoryScenePreviewController,
    stageKey: string,
): Measured | null {
    const stage = controller.getStageContext();
    const elements = stage?.compiled.sceneElements?.[stage.compiled.sceneId];
    const element = elements?.images.get(stageKey);
    if (!stage || !element) {
        return null;
    }
    const frames = stageRoot.querySelectorAll<HTMLElement>("[data-story-preview-frame]");
    const frame = frames[frames.length - 1];
    // Public at runtime (the engine tags the drawn box with it) though the typings keep it internal.
    const id = (element as unknown as { getId(): string }).getId();
    const tagged = frame?.querySelector<HTMLElement>(`[data-image-id="${CSS.escape(id)}"]`);
    const box = tagged?.parentElement;
    const container = box?.offsetParent;
    if (!box || !(container instanceof HTMLElement)) {
        return null;
    }
    const rect = box.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || containerRect.width <= 0 || containerRect.height <= 0) {
        return null;
    }
    return {
        element: element as unknown as NlrImage,
        box: {
            cx: rect.left + rect.width / 2 - containerRect.left,
            cy: rect.top + rect.height / 2 - containerRect.top,
            width: rect.width,
            height: rect.height,
        },
        container: { width: containerRect.width, height: containerRect.height },
        origin: { x: containerRect.left - overlayRect.left, y: containerRect.top - overlayRect.top },
    };
}

function readLiveProps(element: NlrImage): Record<string, unknown> | null {
    try {
        return DevTools.getDisplayableTransformProps(element);
    } catch {
        return null;
    }
}

/**
 * The transform box drawn over the story preview for the object the cursor's row places.
 *
 * Drag the box to move the object, drag a corner to resize it: proportional about the opposite corner,
 * Shift for each axis on its own, Alt about the centre. A move snaps the object's centre to the stage's
 * middle and thirds and its edges to the stage edges and the safe area; Cmd/Ctrl held turns that off
 * for the one drag, Shift keeps it to one axis.
 *
 * While the pointer is down only the live stage changes (`DevTools.setDisplayableTransformProps`, no
 * recompile); the row is written once, on release, so a drag is one edit and one undo step. A row that
 * cannot take a placement says why rather than letting a drag fall through to nothing.
 */
export function StoryStageGizmo(props: {
    controller: StoryScenePreviewController;
    stageRoot: HTMLElement | null;
    row: StageGizmoRow | null;
    snap: boolean;
    onCommit: (blockId: string, payload: Extract<StageGizmoRow, { kind: "editable" }>["payload"]) => void;
}) {
    const { t } = useTranslation();
    const { controller, stageRoot, row, snap, onCommit } = props;
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const [measured, setMeasured] = useState<Measured | null>(null);
    const [dragView, setDragView] = useState<DragView | null>(null);
    const dragRef = useRef<Drag | null>(null);
    const teardownRef = useRef<(() => void) | null>(null);

    const stage = controller.getStageContext();
    const arrived = Boolean(row && stage && stage.phase === "settled" && stage.targetBlockId === row.blockId);
    const editable = row?.kind === "editable" && arrived ? row : null;
    const stageKey = editable?.stageKey ?? null;
    const frameKey = controller.stageLayers.map(layer => layer.session.id).join(",");

    const remeasure = useCallback(() => {
        const overlay = overlayRef.current;
        if (!overlay || !stageRoot || !stageKey || dragRef.current) {
            return;
        }
        setMeasured(measureStageObject(overlay, stageRoot, controller, stageKey));
    }, [controller, stageKey, stageRoot]);

    // The stage moves under the gizmo whenever the engine restyles anything - a rebuild, a line, the
    // pane resizing - so watch it and measure at most once a frame.
    useLayoutEffect(() => {
        if (!stageRoot || !stageKey) {
            setMeasured(null);
            return;
        }
        remeasure();
        const view = stageRoot.ownerDocument.defaultView ?? window;
        let frame = 0;
        const schedule = () => {
            if (!frame) {
                frame = view.requestAnimationFrame(() => {
                    frame = 0;
                    remeasure();
                });
            }
        };
        const mutations = new view.MutationObserver(schedule);
        mutations.observe(stageRoot, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class", "src"] });
        const resize = new view.ResizeObserver(schedule);
        resize.observe(stageRoot);
        return () => {
            mutations.disconnect();
            resize.disconnect();
            if (frame) {
                view.cancelAnimationFrame(frame);
            }
        };
    }, [remeasure, stageKey, stageRoot, frameKey, controller.phase]);

    useEffect(() => () => teardownRef.current?.(), []);

    const applyLive = useCallback((element: NlrImage, liveProps: Record<string, unknown>) => {
        const gameState = controller.getStageContext()?.liveGame.getGameState();
        if (!gameState) {
            return;
        }
        try {
            DevTools.setDisplayableTransformProps(gameState, element, liveProps);
        } catch {
            // A transform still in flight holds the element; the box keeps following the pointer and
            // the row is still written on release.
        }
    }, [controller]);

    const beginDrag = useCallback((event: ReactPointerEvent<HTMLElement>, kind: "move" | "scale", corner: GizmoCorner | null) => {
        if (event.button !== 0 || !editable || !measured) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        teardownRef.current?.();
        const live = readLiveProps(measured.element);
        const rowProps: StoryTransformProps | undefined = editable.payload.transform?.to;
        const drag: Drag = {
            pointerId: event.pointerId,
            kind,
            corner,
            startX: event.clientX,
            startY: event.clientY,
            start: measured,
            startScale: gizmoStartScale(rowProps, live),
            offsets: gizmoLiveOffsets(live),
            restore: {
                position: live?.position,
                zoom: live?.zoom,
                scaleX: live?.scaleX,
                scaleY: live?.scaleY,
            },
            moved: false,
        };
        dragRef.current = drag;
        const designSize = controller.designSize;
        const view = event.currentTarget.ownerDocument.defaultView ?? window;

        const compute = (moveEvent: PointerEvent) => {
            const dx = moveEvent.clientX - drag.startX;
            const dy = moveEvent.clientY - drag.startY;
            if (drag.kind === "move") {
                const result = moveGizmo(drag.start.box, dx, dy, drag.start.container, {
                    snap: snap !== (moveEvent.metaKey || moveEvent.ctrlKey),
                    axisLock: moveEvent.shiftKey,
                });
                const patch = gizmoTransformPatch({
                    box: result.box,
                    container: drag.start.container,
                    position: rowProps?.position,
                    offsets: drag.offsets,
                    designSize,
                    moved: true,
                });
                const align = alignFromBox(result.box, drag.start.container);
                return {
                    patch,
                    view: {
                        box: result.box,
                        guides: result.guides,
                        readout: t("story.preview.gizmo.readoutPosition", { x: align.xalign.toFixed(3), y: align.yalign.toFixed(3) }),
                    },
                };
            }
            const free = moveEvent.shiftKey;
            const result = scaleGizmo(drag.start.box, drag.corner ?? { sx: 1, sy: 1 }, dx, dy, { free, fromCenter: moveEvent.altKey });
            const patch = gizmoTransformPatch({
                box: result.box,
                container: drag.start.container,
                position: rowProps?.position,
                offsets: drag.offsets,
                designSize,
                // About the centre the centre stays, and the row's position is left as it was written.
                moved: !moveEvent.altKey,
                scale: { factorX: result.factorX, factorY: result.factorY, free, start: drag.startScale },
            });
            return {
                patch,
                view: {
                    box: result.box,
                    guides: [],
                    readout: free
                        ? t("story.preview.gizmo.readoutScaleXY", { x: (patch.scaleX ?? 1).toFixed(2), y: (patch.scaleY ?? 1).toFixed(2) })
                        : t("story.preview.gizmo.readoutZoom", { zoom: (patch.zoom ?? 1).toFixed(2) }),
                },
            };
        };

        let lastPatch: Partial<StoryTransformProps> | null = null;
        const handleMove = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== drag.pointerId) {
                return;
            }
            if (!drag.moved) {
                if (Math.abs(moveEvent.clientX - drag.startX) < DRAG_SLOP_PX && Math.abs(moveEvent.clientY - drag.startY) < DRAG_SLOP_PX) {
                    return;
                }
                drag.moved = true;
            }
            const next = compute(moveEvent);
            lastPatch = next.patch;
            applyLive(drag.start.element, next.patch as Record<string, unknown>);
            setDragView(next.view);
        };
        const finish = (commit: boolean) => {
            teardown();
            dragRef.current = null;
            setDragView(null);
            if (!drag.moved) {
                return;
            }
            if (commit && lastPatch && Object.keys(lastPatch).length > 0) {
                onCommit(editable.blockId, writeGizmoTransform(editable.payload, lastPatch));
            } else {
                applyLive(drag.start.element, drag.restore);
            }
        };
        const handleUp = (upEvent: PointerEvent) => {
            if (upEvent.pointerId === drag.pointerId) {
                finish(true);
            }
        };
        const handleCancel = () => finish(false);
        const handleKey = (keyEvent: KeyboardEvent) => {
            if (keyEvent.key === "Escape") {
                keyEvent.preventDefault();
                keyEvent.stopPropagation();
                finish(false);
            }
        };
        const teardown = () => {
            view.removeEventListener("pointermove", handleMove, true);
            view.removeEventListener("pointerup", handleUp, true);
            view.removeEventListener("pointercancel", handleCancel, true);
            view.removeEventListener("keydown", handleKey, true);
            teardownRef.current = null;
        };
        teardownRef.current = teardown;
        // Capture phase: the box stops its own press from reaching the stage beneath (whose click
        // steps the story), and React's stopPropagation also stops the native event short of the
        // window, so a bubbling listener here would never hear the release.
        view.addEventListener("pointermove", handleMove, true);
        view.addEventListener("pointerup", handleUp, true);
        view.addEventListener("pointercancel", handleCancel, true);
        view.addEventListener("keydown", handleKey, true);
    }, [applyLive, controller.designSize, editable, measured, onCommit, snap, t]);

    const stopPress = (event: ReactPointerEvent) => event.stopPropagation();

    const blockedReason = row?.kind === "blocked" && arrived ? row.reason : null;
    const box = dragView?.box ?? measured?.box ?? null;
    const origin = measured?.origin ?? { x: 0, y: 0 };
    const container = measured?.container ?? null;

    return (
        <div ref={overlayRef} className="pointer-events-none absolute inset-0 overflow-hidden" data-story-stage-gizmo="">
            {blockedReason ? (
                <div className="absolute left-2 right-2 top-2 w-fit rounded-md bg-black/60 px-2 py-1 text-2xs text-white/85" data-story-stage-gizmo-blocked={blockedReason}>
                    {t(BLOCKED_KEY[blockedReason])}
                </div>
            ) : null}
            {dragView && container ? (
                <div className="absolute" style={{ left: origin.x, top: origin.y, width: container.width, height: container.height }}>
                    {/* The safe area, faint, for as long as a drag might want it. */}
                    <div
                        className="absolute border border-dashed border-white/25"
                        style={{
                            left: `${STAGE_SAFE_INSET * 100}%`,
                            top: `${STAGE_SAFE_INSET * 100}%`,
                            right: `${STAGE_SAFE_INSET * 100}%`,
                            bottom: `${STAGE_SAFE_INSET * 100}%`,
                        }}
                    />
                    {dragView.guides.map(guide => (
                        <div
                            key={`${guide.axis}:${guide.at}`}
                            className={cn("absolute", guide.axis === "x" ? "inset-y-0 w-px" : "inset-x-0 h-px", guide.kind === "safe" || guide.kind === "edge" ? "bg-warning" : "bg-primary")}
                            style={guide.axis === "x" ? { left: `${guide.at * 100}%` } : { top: `${guide.at * 100}%` }}
                            data-story-stage-gizmo-guide={guide.kind}
                        />
                    ))}
                </div>
            ) : null}
            {editable && box ? (
                <div
                    className="pointer-events-auto absolute cursor-move outline outline-1 outline-primary"
                    style={{
                        left: origin.x + box.cx - box.width / 2,
                        top: origin.y + box.cy - box.height / 2,
                        width: box.width,
                        height: box.height,
                        touchAction: "none",
                    }}
                    onPointerDown={event => beginDrag(event, "move", null)}
                    onPointerUp={stopPress}
                    data-story-stage-gizmo-box=""
                    data-help-topic="stagePlacement"
                    data-tip={dragView ? undefined : t("story.preview.gizmo.hint")}
                >
                    {CORNERS.map(({ corner, className }) => (
                        <div
                            key={`${corner.sx}:${corner.sy}`}
                            className={cn(HANDLE_CLASS, className)}
                            style={{ touchAction: "none" }}
                            onPointerDown={event => beginDrag(event, "scale", corner)}
                            onPointerUp={stopPress}
                            data-story-stage-gizmo-handle={`${corner.sx},${corner.sy}`}
                        />
                    ))}
                    {dragView ? (
                        <div
                            className="absolute left-1/2 whitespace-nowrap rounded-md bg-black/70 px-1.5 py-0.5 text-2xs tabular-nums text-white"
                            // Inline rather than a translate utility: the engine's injected stylesheet overrides those on the stage.
                            style={{ transform: "translateX(-50%)", ...(box.cy - box.height / 2 + origin.y > 24 ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }) }}
                            data-story-stage-gizmo-readout=""
                        >
                            {dragView.readout}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
