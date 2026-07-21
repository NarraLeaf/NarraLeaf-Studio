import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { FocusArea } from "@/lib/workspace/services/ui";
import type { EditorGroup } from "@/apps/workspace/registry/types";
import { isWorkspaceAssetDragEvent } from "@/apps/workspace/modules/assets/dnd/assetDragContract";
import {
    EDITOR_TAB_DRAG_MIME,
    decodeEditorTabDragPayload,
    getActiveEditorTabDrag,
    isEditorTabDragEvent,
} from "@/apps/workspace/dnd/editorTabDragContract";
import { useAssetDragResolver } from "@/apps/workspace/dnd/useAssetDragResolver";
import {
    openAssetPreviewTabsInEditor,
    setWorkspaceSelectionToPrimaryAsset,
} from "@/apps/workspace/modules/assets/dnd/openDraggedAssetsInEditor";
import {
    editorDropZoneToSplit,
    resolveEditorDropZone,
    resolveTabInsertIndex,
    type EditorDropZone,
} from "./editorDropZones";

/** Caret position for a tab being dropped into the strip. */
export interface EditorTabInsertion {
    /** Index the tab lands at, in strip order. */
    index: number;
    /** Caret offset in px from the strip content's left edge (scroll included). */
    offset: number;
}

/** Distance from a strip edge, in px, within which a hovering drag scrolls the strip. */
const STRIP_AUTOSCROLL_ZONE = 48;
/** px per animation frame at the very edge; tapers to zero at the far side of the zone. */
const STRIP_AUTOSCROLL_SPEED = 12;

/**
 * Drop target for a whole editor group: assets and tab headers both land here.
 *
 * Two landing modes, chosen by what the pointer is over:
 * - the tab strip → the drag is a reorder/move into this group, previewed by an insertion caret;
 * - the pane body → a five-way zone, previewed by the overlay. Center adds a tab, the four edge
 *   bands split the group and put the dropped editor in the new pane.
 *
 * One set of handlers on the group root drives both, rather than a second target on the strip:
 * a nested drop target would swallow the enter/leave pairs the outer counter needs to know when
 * the drag has really left the group.
 */
