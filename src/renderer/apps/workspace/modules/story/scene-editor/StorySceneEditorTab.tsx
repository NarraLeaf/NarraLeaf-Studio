import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent } from "react";
import { FileText, Image as ImageIcon, ListPlus, MonitorPlay, Plus, Trash2, Variable } from "lucide-react";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useKeybindings, whenEditorFocused, type KeybindingDefinition } from "@/apps/workspace/hooks";
import type { EditorComponentProps } from "../../types";
import { PanelPosition } from "../../../registry/types";
import { Services } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import type { StoryDocument, StoryScene, StorySceneUpdate } from "@shared/types/story";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import type { StorySceneEditorTabPayload } from "./storySceneEditorTabId";
import { StoryActionCreatorPanel } from "./StoryActionCreatorPanel";
import {
    STORY_ACTION_CREATE_REQUEST_EVENT,
    STORY_ACTION_CREATOR_PANEL_ID,
    type StoryActionCreateRequestDetail,
} from "./storyActionCreatorEvents";
import { STORY_MOTION_PANEL_ID } from "../../story-motion";
import { StoryVariablesPanel, STORY_VARIABLES_PANEL_ID } from "../../story-variables";
import { InsertRow, StoryBlockRow } from "./StorySceneEditorRows";
import { StoryEditorTextStyleProvider } from "./storyEditorTextStyle";
import { getTextSegment } from "./storySceneBlockUtils";
import {
    captureStoryEditorScrollAnchor,
    getStoryEditorViewState,
    patchStoryEditorViewState,
    resolveStoryEditorRestoreScrollTop,
} from "./storyEditorSessionStore";
import { useStorySceneEditorController } from "./useStorySceneEditorController";
import { ResizableHandle } from "@/apps/workspace/components/ui/ResizableHandle";
import { StoryScenePreviewPane } from "./preview/StoryScenePreviewPane";
import { StoryScenePreviewFloat } from "./preview/StoryScenePreviewFloat";
import { useStoryScenePreviewController } from "./preview/useStoryScenePreviewController";
import {
    createDefaultStoryPreviewFloatRect,
    DEFAULT_STORY_SCENE_PREVIEW_PANE_STATE,
    getStoryScenePreviewPaneState,
    patchStoryScenePreviewPaneState,
    STORY_PREVIEW_PANE_DEFAULT_WIDTH,
    STORY_PREVIEW_PANE_MAX_FRACTION,
    STORY_PREVIEW_PANE_MIN_WIDTH,
    type StoryScenePreviewFloatRect,
    type StoryScenePreviewPaneMode,
    type StoryScenePreviewPaneState,
} from "./preview/storyScenePreviewSessionStore";

const SCENE_FIELD_LABEL_CLASS = "mb-1 block text-2xs font-medium text-fg-subtle";
const SCENE_TEXT_FIELD_CLASS = "w-full rounded-md border border-edge bg-[#16181d] px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-primary/50";

