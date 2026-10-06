import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import type { StoryBlockId, StoryDocument, StoryId } from "@shared/types/story";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { useWorkspace } from "../../../../context";
import { useRegistry } from "../../../../registry";
import { getStoryEditorViewState, patchStoryEditorViewState } from "../storyEditorSessionStore";
import { StoryScenePreviewFloat } from "./StoryScenePreviewFloat";
import { useStoryScenePreviewController } from "./useStoryScenePreviewController";
import {
    getStoryPreviewHub,
    useStoryPreviewHubValue,
    useStoryPreviewLayout,
    type StoryPreviewHub,
} from "./storyPreviewHub";
import {
    createDefaultStoryPreviewFloatRect,
    migrateEditorBodyStoryPreviewFloatRect,
    readRectInArea,
    type StoryPreviewFloatBounds,
} from "./storyPreviewFloatGeometry";
import { trackStoryPreviewFloatOwner } from "./storyPreviewFloatTracking";
import { findStorySceneTab } from "./storyPreviewFloatOwner";
import type { StoryScenePreviewFloatRect } from "./storyScenePreviewSessionStore";

type AreaBox = { left: number; top: number; width: number; height: number };

const selectTarget = (hub: StoryPreviewHub) => hub.getTarget();

/**
 * The floating live preview: one per workspace window, drawn over the whole content area.
 *
 * The window belongs to the workspace rather than to a scene editor, so it survives the author moving
 * to another editor. It shows the scene of the story scene tab focused most recently (see
 * `storyPreviewFloatOwner`), follows that tab's cursor, and a press on its stage moves that cursor -
 * whether or not the tab is on screen.
 *
 * It is drawn in its own layer over the content area (`WorkspaceLayout` hands over the area), above
 * the docks and the editors and below everything the window root ranks higher: dialogs, the command
 * palette, toasts, and the menus and tooltips portalled to the body.
 */
export function StoryScenePreviewFloatHost(props: { areaRef: RefObject<HTMLElement | null> }) {
    const { areaRef } = props;
    const { context, isInitialized } = useWorkspace();
    const hub = useMemo(() => (context && isInitialized ? getStoryPreviewHub(context) : null), [context, isInitialized]);
    useStoryPreviewFloatOwner(context, hub);

    const area = useAreaBox(areaRef, hub);
    const bounds = useMemo<StoryPreviewFloatBounds | null>(
        () => (area ? { width: Math.floor(area.width), height: Math.floor(area.height) } : null),
        [area],
    );

    const layout = useStoryPreviewLayout(hub);
    const targetTabId = useStoryPreviewHubValue(hub, selectTarget, null);
    const { editorLayout, setActiveEditorTab } = useRegistry();
    const target = useMemo(() => findStorySceneTab(editorLayout, targetTabId), [editorLayout, targetTabId]);
    const floating = layout?.open === true && layout.mode === "float" && target !== null;

    const storyId = target?.payload.storyId ?? null;
    const sceneId = target?.payload.sceneId ?? null;
    const document = useStoryDocument(context, floating ? storyId : null);
    const scene = document && sceneId ? document.scenes[sceneId] ?? null : null;

    const panelState = useMemo(
        () => (context && isInitialized ? context.services.get<PanelStateService>(Services.PanelState) : null),
        [context, isInitialized],
    );
    // The cursor the tab last published; before it has (its tab not mounted this session), the one
    // the tab will restore when it is.
    const publishedCursor = useStoryPreviewHubValue<StoryBlockId | null | undefined>(
        hub,
        useCallback(h => h.getCursor(sceneId), [sceneId]),
        undefined,
    );
    const cursor = publishedCursor !== undefined
        ? publishedCursor
        : panelState && sceneId ? getStoryEditorViewState(panelState, sceneId)?.activeBlockId ?? null : null;

    /**
     * A press on the stage moves the cursor of the scene it shows.
     *
     * A mounted tab - on screen or kept alive behind another one - moves its own cursor, exactly as
     * the docked pane does. A tab the keep-alive limit has unmounted has no editor to move, so the
     * cursor is written where that editor will read it back when it is opened again: its saved view
     * state. The scroll anchor goes with it, so the reopened editor brings the cursor into view
     * instead of returning to a place the author has since read past.
     */
    const stepTo = useCallback((blockId: StoryBlockId) => {
        if (!hub || !targetTabId || !sceneId) {
            return;
        }
        const handle = hub.getTab(targetTabId);
        if (handle) {
            handle.stepTo(blockId);
            return;
        }
        if (panelState) {
            patchStoryEditorViewState(panelState, sceneId, { activeBlockId: blockId, selectedBlockIds: [blockId], scroll: undefined });
        }
        hub.publishCursor(sceneId, blockId);
    }, [hub, panelState, sceneId, targetTabId]);
    // An unmounted tab's filter and folds are not known here; every row counts as shown.
    const isRowShown = useCallback((blockId: StoryBlockId) => hub?.getTab(targetTabId)?.isRowShown(blockId) ?? true, [hub, targetTabId]);

    const controller = useStoryScenePreviewController({
        context,
        document,
        scene,
        sceneId,
        activeBlockId: cursor,
        active: true,
        open: floating,
        onStepTo: stepTo,
        isRowShown,
    });

    // The rect as stored, read in the workspace's frame. A rect an older build measured against the
    // scene editor's body is carried over the first time the window is shown, and written back so
    // the conversion happens once - never again later, which would make the window jump.
    const targetHandle = useStoryPreviewHubValue(hub, useCallback(h => h.getTab(targetTabId), [targetTabId]), undefined);
    const editorBodyOffsetNow = (): { x: number; y: number } | null => {
        const handle = hub?.getTab(targetTabId);
        return handle ? readRectInArea(handle.editorBody(), hub?.getArea() ?? null) : null;
    };
    let rect: StoryScenePreviewFloatRect | null = null;
    if (layout && floating) {
        if (!layout.float) {
            rect = createDefaultStoryPreviewFloatRect(bounds, readRectInArea(targetHandle?.editorBody() ?? null, hub?.getArea() ?? null));
        } else {
            rect = layout.floatFrame === "editorBody"
                ? migrateEditorBodyStoryPreviewFloatRect(layout.float, editorBodyOffsetNow())
                : layout.float;
        }
    }
    const legacyRect = floating && layout?.floatFrame === "editorBody" ? layout.float : null;
    useEffect(() => {
        // Measured here rather than in render: the tab registers itself in the same commit that
        // first shows the window, after this component rendered.
        if (hub && legacyRect) {
            hub.patchLayout({ float: migrateEditorBodyStoryPreviewFloatRect(legacyRect, editorBodyOffsetNow()) });
        }
        // `editorBodyOffsetNow` reads the hub as it is when this runs; it is not a dependency.
    }, [hub, legacyRect]);

    const close = useCallback(() => hub?.patchLayout({ open: false }), [hub]);
    const commit = useCallback((next: StoryScenePreviewFloatRect) => hub?.patchLayout({ float: next }), [hub]);
    // Docking puts the preview back into the scene editor it is showing, and brings that editor forward.
    const dock = useCallback(() => {
        if (!hub || !target || !context) {
            return;
        }
        hub.patchLayout({ open: true, mode: "dock" });
        setActiveEditorTab(target.tabId, target.groupId);
        context.services.get<UIService>(Services.UI).focus.setFocus(FocusArea.Editor, target.tabId);
    }, [context, hub, setActiveEditorTab, target]);

    if (!floating || !area || !rect) {
        return null;
    }
    return (
        // The layer covers the content area and nothing else, so the window can never reach the
        // title bar or the status bar. It takes no pointer input itself and never scrolls.
        <div
            className="pointer-events-none fixed z-40 overflow-hidden"
            style={{ left: area.left, top: area.top, width: area.width, height: area.height }}
            data-story-preview-float-layer=""
        >
            <StoryScenePreviewFloat
                controller={controller}
                bounds={bounds}
                rect={rect}
                sceneName={scene?.name ?? null}
                onClose={close}
                onDock={dock}
                onCommit={commit}
            />
        </div>
    );
}