export function useEditorGroupDrop(group: EditorGroup) {
    const { context } = useWorkspace();
    const { buildAssetDropContext } = useAssetDragResolver();
    const stripRef = useRef<HTMLDivElement | null>(null);
    const enterCounter = useRef(0);
    const [zone, setZone] = useState<EditorDropZone | null>(null);
    const [insertion, setInsertion] = useState<EditorTabInsertion | null>(null);

    const autoScrollFrame = useRef<number | null>(null);
    const autoScrollSpeed = useRef(0);

    const stopAutoScroll = useCallback(() => {
        if (autoScrollFrame.current !== null) {
            cancelAnimationFrame(autoScrollFrame.current);
            autoScrollFrame.current = null;
        }
        autoScrollSpeed.current = 0;
    }, []);

    /**
     * Scroll an overflowing tab strip while a drag hovers near its edge - without it, a tab can
     * only ever be dropped among the headers that happen to be visible.
     */
    const updateAutoScroll = useCallback(
        (clientX: number) => {
            const strip = stripRef.current;
            if (!strip || strip.scrollWidth <= strip.clientWidth) {
                stopAutoScroll();
                return;
            }
            const rect = strip.getBoundingClientRect();
            const fromLeft = clientX - rect.left;
            const fromRight = rect.right - clientX;

            let speed = 0;
            if (fromLeft < STRIP_AUTOSCROLL_ZONE) {
                speed = -STRIP_AUTOSCROLL_SPEED * (1 - Math.max(0, fromLeft) / STRIP_AUTOSCROLL_ZONE);
            } else if (fromRight < STRIP_AUTOSCROLL_ZONE) {
                speed = STRIP_AUTOSCROLL_SPEED * (1 - Math.max(0, fromRight) / STRIP_AUTOSCROLL_ZONE);
            }
            autoScrollSpeed.current = speed;

            if (speed === 0) {
                stopAutoScroll();
                return;
            }
            if (autoScrollFrame.current !== null) {
                return;
            }
            const step = () => {
                const el = stripRef.current;
                if (!el || autoScrollSpeed.current === 0) {
                    autoScrollFrame.current = null;
                    return;
                }
                el.scrollLeft += autoScrollSpeed.current;
                autoScrollFrame.current = requestAnimationFrame(step);
            };
            autoScrollFrame.current = requestAnimationFrame(step);
        },
        [stopAutoScroll],
    );

    const clearFeedback = useCallback(() => {
        enterCounter.current = 0;
        setZone(null);
        setInsertion(null);
        stopAutoScroll();
    }, [stopAutoScroll]);

    useEffect(() => stopAutoScroll, [stopAutoScroll]);

    /** Where a pointer at (x, y) would land, or null when the drag is not droppable here. */
    const resolveTarget = useCallback(
        (
            currentTarget: Element,
            eventTarget: EventTarget | null,
            x: number,
            y: number,
            isTabDrag: boolean,
        ): { kind: "strip"; insertion: EditorTabInsertion } | { kind: "zone"; zone: EditorDropZone } | null => {
            const strip = stripRef.current;
            const overStrip = strip !== null && eventTarget instanceof Node && strip.contains(eventTarget);

            if (overStrip && !isTabDrag) {
                // The strip sits inside the pane's top edge band, but dropping an asset on the tab
                // bar means "open it here", never "split downward".
                return { kind: "zone", zone: "center" };
            }

            if (overStrip && strip) {
                const stripRect = strip.getBoundingClientRect();
                const headers = Array.from(strip.querySelectorAll<HTMLElement>("[data-editor-tab-id]"));
                const rects = headers.map((header) => {
                    const rect = header.getBoundingClientRect();
                    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
                });
                const index = resolveTabInsertIndex(rects, x);
                const edge = index < rects.length ? rects[index].left : rects[rects.length - 1]?.left ?? stripRect.left;
                const width = index < rects.length ? 0 : rects[rects.length - 1]?.width ?? 0;
                return {
                    kind: "strip",
                    insertion: { index, offset: edge - stripRect.left + strip.scrollLeft + width },
                };
            }

            const rect = currentTarget.getBoundingClientRect();
            const resolved = resolveEditorDropZone(
                { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                x,
                y,
            );

            if (isTabDrag && resolved !== "center") {
                // Splitting this group's only tab off itself would empty the source pane, which then
                // collapses straight back - so that edge is not a real target while it is the source.
                const session = getActiveEditorTabDrag();
                if (session?.groupId === group.id && group.tabs.length < 2) {
                    return null;
                }
            }
            return { kind: "zone", zone: resolved };
        },
        [group.id, group.tabs.length],
    );

    const updateFeedback = useCallback(
        (e: DragEvent<Element>) => {
            const isTabDrag = isEditorTabDragEvent(e.dataTransfer);
            const target = resolveTarget(e.currentTarget, e.target, e.clientX, e.clientY, isTabDrag);
            if (!target) {
                setZone(null);
                setInsertion(null);
                stopAutoScroll();
                e.dataTransfer.dropEffect = "none";
                return;
            }
            if (target.kind === "strip") {
                setZone(null);
                setInsertion(target.insertion);
                updateAutoScroll(e.clientX);
            } else {
                setInsertion(null);
                setZone(target.zone);
                stopAutoScroll();
            }
            e.dataTransfer.dropEffect = isTabDrag ? "move" : "copy";
        },
        [resolveTarget],
    );

    const isDroppable = useCallback(
        (dt: DataTransfer) => isEditorTabDragEvent(dt) || isWorkspaceAssetDragEvent(dt),
        [],
    );

    const onDragEnter = useCallback(
        (e: DragEvent<Element>) => {
            if (!isDroppable(e.dataTransfer)) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            enterCounter.current += 1;
            updateFeedback(e);
        },
        [isDroppable, updateFeedback],
    );

    const onDragOver = useCallback(
        (e: DragEvent<Element>) => {
            if (!isDroppable(e.dataTransfer)) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            updateFeedback(e);
        },
        [isDroppable, updateFeedback],
    );

    const onDragLeave = useCallback(
        (e: DragEvent<Element>) => {
            if (!isDroppable(e.dataTransfer)) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            enterCounter.current = Math.max(0, enterCounter.current - 1);
            if (enterCounter.current === 0) {
                setZone(null);
                setInsertion(null);
                stopAutoScroll();
            }
        },
        [isDroppable, stopAutoScroll],
    );

    const onDrop = useCallback(
        (e: DragEvent<Element>) => {
            if (!isDroppable(e.dataTransfer)) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const isTabDrag = isEditorTabDragEvent(e.dataTransfer);
            const target = resolveTarget(e.currentTarget, e.target, e.clientX, e.clientY, isTabDrag);
            clearFeedback();
            if (!target || !context) {
                return;
            }
            const uiService = context.services.get<UIService>(Services.UI);

            if (isTabDrag) {
                const payload = decodeEditorTabDragPayload(e.dataTransfer.getData(EDITOR_TAB_DRAG_MIME));
                if (!payload) {
                    return;
                }
                const store = uiService.getStore();
                const split = target.kind === "zone" ? editorDropZoneToSplit(target.zone) : null;
                const moved = split
                    ? store.moveEditorTabToNewSplit(payload.t, payload.g, group.id, split.direction, split.side)
                    : store.moveEditorTabToGroup(
                          payload.t,
                          payload.g,
                          group.id,
                          target.kind === "strip" ? target.insertion.index : undefined,
                      );
                if (moved) {
                    uiService.focus.setFocus(FocusArea.Editor, payload.t);
                }
                return;
            }

            const assetDrop = buildAssetDropContext(e.dataTransfer, "drop");
            if (!assetDrop || assetDrop.resolved.length === 0) {
                return;
            }
            const primary = assetDrop.resolved.find(a => a.id === assetDrop.wire.p) ?? assetDrop.resolved[0];
            setWorkspaceSelectionToPrimaryAsset(context, primary);
            openAssetPreviewTabsInEditor(context, assetDrop.resolved, {
                groupId: group.id,
                // Splitting happens inside, only once there is something previewable to open -
                // otherwise an edge drop of a non-previewable asset would strand an empty pane.
                splitInto: target.kind === "zone" ? editorDropZoneToSplit(target.zone) ?? undefined : undefined,
            });
        },
        [buildAssetDropContext, clearFeedback, context, group.id, isDroppable, resolveTarget],
    );

    return {
        dropTargetProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
        stripRef,
        zone,
        insertion,
    };
}