function StorySceneOverviewBlock(props: {
    document: StoryDocument;
    scene: StoryScene;
    backgroundAsset: Asset<AssetType.Image> | null;
    onUpdateScene: (patch: StorySceneUpdate) => boolean;
}) {
    const { document, scene, backgroundAsset, onUpdateScene } = props;
    const [nameValue, setNameValue] = useState(scene.name);
    const [descriptionValue, setDescriptionValue] = useState(scene.description ?? "");
    const [selectorOpen, setSelectorOpen] = useState(false);
    const selectButtonRef = useRef<HTMLButtonElement | null>(null);
    const backgroundAssetId = scene.defaultBackgroundAssetId ?? null;
    const { url, loading, error } = useAssetObjectUrl(backgroundAssetId);

    useEffect(() => {
        setNameValue(scene.name);
        setDescriptionValue(scene.description ?? "");
    }, [scene.description, scene.name]);

    const commitName = useCallback(() => {
        const nextName = nameValue.trim() || scene.name || "Untitled Scene";
        const changed = onUpdateScene({ name: nextName });
        if (!changed) {
            setNameValue(scene.name);
        }
    }, [nameValue, onUpdateScene, scene.name]);

    const commitDescription = useCallback(() => {
        const nextDescription = descriptionValue.trim();
        const changed = onUpdateScene({ description: nextDescription });
        if (!changed) {
            setDescriptionValue(scene.description ?? "");
        }
    }, [descriptionValue, onUpdateScene, scene.description]);

    const handleSelectBackground = useCallback((assets: Asset[]) => {
        const selected = assets[0];
        if (!selected) {
            return;
        }
        onUpdateScene({ defaultBackgroundAssetId: selected.id });
        setSelectorOpen(false);
    }, [onUpdateScene]);

    const clearBackground = useCallback(() => {
        onUpdateScene({ defaultBackgroundAssetId: null });
    }, [onUpdateScene]);

    const backgroundLabel = backgroundAsset?.name ?? (backgroundAssetId ? "Missing image" : "No background");

    return (
        <div className="mx-3 mb-3 rounded-lg border border-edge bg-white/[0.025] p-3">
            <div
                className="grid items-start gap-3"
                style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}
            >
                <button
                    type="button"
                    className="group relative aspect-[16/9] min-h-40 overflow-hidden rounded-md border border-edge bg-[#101216] text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/70"
                    onClick={() => setSelectorOpen(true)}
                    title={backgroundAssetId ? "Change default background" : "Select default background"}
                >
                    {url ? (
                        <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
                    ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-fg-subtle">
                            <ImageIcon className="h-6 w-6 text-fg-subtle" />
                            <span className="max-w-[80%] truncate">{backgroundLabel}</span>
                        </div>
                    )}
                    {loading ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-xs text-fg">
                            Loading...
                        </div>
                    ) : null}
                    <div className="absolute inset-x-0 bottom-0 flex min-h-9 items-center justify-between gap-2 bg-black/55 px-3 py-2 text-xs text-fg backdrop-blur-sm">
                        <span className="min-w-0 truncate">{backgroundLabel}</span>
                        <span className="shrink-0 text-primary opacity-0 transition-opacity group-hover:opacity-100">
                            {backgroundAssetId ? "Change" : "Select"}
                        </span>
                    </div>
                </button>

                <div className="grid min-w-0 gap-3">
                    <div>
                        <div className="mb-2 flex min-w-0 items-center gap-2">
                            <FileText className="h-4 w-4 shrink-0 text-primary" />
                            <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-white">{document.name}</div>
                                <div className="truncate text-2xs text-fg-subtle">{scene.runtimeName || "Untitled scene"}</div>
                            </div>
                        </div>
                        <label className={SCENE_FIELD_LABEL_CLASS}>Scene name</label>
                        <input
                            className={SCENE_TEXT_FIELD_CLASS}
                            value={nameValue}
                            maxLength={120}
                            onChange={event => setNameValue(event.target.value)}
                            onBlur={commitName}
                            onKeyDown={event => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                }
                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    setNameValue(scene.name);
                                    event.currentTarget.blur();
                                }
                            }}
                        />
                    </div>

                    <div>
                        <label className={SCENE_FIELD_LABEL_CLASS}>Description</label>
                        <textarea
                            className={`${SCENE_TEXT_FIELD_CLASS} min-h-20 resize-y leading-relaxed`}
                            value={descriptionValue}
                            rows={3}
                            maxLength={600}
                            placeholder="No description"
                            onChange={event => setDescriptionValue(event.target.value)}
                            onBlur={commitDescription}
                            onKeyDown={event => {
                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    setDescriptionValue(scene.description ?? "");
                                    event.currentTarget.blur();
                                }
                            }}
                        />
                    </div>

                    <div>
                        <label className={SCENE_FIELD_LABEL_CLASS}>Default background</label>
                        <div className="flex gap-2">
                            <button
                                ref={selectButtonRef}
                                type="button"
                                className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-edge bg-[#16181d] px-3 text-left text-sm text-fg-muted hover:border-primary/40"
                                onClick={() => setSelectorOpen(true)}
                            >
                                <ImageIcon className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                                <span className={["truncate", backgroundAsset ? "" : "italic text-fg-subtle"].join(" ")}>
                                    {backgroundLabel}
                                </span>
                            </button>
                            <button
                                type="button"
                                className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-edge bg-fill-subtle text-fg-muted hover:border-red-400/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                                disabled={!backgroundAssetId}
                                title="Clear background"
                                onClick={clearBackground}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        {backgroundAssetId && error ? (
                            <div className="mt-1 text-2xs text-amber-400/90">
                                Image asset could not be resolved: {error}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>

            <AssetSelector
                visible={selectorOpen}
                assetType={AssetType.Image}
                onClose={() => setSelectorOpen(false)}
                onConfirm={handleSelectBackground}
                selectedIds={backgroundAssetId ? [backgroundAssetId] : []}
                anchorRef={selectButtonRef}
                title="Select Default Background"
                multiple={false}
            />
        </div>
    );
}

export function StorySceneEditorTab({ tabId, payload, active }: EditorComponentProps<StorySceneEditorTabPayload | undefined>) {
    const editor = useStorySceneEditorController(tabId, payload);
    const sensors = useSensors(
        useSensor(PointerSensor),
    );
    const keybindings = useMemo<KeybindingDefinition[]>(() => [
        {
            id: "delete",
            key: "delete",
            description: "Delete selected story rows",
            handler: () => {
                void editor.deleteSelection({ confirmMultiple: false });
            },
        },
        {
            id: "backspace",
            key: "backspace",
            description: "Delete selected story rows with multi-select confirmation",
            handler: () => {
                void editor.deleteSelection({ confirmMultiple: true });
            },
        },
        {
            id: "undo",
            key: "ctrl+z",
            description: "Undo story scene edit",
            handler: editor.undoEdit,
        },
        {
            id: "redo",
            key: "ctrl+shift+z",
            description: "Redo story scene edit",
            handler: editor.redoEdit,
        },
        {
            id: "edit-active",
            key: "enter",
            description: "Edit the active row (or open its inspector)",
            handler: editor.enterEditOrInspectorForActive,
        },
        {
            id: "insert-after-active-ctrl",
            key: "ctrl+enter",
            description: "Insert a new story row below the active row",
            handler: editor.startInsertAfterActive,
        },
        {
            id: "insert-after-active-meta",
            key: "meta+enter",
            description: "Insert a new story row below the active row",
            handler: editor.startInsertAfterActive,
        },
        {
            id: "indent",
            key: "tab",
            description: "Indent selected story rows",
            handler: () => editor.indentSelection("in"),
        },
        {
            id: "outdent",
            key: "shift+tab",
            description: "Outdent selected story rows",
            handler: () => editor.indentSelection("out"),
        },
        {
            id: "select-all-ctrl",
            key: "ctrl+a",
            description: "Select all visible story rows",
            handler: editor.selectAllRows,
        },
        {
            id: "select-all-meta",
            key: "meta+a",
            description: "Select all visible story rows",
            handler: editor.selectAllRows,
        },
        {
            id: "duplicate-ctrl",
            key: "ctrl+d",
            description: "Duplicate selected story rows",
            handler: editor.duplicateSelection,
        },
        {
            id: "duplicate-meta",
            key: "meta+d",
            description: "Duplicate selected story rows",
            handler: editor.duplicateSelection,
        },
        {
            id: "move-selection-down",
            key: "arrowdown",
            description: "Move story row selection down",
            handler: () => editor.moveActiveRowSelection("down"),
        },
        {
            id: "move-selection-up",
            key: "arrowup",
            description: "Move story row selection up",
            handler: () => editor.moveActiveRowSelection("up"),
        },
        {
            id: "extend-selection-down",
            key: "shift+arrowdown",
            description: "Extend story row selection down",
            handler: () => editor.extendRowSelection("down"),
        },
        {
            id: "extend-selection-up",
            key: "shift+arrowup",
            description: "Extend story row selection up",
            handler: () => editor.extendRowSelection("up"),
        },
        {
            id: "move-row-down",
            key: "alt+arrowdown",
            description: "Move the selected story row down",
            handler: () => editor.moveSelectedRows("down"),
        },
        {
            id: "move-row-up",
            key: "alt+arrowup",
            description: "Move the selected story row up",
            handler: () => editor.moveSelectedRows("up"),
        },
        {
            id: "select-first",
            key: "home",
            description: "Select the first story row",
            handler: () => editor.jumpRowSelection("first"),
        },
        {
            id: "select-last",
            key: "end",
            description: "Select the last story row",
            handler: () => editor.jumpRowSelection("last"),
        },
        {
            id: "select-first-ctrl",
            key: "ctrl+home",
            description: "Select the first story row",
            handler: () => editor.jumpRowSelection("first"),
        },
        {
            id: "select-last-ctrl",
            key: "ctrl+end",
            description: "Select the last story row",
            handler: () => editor.jumpRowSelection("last"),
        },
        {
            id: "page-down",
            key: "pagedown",
            description: "Move story row selection down a page",
            handler: () => editor.pageRowSelection("down"),
        },
        {
            id: "page-up",
            key: "pageup",
            description: "Move story row selection up a page",
            handler: () => editor.pageRowSelection("up"),
        },
    ], [
        editor.deleteSelection,
        editor.duplicateSelection,
        editor.enterEditOrInspectorForActive,
        editor.extendRowSelection,
        editor.indentSelection,
        editor.jumpRowSelection,
        editor.moveActiveRowSelection,
        editor.moveSelectedRows,
        editor.pageRowSelection,
        editor.redoEdit,
        editor.selectAllRows,
        editor.startInsertAfterActive,
        editor.undoEdit,
    ]);

    useKeybindings({
        keybindings,
        enabled: editor.isInitialized && Boolean(editor.context && payload?.storyId && payload.sceneId),
        when: whenEditorFocused(tabId),
        idPrefix: `story-scene-editor-${tabId}`,
    });

    // Side panels are global (keyed by fixed ids), so only the visible scene tab may own them —
    // otherwise several kept-alive scene tabs would fight over the same registration. Gate on `active`.
    useEffect(() => {
        if (!active || !editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
            return;
        }
        const uiService = editor.context.services.get<UIService>(Services.UI);
        const unregister = uiService.panels.register({
            id: STORY_ACTION_CREATOR_PANEL_ID,
            title: "Actions",
            icon: <ListPlus className="w-4 h-4" />,
            position: PanelPosition.Right,
            component: StoryActionCreatorPanel,
            defaultVisible: false,
            order: 10,
            payload: {
                tabId,
                storyId: payload.storyId,
                sceneId: payload.sceneId,
            },
        });
        return () => {
            uiService.panels.hide(STORY_ACTION_CREATOR_PANEL_ID);
            unregister();
        };
    }, [active, editor.context, editor.isInitialized, payload?.sceneId, payload?.storyId, tabId]);

    useEffect(() => {
        if (!active || !editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
            return;
        }
        const uiService = editor.context.services.get<UIService>(Services.UI);
        uiService.panels.updatePayload(STORY_ACTION_CREATOR_PANEL_ID, {
            tabId,
            storyId: payload.storyId,
            sceneId: payload.sceneId,
            storyName: editor.document?.name,
            sceneName: editor.scene?.name,
        });
    }, [active, editor.context, editor.document?.name, editor.isInitialized, editor.scene?.name, payload?.sceneId, payload?.storyId, tabId]);

    useEffect(() => {
        if (!active || !editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
            return;
        }
        const uiService = editor.context.services.get<UIService>(Services.UI);
        const unregister = uiService.panels.register({
            id: STORY_VARIABLES_PANEL_ID,
            title: "Story Variables",
            icon: <Variable className="w-4 h-4" />,
            position: PanelPosition.Right,
            component: StoryVariablesPanel,
            defaultVisible: false,
            order: 11,
            payload: {
                tabId,
                storyId: payload.storyId,
                sceneId: payload.sceneId,
            },
        });
        return () => {
            uiService.panels.hide(STORY_VARIABLES_PANEL_ID);
            unregister();
        };
    }, [active, editor.context, editor.isInitialized, payload?.sceneId, payload?.storyId, tabId]);

    useEffect(() => {
        if (!active || !editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
            return;
        }
        const uiService = editor.context.services.get<UIService>(Services.UI);
        uiService.panels.updatePayload(STORY_VARIABLES_PANEL_ID, {
            tabId,
            storyId: payload.storyId,
            sceneId: payload.sceneId,
            storyName: editor.document?.name,
            sceneName: editor.scene?.name,
        });
    }, [active, editor.context, editor.document?.name, editor.isInitialized, editor.scene?.name, payload?.sceneId, payload?.storyId, tabId]);

    useEffect(() => {
        if (!active || !editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
            return;
        }
        const uiService = editor.context.services.get<UIService>(Services.UI);
        uiService.panels.updatePayload(STORY_MOTION_PANEL_ID, {
            storyId: payload.storyId,
            sceneId: payload.sceneId,
            blockId: editor.activeBlockId ?? undefined,
            storyName: editor.document?.name,
            sceneName: editor.scene?.name,
        });
    }, [active, editor.activeBlockId, editor.context, editor.document?.name, editor.isInitialized, editor.scene?.name, payload?.sceneId, payload?.storyId]);

    useEffect(() => {
        const handleCreateRequest = (event: Event) => {
            const detail = (event as CustomEvent<StoryActionCreateRequestDetail>).detail;
            if (detail?.tabId !== tabId) {
                return;
            }
            editor.createActionFromSidebar(detail.commandId);
        };
        window.addEventListener(STORY_ACTION_CREATE_REQUEST_EVENT, handleCreateRequest);
        return () => window.removeEventListener(STORY_ACTION_CREATE_REQUEST_EVENT, handleCreateRequest);
    }, [editor.createActionFromSidebar, tabId]);

    // Cold-mount restore: reposition to the author's saved place once the scene's rows are laid out.
    // With keep-alive tabs this runs only on a true cold mount (first open, app restart, or LRU
    // eviction reopen) — in-session tab switches keep the DOM mounted and are handled by the
    // hidden→shown restore below. Scroll is anchored to the focus row (not a raw pixel offset), so it
    // survives rows re-flowing after mount; we re-apply over a few frames until the target sticks.
    const scrollContainerRef = editor.scrollContainerRef;
    const sceneId = editor.scene?.id;
    const rowCount = editor.visibleRows.length;
    const deepLinkBlockId = payload?.activeBlockId ?? null;
    const panelStateService = useMemo(
        () => (editor.context && editor.isInitialized ? editor.context.services.get<PanelStateService>(Services.PanelState) : null),
        [editor.context, editor.isInitialized],
    );
    const scrollSaveRafRef = useRef<number | null>(null);
    const didRestoreRef = useRef<string | null>(null);
    // Last real scrollTop while the tab was visible (display:none reports 0), so we can put the tab
    // back where it was when it is shown again. Null until the tab has actually been scrolled/mounted.
    const liveScrollTopRef = useRef<number | null>(null);
    // Last element focused inside this editor, to restore keyboard focus that display:none blurred.
    const lastFocusedRef = useRef<HTMLElement | null>(null);
    const prevActiveRef = useRef(active);
    const handledDeepLinkRef = useRef<string | null>(null);

    useLayoutEffect(() => {
        const el = scrollContainerRef.current;
        // Skip the saved-anchor restore when opening via a deep link — the deep-link effect below
        // positions the view on the target block instead.
        if (!el || !sceneId || !panelStateService || rowCount === 0 || didRestoreRef.current === sceneId || deepLinkBlockId) {
            return;
        }
        didRestoreRef.current = sceneId;
        const view = getStoryEditorViewState(panelStateService, sceneId);
        if (!view) {
            return;
        }
        // Mount-timing safety: the container's content grows to full height over the first few frames
        // after mount (rows measure, the overview image sizes in), so a single scrollTop assignment can
        // get clamped. Re-apply each frame — recomputing the target for the current layout — until it
        // sticks (the container is tall enough to actually reach it) or we run out of the short window.
        const MAX_FRAMES = 20;
        let frame = 0;
        let rafId = 0;
        const attempt = () => {
            const target = resolveStoryEditorRestoreScrollTop(el, view);
            if (target == null) {
                return;
            }
            if (Math.abs(el.scrollTop - target) > 1) {
                el.scrollTop = target;
            }
            const stuck = Math.abs(el.scrollTop - target) <= 1;
            if ((!stuck || frame < 2) && frame++ < MAX_FRAMES) {
                rafId = window.requestAnimationFrame(attempt);
            }
        };
        attempt();
        return () => window.cancelAnimationFrame(rafId);
    }, [scrollContainerRef, sceneId, rowCount, panelStateService, deepLinkBlockId]);

    // Capture the scroll anchor at most once per frame while scrolling (querying row geometry on every
    // raw scroll event would thrash layout on long scenes). The live scrollTop is recorded eagerly so
    // the keep-alive restore has an accurate value even for the last scroll before a tab switch.
    const handleScroll = useCallback(() => {
        const el = scrollContainerRef.current;
        if (el) {
            liveScrollTopRef.current = el.scrollTop;
        }
        if (!sceneId || !panelStateService || scrollSaveRafRef.current !== null) {
            return;
        }
        scrollSaveRafRef.current = window.requestAnimationFrame(() => {
            scrollSaveRafRef.current = null;
            const el = scrollContainerRef.current;
            if (el && sceneId) {
                patchStoryEditorViewState(panelStateService, sceneId, { scroll: captureStoryEditorScrollAnchor(el) });
            }
        });
    }, [scrollContainerRef, sceneId, panelStateService]);

    useEffect(() => () => {
        if (scrollSaveRafRef.current !== null) {
            window.cancelAnimationFrame(scrollSaveRafRef.current);
            scrollSaveRafRef.current = null;
        }
    }, []);

    // Record focus moves inside the editor so keyboard focus can be restored when the tab is shown.
    const handleEditorFocusCapture = useCallback((event: ReactFocusEvent<HTMLElement>) => {
        if (event.target instanceof HTMLElement) {
            lastFocusedRef.current = event.target;
        }
    }, []);

    // Keep-alive: when the tab goes from hidden to shown, put the scroll position and keyboard focus
    // back. display:none preserves React state and the DOM subtree, but blurs focus and reports
    // scrollTop as 0 while hidden — so we re-apply the last live values on the hidden→shown edge.
    useLayoutEffect(() => {
        const wasActive = prevActiveRef.current;
        prevActiveRef.current = active;
        if (!active || wasActive) {
            return;
        }
        const el = scrollContainerRef.current;
        if (el && liveScrollTopRef.current != null && Math.abs(el.scrollTop - liveScrollTopRef.current) > 1) {
            el.scrollTop = liveScrollTopRef.current;
        }
        const target = lastFocusedRef.current;
        if (target && target.isConnected) {
            window.requestAnimationFrame(() => {
                if (lastFocusedRef.current === target && target.isConnected) {
                    target.focus();
                }
            });
        }
    }, [active, scrollContainerRef]);

    // Deep-link navigation: bring the payload's target block into view and focus the editor once its
    // row exists in the DOM (fresh open after the async load, or re-navigation to an already-open tab).
    useLayoutEffect(() => {
        if (!active || !deepLinkBlockId || handledDeepLinkRef.current === deepLinkBlockId) {
            return;
        }
        const el = scrollContainerRef.current;
        if (!el) {
            return;
        }
        const row = el.querySelector<HTMLElement>(`[data-story-row-block-id="${CSS.escape(deepLinkBlockId)}"]`);
        if (!row) {
            return; // row not laid out yet (still loading / inside a collapsed parent); re-runs on row changes
        }
        handledDeepLinkRef.current = deepLinkBlockId;
        editor.revealBlock(deepLinkBlockId);
        row.scrollIntoView({ block: "center" });
        editor.focusRoot();
    }, [active, deepLinkBlockId, rowCount, scrollContainerRef, editor.revealBlock, editor.focusRoot]);

    // Live preview pane: layout state persists globally (one workbench preference, not per-scene).
    const [previewPane, setPreviewPane] = useState<StoryScenePreviewPaneState | null>(null);
    useEffect(() => {
        if (panelStateService && previewPane === null) {
            setPreviewPane(getStoryScenePreviewPaneState(panelStateService));
        }
    }, [panelStateService, previewPane]);
    const previewOpen = previewPane?.open === true;
    const previewWidth = previewPane?.width ?? STORY_PREVIEW_PANE_DEFAULT_WIDTH;
    const previewMode: StoryScenePreviewPaneMode = previewPane?.mode ?? "dock";
    const previewFloat = previewPane?.float ?? null;
    const previewWidthRef = useRef(previewWidth);
    previewWidthRef.current = previewWidth;
    const editorBodyRef = useRef<HTMLDivElement | null>(null);

    const togglePreview = useCallback(() => {
        setPreviewPane(current => {
            const base = current ?? DEFAULT_STORY_SCENE_PREVIEW_PANE_STATE;
            const next = { ...base, open: !base.open };
            if (panelStateService) {
                patchStoryScenePreviewPaneState(panelStateService, { open: next.open });
            }
            return next;
        });
    }, [panelStateService]);

    // Switch the (open) pane between docked and picture-in-picture. Popping out for the first time
    // seeds a bottom-right float placement from the editor body's current size.
    const setPreviewMode = useCallback((mode: StoryScenePreviewPaneMode) => {
        setPreviewPane(current => {
            const base = current ?? DEFAULT_STORY_SCENE_PREVIEW_PANE_STATE;
            const el = editorBodyRef.current;
            const float = mode === "float" && base.float === null
                ? createDefaultStoryPreviewFloatRect(el ? { width: el.clientWidth, height: el.clientHeight } : null)
                : base.float;
            const next = { ...base, open: true, mode, float };
            if (panelStateService) {
                patchStoryScenePreviewPaneState(panelStateService, { open: true, mode, float });
            }
            return next;
        });
    }, [panelStateService]);

    // Persist float geometry once a drag/resize settles (called on pointer-up, not per frame).
    const commitPreviewFloat = useCallback((float: StoryScenePreviewFloatRect) => {
        setPreviewPane(current => {
            if (!current) {
                return current;
            }
            const next = { ...current, float };
            if (panelStateService) {
                patchStoryScenePreviewPaneState(panelStateService, { float });
            }
            return next;
        });
    }, [panelStateService]);

    // The handle sits on the pane's left edge: dragging right shrinks the pane. Returns the
    // unconsumed delta so ResizableHandle keeps its anchor aligned with the divider when clamped.
    const handlePreviewResize = useCallback((delta: number): number => {
        const width = previewWidthRef.current;
        const containerWidth = editorBodyRef.current?.clientWidth ?? width * 2;
        const maxWidth = Math.max(STORY_PREVIEW_PANE_MIN_WIDTH, containerWidth * STORY_PREVIEW_PANE_MAX_FRACTION);
        const nextWidth = Math.round(Math.min(maxWidth, Math.max(STORY_PREVIEW_PANE_MIN_WIDTH, width - delta)));
        if (nextWidth !== width) {
            previewWidthRef.current = nextWidth;
            setPreviewPane(current => ({ ...(current ?? DEFAULT_STORY_SCENE_PREVIEW_PANE_STATE), width: nextWidth }));
            if (panelStateService) {
                patchStoryScenePreviewPaneState(panelStateService, { width: nextWidth });
            }
        }
        return (width - nextWidth) - delta;
    }, [panelStateService]);

    const preview = useStoryScenePreviewController({
        context: editor.context,
        document: editor.document,
        scene: editor.scene,
        sceneId: payload?.sceneId ?? null,
        activeBlockId: editor.activeBlockId,
        active,
        open: previewOpen,
    });

    if (!editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-fg-muted">
                Story scene editor tab is invalid.
            </div>
        );
    }

    if (editor.loading) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-fg-muted">
                Loading story scene...
            </div>
        );
    }

    const document = editor.document;
    const scene = editor.scene;

    if (!document || !scene) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-amber-300">
                Story or scene not found.
            </div>
        );
    }

    const lastVisibleRowId = editor.visibleRows[editor.visibleRows.length - 1]?.block.id ?? null;
    const isInsertingAfterLastRow = editor.editorMode.kind === "insert" && editor.editorMode.slot.afterBlockId === lastVisibleRowId;
    const sortableRowIds = editor.visibleRows.map(row => row.block.id);
    const assetsService = editor.context.services.get<AssetsService>(Services.Assets);
    const backgroundAsset = scene.defaultBackgroundAssetId
        ? assetsService.getAssets()[AssetType.Image]?.[scene.defaultBackgroundAssetId] ?? null
        : null;
    const handleDragEnd = (event: DragEndEvent) => {
        const activeId = String(event.active.id);
        const overId = event.over ? String(event.over.id) : null;
        if (!overId || activeId === overId) {
            return;
        }
        editor.moveDraggedBlockToSortablePosition(activeId, overId);
    };

    return (
        <StoryEditorTextStyleProvider>
        <div
            ref={editor.rootRef}
            tabIndex={0}
            className="flex h-full min-h-0 flex-col bg-[#0d0f12] text-fg outline-none"
            onFocus={editor.focusWorkspace}
            onFocusCapture={handleEditorFocusCapture}
            onKeyDown={editor.handleKeyDown}
            onCopy={editor.copySelectionToClipboard}
            onPaste={editor.handlePaste}
        >
            <div className="flex min-h-[44px] items-center gap-3 border-b border-edge px-3">
                <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">{scene.name}</div>
                        <div className="truncate text-2xs text-fg-muted">{document.name}</div>
                    </div>
                </div>
            </div>

            <div ref={editorBodyRef} className="relative flex min-h-0 flex-1 flex-row">
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <div
                ref={editor.scrollContainerRef}
                className="min-h-0 flex-1 overflow-auto py-2"
                onMouseDown={editor.focusRoot}
                onScroll={handleScroll}
            >
                <StorySceneOverviewBlock
                    document={document}
                    scene={scene}
                    backgroundAsset={backgroundAsset}
                    onUpdateScene={editor.updateSceneMetadata}
                />
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={sortableRowIds} strategy={verticalListSortingStrategy}>
                        {editor.visibleRows.map(row => (
                            <div key={row.block.id}>
                                <StoryBlockRow
                                    row={row}
                                    scene={scene}
                                    document={document}
                                    characters={editor.characters}
                                    selected={editor.selectedBlockIds.has(row.block.id)}
                                    active={editor.activeBlockId === row.block.id}
                                    collapsed={editor.collapsedBlockIds.has(row.block.id)}
                                    editing={editor.editorMode.kind === "text" && editor.editorMode.blockId === row.block.id}
                                    editInitialCaret={editor.editorMode.kind === "text" && editor.editorMode.blockId === row.block.id ? (editor.editorMode.caret ?? "end") : undefined}
                                    textInputRef={editor.textInputRef}
                                    inspectorOpen={editor.editorMode.kind === "inspector" && editor.editorMode.blockId === row.block.id}
                                    onSelect={event => editor.selectRow(row.block.id, event)}
                                    onMouseDown={event => editor.beginDragSelection(row.block.id, event)}
                                    onMouseEnter={() => editor.extendDragSelection(row.block.id)}
                                    onToggleCollapsed={() => editor.toggleCollapsed(row.block.id)}
                                    onStartTextEdit={() => {
                                        const text = getTextSegment(row.block);
                                        if (text) {
                                            editor.setEditorMode({ kind: "text", blockId: row.block.id, value: text.value, rich: text.rich });
                                        }
                                    }}
                                    onEditRichChange={(value, rich) =>
                                        editor.setEditorMode(current =>
                                            current.kind === "text" && current.blockId === row.block.id
                                                ? { ...current, value, rich }
                                                : current,
                                        )
                                    }
                                    onCommitTextEdit={editor.commitTextEdit}
                                    onCancelTextEdit={() => { editor.setEditorMode({ kind: "idle" }); editor.focusRoot(); }}
                                    onContinue={editor.insertContinuationAfterCurrentTextEdit}
                                    onArrowOut={editor.navigateFromTextEdit}
                                    onBackspaceAtEmptyStart={editor.handleBackspaceAtEmptyStart}
                                    onOpenInspector={() => editor.setEditorMode({ kind: "inspector", blockId: row.block.id })}
                                    onCloseInspector={() => editor.setEditorMode({ kind: "idle" })}
                                    onUpdatePayload={payload => editor.updateBlockPayloadFor(row.block.id, payload)}
                                    onSetDialogueCharacter={characterId => editor.setDialogueCharacter(row.block, characterId)}
                                    generateTextId={() => editor.uuidService?.generate() ?? crypto.randomUUID()}
                                    onCreateLayer={beforeBlockId => editor.createLayerBeforeBlock(beforeBlockId)}
                                    onInsertAfter={() => editor.startInsertAfter(row.block.id, true)}
                                />
                                {editor.shouldRenderActiveInsertSlot && editor.editorMode.kind === "insert" && editor.editorMode.slot.afterBlockId === row.block.id ? (
                                    <InsertRow
                                        mode={editor.editorMode}
                                        characters={editor.characters}
                                        inputRef={editor.insertInputRef}
                                        onValueChange={editor.handleInsertValueChange}
                                        onCommitNarration={focusNext => editor.commitNarrationFromInsert(focusNext)}
                                        onCancelActionChooser={() => editor.commitNarrationFromInsert(false)}
                                        onChooseCommand={editor.chooseCommand}
                                        onChooseCharacter={editor.chooseCharacterForInsert}
                                    />
                                ) : null}
                            </div>
                        ))}
                    </SortableContext>
                </DndContext>
                {editor.editorMode.kind === "insert" && editor.editorMode.slot.afterBlockId === null ? (
                    <InsertRow
                        mode={editor.editorMode}
                        characters={editor.characters}
                        inputRef={editor.insertInputRef}
                        onValueChange={editor.handleInsertValueChange}
                        onCommitNarration={focusNext => editor.commitNarrationFromInsert(focusNext)}
                        onCancelActionChooser={() => editor.commitNarrationFromInsert(false)}
                        onChooseCommand={editor.chooseCommand}
                        onChooseCharacter={editor.chooseCharacterForInsert}
                    />
                ) : isInsertingAfterLastRow ? null : (
                    <button
                        type="button"
                        className="mt-1 flex min-h-[32px] w-full items-center gap-2 pl-[64px] pr-3 text-left text-sm italic text-fg-subtle hover:bg-fill-subtle hover:text-fg-muted"
                        onClick={() => editor.startInsertAfter(null, true)}
                    >
                        <Plus className="h-4 w-4 text-primary" />
                        Click or type to add a row...
                    </button>
                )}
                {/* Always keep roughly one screen (minus a row) of empty scroll space below the
                    content so the last row can be scrolled up to the top of the editor. The height is
                    a percentage of the (definite, flex-sized) scroll container, so no measurement is
                    needed and scroll-position restore keeps working. */}
                <div aria-hidden style={{ height: "calc(100% - 40px)" }} />
            </div>
            <button
                type="button"
                className={`absolute bottom-3 right-3 z-[5] flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1.5 text-xs shadow-lg transition-colors ${previewOpen ? "bg-primary/20 text-primary" : "bg-surface-sunken text-fg-muted hover:bg-fill"}`}
                onClick={togglePreview}
                title={previewOpen ? "Close live preview" : "Open live preview"}
            >
                <MonitorPlay className="h-4 w-4" />
                Preview
            </button>
            </div>
            {previewOpen && previewMode === "dock" ? (
                <>
                    <ResizableHandle
                        direction="horizontal"
                        onResize={handlePreviewResize}
                        className="w-1 shrink-0 border-r-2 border-transparent bg-fill-subtle"
                    />
                    <div style={{ width: previewWidth }} className="min-h-0 shrink-0 border-l border-edge">
                        <StoryScenePreviewPane
                            controller={preview}
                            onClose={togglePreview}
                            mode="dock"
                            onToggleFloat={() => setPreviewMode("float")}
                        />
                    </div>
                </>
            ) : null}
            {previewOpen && previewMode === "float" ? (
                <StoryScenePreviewFloat
                    controller={preview}
                    containerRef={editorBodyRef}
                    initialRect={previewFloat ?? createDefaultStoryPreviewFloatRect(null)}
                    onClose={togglePreview}
                    onToggleDock={() => setPreviewMode("dock")}
                    onCommit={commitPreviewFloat}
                />
            ) : null}
            </div>
        </div>
        </StoryEditorTextStyleProvider>
    );
}