/** Keep the hub's focus order current for as long as the workspace is up. */
function useStoryPreviewFloatOwner(context: WorkspaceContext | null, hub: StoryPreviewHub | null): void {
    useEffect(() => {
        if (!context || !hub) {
            return;
        }
        const ui = context.services.get<UIService>(Services.UI);
        return trackStoryPreviewFloatOwner({ store: ui.getStore(), focus: ui.focus }, hub);
    }, [context, hub]);
}

/**
 * Where the content area is on screen, kept current through window resizes and anything that grows
 * or shrinks the rows above and below it. Registered with the hub, which tabs ask when placing a
 * window over themselves.
 */
function useAreaBox(areaRef: RefObject<HTMLElement | null>, hub: StoryPreviewHub | null): AreaBox | null {
    const [box, setBox] = useState<AreaBox | null>(null);
    useLayoutEffect(() => {
        const element = areaRef.current;
        hub?.setArea(element);
        if (!element) {
            return;
        }
        const measure = () => {
            const rect = element.getBoundingClientRect();
            const next = rect.width >= 1 && rect.height >= 1
                ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
                : null;
            setBox(previous => (
                previous && next
                && previous.left === next.left && previous.top === next.top
                && previous.width === next.width && previous.height === next.height
                    ? previous
                    : next
            ));
        };
        measure();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
        observer?.observe(element);
        const view = element.ownerDocument.defaultView;
        view?.addEventListener("resize", measure);
        return () => {
            observer?.disconnect();
            view?.removeEventListener("resize", measure);
            if (hub?.getArea() === element) {
                hub.setArea(null);
            }
        };
    }, [areaRef, hub]);
    return box;
}

/** A story document, loaded once and kept current with its edits. */
function useStoryDocument(context: WorkspaceContext | null, storyId: StoryId | null): StoryDocument | null {
    const [state, setState] = useState<{ storyId: StoryId; document: StoryDocument } | null>(null);
    useEffect(() => {
        if (!context || !storyId) {
            return;
        }
        const storyService = context.services.get<StoryService>(Services.Story);
        let cancelled = false;
        storyService.loadStory(storyId)
            .then(document => {
                if (!cancelled) {
                    setState({ storyId, document: { ...document } });
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setState(null);
                }
            });
        const unsubscribe = storyService.onDocumentChanged(event => {
            if (event.storyId === storyId) {
                setState({ storyId, document: { ...event.document } });
            }
        });
        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [context, storyId]);
    // A document still loading for a different story is not this story's.
    return state && state.storyId === storyId ? state.document : null;
}
