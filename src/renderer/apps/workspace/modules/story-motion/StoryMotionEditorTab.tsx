import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
    KeyboardEvent as ReactKeyboardEvent,
    MouseEvent as ReactMouseEvent,
    PointerEvent as ReactPointerEvent,
    WheelEvent as ReactWheelEvent,
} from "react";
import { Activity, Pause, Play, Plus, Trash2 } from "lucide-react";
import type {
    StoryAnimationAsset,
    StoryAnimationKeyframe,
    StoryAnimationKeyframeValue,
    StoryAnimationTimeline,
    StoryAnimationTrack,
    StoryAnimationTrackProperty,
    StoryDocument,
} from "@shared/types/story";
import { FocusArea, type EditorTabComponentProps } from "@/lib/workspace/services/ui/types";
import type { EditorTabDefinition } from "../../registry/types";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { BaseProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { Button } from "@/lib/components/elements/Button";
import { Select, type SelectOption } from "@/lib/components/elements/Select";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import {
    STORY_MOTION_KEYFRAME_SELECTION_TYPE,
    isStoryMotionKeyframeSelectionData,
    type StoryMotionEditorPayload,
} from "./storyMotionTypes";
import {
    STORY_MOTION_FPS,
    STORY_MOTION_MAX_DURATION_MS,
    STORY_MOTION_PROPERTIES,
    clampStoryMotionTimeMs,
    deleteStoryMotionTrack,
    ensureStoryMotionTrack,
    formatStoryMotionTime,
    getStoryMotionDurationMs,
    getStoryMotionPropertyMeta,
    getStoryMotionTimeline,
    isStoryMotionEditableProperty,
    sampleStoryMotionPreview,
    updateStoryMotionKeyframe,
    upsertStoryMotionKeyframe,
} from "./storyMotionTimeline";
import { StoryMotionStagePreview } from "./StoryMotionStagePreview";
import { resolveStoryMotionPreviewTarget } from "./storyMotionPreviewTarget";

const ICON_BUTTON_CLASS = controlButtonClass();
const ROW_HEIGHT = 34;
const MIN_TIMELINE_WIDTH = 760;
const DEFAULT_STAGE_SIZE = { width: 1280, height: 720 };
const PREVIEW_CANVAS_PADDING = 2048;
const MIN_STAGE_ZOOM = 0.2;
const MAX_STAGE_ZOOM = 4;
const STORY_MOTION_EDITOR_STATE_PREFIX = "storyMotion.editorState";

type StoryMotionPreviewViewportState = {
    scrollLeft: number;
    scrollTop: number;
    zoom: number;
};

type StoryMotionEditorPanelState = {
    previewViewport?: StoryMotionPreviewViewportState;
    playheadMs?: number;
    selectedKeyframeId?: string | null;
    selectedAddProperty?: StoryAnimationTrackProperty;
};

export function createStoryMotionEditorTab(payload: StoryMotionEditorPayload): EditorTabDefinition<StoryMotionEditorPayload> {
    return {
        id: `story-motion:${payload.animationId}`,
        title: "Story Motion",
        icon: <Activity className="h-4 w-4" />,
        component: StoryMotionEditorTab,
        payload,
        closable: true,
        modified: false,
    };
}

export function StoryMotionEditorTab({ tabId, payload }: EditorTabComponentProps<StoryMotionEditorPayload>) {
    const { context, isInitialized } = useWorkspace();
    const storyService = useMemo(
        () => context && isInitialized ? context.services.get<StoryService>(Services.Story) : null,
        [context, isInitialized],
    );
    const projectService = useMemo(
        () => context && isInitialized ? context.services.get<ProjectService>(Services.Project) : null,
        [context, isInitialized],
    );
    const uiService = useMemo(
        () => context && isInitialized ? context.services.get<UIService>(Services.UI) : null,
        [context, isInitialized],
    );
    const panelStateService = useMemo(
        () => context && isInitialized ? context.services.get<PanelStateService>(Services.PanelState) : null,
        [context, isInitialized],
    );
    const editorStatePanelId = useMemo(() => getStoryMotionEditorStatePanelId(tabId), [tabId]);
    const editorRootRef = useRef<HTMLDivElement | null>(null);
    const previewViewportRef = useRef<HTMLDivElement | null>(null);
    const latestEditorStateRef = useRef<StoryMotionEditorPanelState>({});
    const restoredEditorStateRef = useRef<string | null>(null);
    const initializedPreviewViewportRef = useRef<string | null>(null);
    const previewPanRef = useRef<{
        active: boolean;
        pointerId: number | null;
        startX: number;
        startY: number;
        startScrollLeft: number;
        startScrollTop: number;
    }>({
        active: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        startScrollLeft: 0,
        startScrollTop: 0,
    });
    const [asset, setAsset] = useState<StoryAnimationAsset | null>(null);
    const [document, setDocument] = useState<StoryDocument | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [playheadMs, setPlayheadMs] = useState(0);
    const [playing, setPlaying] = useState(false);
    const timelineZoom = 1;
    const [stageZoom, setStageZoom] = useState(1);
    const [previewPanning, setPreviewPanning] = useState(false);
    const autoKey = true;
    const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
    const [selectedAddProperty, setSelectedAddProperty] = useState<StoryAnimationTrackProperty>("position");
    const [previewOverride, setPreviewOverride] = useState<Partial<ReturnType<typeof sampleStoryMotionPreview>> | null>(null);

    useEffect(() => {
        if (!storyService || !payload?.animationId) {
            setAsset(null);
            return;
        }
        let disposed = false;
        setLoadError(null);
        void storyService.loadAnimationAsset(payload.animationId)
            .then(next => {
                if (!disposed) {
                    setAsset(next);
                    setPlayheadMs(current => Math.min(current, getStoryMotionDurationMs(next.timeline)));
                }
            })
            .catch(error => {
                if (!disposed) {
                    setAsset(null);
                    setLoadError(error instanceof Error ? error.message : String(error));
                }
            });
        return () => {
            disposed = true;
        };
    }, [payload?.animationId, storyService]);

    useEffect(() => {
        if (!storyService || !payload?.animationId) {
            return;
        }
        let disposed = false;
        const unsubscribe = storyService.onAnimationsChanged(index => {
            const entry = index.animations.find(item => item.id === payload.animationId);
            if (!entry) {
                setAsset(null);
                setLoadError("Motion asset was deleted.");
                const selection = uiService?.getStore().getSelection();
                if (
                    selection?.type === STORY_MOTION_KEYFRAME_SELECTION_TYPE
                    && isStoryMotionKeyframeSelectionData(selection.data)
                    && selection.data.animationId === payload.animationId
                ) {
                    uiService?.getStore().setSelection({ type: null, data: null });
                }
                return;
            }
            void storyService.loadAnimationAsset(payload.animationId)
                .then(next => {
                    if (!disposed) {
                        setAsset(next);
                    }
                })
                .catch(() => {
                    if (!disposed) {
                        setAsset(current => current
                            ? { ...current, name: entry.name, targetKind: entry.targetKind }
                            : current);
                    }
                });
        });
        return () => {
            disposed = true;
            unsubscribe();
        };
    }, [payload?.animationId, storyService, uiService]);

    useEffect(() => {
        if (!storyService || !payload?.actionContext?.storyId) {
            setDocument(null);
            return;
        }
        let disposed = false;
        void storyService.loadStory(payload.actionContext.storyId)
            .then(next => {
                if (!disposed) {
                    setDocument(next);
                }
            })
            .catch(() => {
                if (!disposed) {
                    setDocument(null);
                }
            });
        const dispose = storyService.onDocumentChanged(event => {
            if (event.storyId === payload.actionContext?.storyId) {
                setDocument(event.document);
            }
        });
        return () => {
            disposed = true;
            dispose();
        };
    }, [payload?.actionContext?.storyId, storyService]);

    const timeline = useMemo(() => getStoryMotionTimeline(asset), [asset]);
    const durationMs = getStoryMotionDurationMs(timeline);
    const timelineDurationMs = STORY_MOTION_MAX_DURATION_MS;
    const pxPerMs = 0.18 * timelineZoom;
    const timelineWidth = Math.max(MIN_TIMELINE_WIDTH, timelineDurationMs * pxPerMs + 80);
    const tracks = useMemo(() => orderTracks(timeline.tracks.filter(track => isStoryMotionEditableProperty(track.property))), [timeline.tracks]);
    const selected = useMemo(() => findKeyframe(timeline, selectedKeyframeId), [selectedKeyframeId, timeline]);
    const addPropertyOptions = useMemo<SelectOption[]>(() => {
        const existing = new Set(tracks.map(track => track.property));
        return STORY_MOTION_PROPERTIES
            .filter(item => !existing.has(item.property))
            .map(item => ({
                value: item.property,
                label: item.label,
            }));
    }, [tracks]);
    const preview = sampleStoryMotionPreview(timeline, playheadMs);
    const visiblePreview = previewOverride
        ? { ...preview, ...previewOverride, position: previewOverride.position ?? preview.position }
        : preview;
    const previewTarget = useMemo(() => resolveStoryMotionPreviewTarget({
        document,
        sceneId: payload?.actionContext?.sceneId,
        blockId: payload?.actionContext?.blockId,
        fallbackKind: asset?.targetKind ?? "image",
        fallbackLabel: asset?.name ?? "Displayable",
    }), [asset?.name, asset?.targetKind, document, payload?.actionContext?.blockId, payload?.actionContext?.sceneId]);
    const stageSize = useMemo(() => resolveProjectStageSize(projectService), [projectService]);

    useEffect(() => {
        if (selectedKeyframeId && !selected) {
            setSelectedKeyframeId(null);
        }
    }, [selected, selectedKeyframeId]);

    useEffect(() => {
        if (addPropertyOptions.length === 0) {
            return;
        }
        if (!addPropertyOptions.some(option => option.value === selectedAddProperty)) {
            setSelectedAddProperty(addPropertyOptions[0].value as StoryAnimationTrackProperty);
        }
    }, [addPropertyOptions, selectedAddProperty]);

    const readEditorPanelState = useCallback(() => (
        panelStateService
            ? normalizeStoryMotionEditorPanelState(panelStateService.getPanelState<StoryMotionEditorPanelState>(editorStatePanelId))
            : {}
    ), [editorStatePanelId, panelStateService]);

    const persistEditorPanelState = useCallback((patch: Partial<StoryMotionEditorPanelState>) => {
        if (!panelStateService) {
            return;
        }
        const current = readEditorPanelState();
        panelStateService.setPanelState<StoryMotionEditorPanelState>(editorStatePanelId, {
            ...current,
            ...patch,
        });
    }, [editorStatePanelId, panelStateService, readEditorPanelState]);

    useEffect(() => {
        if (!playing) {
            return;
        }
        const startedAt = performance.now() - playheadMs;
        const timer = window.setInterval(() => {
            const next = performance.now() - startedAt;
            if (next >= durationMs) {
                setPlayheadMs(durationMs);
                setPlaying(false);
                return;
            }
            setPlayheadMs(next);
        }, 16);
        return () => window.clearInterval(timer);
    }, [durationMs, playing, playheadMs]);

    useEffect(() => {
        editorRootRef.current?.focus();
    }, [payload?.animationId]);

    useEffect(() => {
        if (!asset || !payload?.animationId) {
            return;
        }
        const restoreKey = `${editorStatePanelId}:${payload.animationId}`;
        if (restoredEditorStateRef.current === restoreKey) {
            return;
        }
        const saved = readEditorPanelState();
        setStageZoom(saved.previewViewport?.zoom ?? 1);
        setPlayheadMs(clampNumber(saved.playheadMs, 0, timelineDurationMs, 0));
        setSelectedKeyframeId(saved.selectedKeyframeId && findKeyframe(timeline, saved.selectedKeyframeId)
            ? saved.selectedKeyframeId
            : null);
        if (saved.selectedAddProperty) {
            setSelectedAddProperty(saved.selectedAddProperty);
        }
        restoredEditorStateRef.current = restoreKey;
        initializedPreviewViewportRef.current = null;
    }, [asset, editorStatePanelId, payload?.animationId, readEditorPanelState, timeline, timelineDurationMs]);

    useEffect(() => {
        if (!asset || !payload?.animationId) {
            return;
        }
        const viewport = previewViewportRef.current;
        if (!viewport) {
            return;
        }
        const restoreKey = `${editorStatePanelId}:${payload.animationId}`;
        if (restoredEditorStateRef.current !== restoreKey) {
            return;
        }
        const viewportKey = `${restoreKey}:${stageSize.width}x${stageSize.height}`;
        if (initializedPreviewViewportRef.current === viewportKey) {
            return;
        }
        const saved = readEditorPanelState().previewViewport;
        if (saved && Math.abs(saved.zoom - stageZoom) > 0.001) {
            return;
        }
        const frame = window.requestAnimationFrame(() => {
            if (saved) {
                viewport.scrollLeft = saved.scrollLeft;
                viewport.scrollTop = saved.scrollTop;
            } else {
                centerPreviewViewport(viewport, stageSize, stageZoom);
            }
            initializedPreviewViewportRef.current = viewportKey;
        });
        return () => window.cancelAnimationFrame(frame);
    }, [asset, editorStatePanelId, payload?.animationId, readEditorPanelState, stageSize, stageZoom]);

    useEffect(() => {
        const viewport = previewViewportRef.current;
        latestEditorStateRef.current = {
            previewViewport: viewport
                ? {
                    scrollLeft: viewport.scrollLeft,
                    scrollTop: viewport.scrollTop,
                    zoom: stageZoom,
                }
                : latestEditorStateRef.current.previewViewport,
            playheadMs,
            selectedKeyframeId,
            selectedAddProperty,
        };
    }, [playheadMs, selectedAddProperty, selectedKeyframeId, stageZoom]);

    useEffect(() => () => {
        const viewport = previewViewportRef.current;
        persistEditorPanelState({
            ...latestEditorStateRef.current,
            previewViewport: viewport
                ? {
                    scrollLeft: viewport.scrollLeft,
                    scrollTop: viewport.scrollTop,
                    zoom: stageZoom,
                }
                : latestEditorStateRef.current.previewViewport,
        });
    }, [persistEditorPanelState, stageZoom]);

    useEffect(() => {
        if (playing) {
            return;
        }
        persistEditorPanelState({
            playheadMs,
            selectedKeyframeId,
            selectedAddProperty,
        });
    }, [persistEditorPanelState, playheadMs, playing, selectedAddProperty, selectedKeyframeId]);

    const focusEditor = useCallback(() => {
        editorRootRef.current?.focus();
        uiService?.focus.setFocus(FocusArea.Editor, tabId);
    }, [tabId, uiService]);

    const togglePlayback = useCallback(() => {
        setPlaying(current => {
            if (current) {
                return false;
            }
            setPlayheadMs(currentTime => currentTime >= durationMs ? 0 : currentTime);
            return true;
        });
    }, [durationMs]);

    const handleEditorKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== " ") {
            return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest("input, textarea, select, [contenteditable='true']")) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        togglePlayback();
    }, [togglePlayback]);

    const updateAsset = useCallback((updater: (asset: StoryAnimationAsset) => StoryAnimationAsset) => {
        if (!storyService || !asset) {
            return;
        }
        const next = storyService.updateAnimationAsset(asset.id, updater);
        setAsset(next);
    }, [asset, storyService]);

    const updateTimeline = useCallback((updater: (timeline: StoryAnimationTimeline) => StoryAnimationTimeline) => {
        updateAsset(current => ({
            ...current,
            timeline: updater(getStoryMotionTimeline(current)),
        }));
    }, [updateAsset]);

    const scrubToClientX = useCallback((clientX: number, rect: DOMRect) => {
        const next = clampStoryMotionTimeMs((clientX - rect.left) / pxPerMs);
        setPlayheadMs(next);
    }, [pxPerMs]);

    const startPlayheadDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        scrubToClientX(event.clientX, rect);
        const onMove = (moveEvent: PointerEvent) => scrubToClientX(moveEvent.clientX, rect);
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }, [scrubToClientX]);

    const selectKeyframe = useCallback((track: StoryAnimationTrack, keyframe: StoryAnimationKeyframe) => {
        setSelectedKeyframeId(keyframe.id);
        if (!uiService || !payload?.animationId) {
            return;
        }
        uiService.getStore().setSelection({
            type: STORY_MOTION_KEYFRAME_SELECTION_TYPE,
            data: {
                editor: "story-motion",
                tabId,
                animationId: payload.animationId,
                trackId: track.id,
                keyframeId: keyframe.id,
            },
        });
        uiService.panels.show("narraleaf-studio:properties");
    }, [payload?.animationId, tabId, uiService]);

    const startKeyframeDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>, track: StoryAnimationTrack, keyframe: StoryAnimationKeyframe) => {
        event.stopPropagation();
        selectKeyframe(track, keyframe);
        const startX = event.clientX;
        const startTime = keyframe.timeMs;
        const onMove = (moveEvent: PointerEvent) => {
            const nextTime = clampStoryMotionTimeMs(startTime + (moveEvent.clientX - startX) / pxPerMs);
            updateTimeline(current => updateStoryMotionKeyframe(current, keyframe.id, currentKeyframe => ({
                ...currentKeyframe,
                timeMs: nextTime,
            })));
            setPlayheadMs(nextTime);
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }, [pxPerMs, selectKeyframe, updateTimeline]);

    const deleteTrack = useCallback((track: StoryAnimationTrack) => {
        if (selectedKeyframeId && track.keyframes.some(keyframe => keyframe.id === selectedKeyframeId)) {
            setSelectedKeyframeId(null);
        }
        const selection = uiService?.getStore().getSelection();
        if (
            selection?.type === STORY_MOTION_KEYFRAME_SELECTION_TYPE
            && isStoryMotionKeyframeSelectionData(selection.data)
            && selection.data.animationId === payload?.animationId
            && selection.data.trackId === track.id
        ) {
            uiService?.getStore().setSelection({ type: null, data: null });
        }
        updateTimeline(current => deleteStoryMotionTrack(current, track.id));
    }, [payload?.animationId, selectedKeyframeId, uiService, updateTimeline]);

    const startPreviewDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, mode: "position" | "zoom" | "rotation") => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startY = event.clientY;
        const startPreview = visiblePreview;
        let latestValue: StoryAnimationKeyframeValue | null = null;
        let latestProperty: StoryAnimationTrackProperty | null = null;
        const onMove = (moveEvent: PointerEvent) => {
            const dx = (moveEvent.clientX - startX) / stageZoom;
            const dy = (moveEvent.clientY - startY) / stageZoom;
            if (mode === "position") {
                const position = {
                    ...startPreview.position,
                    xoffset: startPreview.position.xoffset + dx,
                    yoffset: startPreview.position.yoffset + dy,
                };
                latestProperty = "position";
                latestValue = position;
                setPreviewOverride({ position });
            } else if (mode === "zoom") {
                const zoomValue = Math.max(0.1, startPreview.zoom + dx / 180);
                latestProperty = "zoom";
                latestValue = Number(zoomValue.toFixed(3));
                setPreviewOverride({ zoom: zoomValue });
            } else {
                const rotation = startPreview.rotation + dx / 2;
                latestProperty = "rotation";
                latestValue = Number(rotation.toFixed(2));
                setPreviewOverride({ rotation });
            }
        };
        const onUp = () => {
            if (autoKey && latestProperty && latestValue !== null) {
                updateTimeline(current => upsertStoryMotionKeyframe(current, latestProperty!, playheadMs, latestValue!, "easeOut"));
            }
            setPreviewOverride(null);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }, [autoKey, playheadMs, stageZoom, updateTimeline, visiblePreview]);

    const handlePreviewPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        focusEditor();
        if (event.button !== 1 || !previewViewportRef.current) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const viewport = previewViewportRef.current;
        previewPanRef.current = {
            active: true,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startScrollLeft: viewport.scrollLeft,
            startScrollTop: viewport.scrollTop,
        };
        setPreviewPanning(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
    }, [focusEditor]);

    const handlePreviewPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const pan = previewPanRef.current;
        const viewport = previewViewportRef.current;
        if (!pan.active || pan.pointerId !== event.pointerId || !viewport) {
            return;
        }
        event.preventDefault();
        viewport.scrollLeft = pan.startScrollLeft - (event.clientX - pan.startX);
        viewport.scrollTop = pan.startScrollTop - (event.clientY - pan.startY);
    }, []);

    const persistCurrentPreviewViewport = useCallback(() => {
        const viewport = previewViewportRef.current;
        if (!viewport) {
            return;
        }
        const previewViewport = normalizeStoryMotionPreviewViewport({
            scrollLeft: viewport.scrollLeft,
            scrollTop: viewport.scrollTop,
            zoom: stageZoom,
        });
        if (!previewViewport) {
            return;
        }
        latestEditorStateRef.current = {
            ...latestEditorStateRef.current,
            previewViewport,
        };
        persistEditorPanelState({ previewViewport });
    }, [persistEditorPanelState, stageZoom]);

    const stopPreviewPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const pan = previewPanRef.current;
        if (!pan.active || pan.pointerId !== event.pointerId) {
            return;
        }
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        previewPanRef.current = {
            active: false,
            pointerId: null,
            startX: 0,
            startY: 0,
            startScrollLeft: 0,
            startScrollTop: 0,
        };
        setPreviewPanning(false);
        persistCurrentPreviewViewport();
    }, [persistCurrentPreviewViewport]);

    const handlePreviewAuxClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.button === 1) {
            event.preventDefault();
        }
    }, []);

    const handlePreviewWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
        if (!event.ctrlKey) {
            return;
        }
        const viewport = previewViewportRef.current;
        if (!viewport) {
            return;
        }
        event.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        setStageZoom(current => {
            const next = clampStageZoom(current * Math.exp(-event.deltaY * 0.0015));
            if (next === current) {
                return current;
            }
            const contentX = (viewport.scrollLeft + pointerX - PREVIEW_CANVAS_PADDING) / current;
            const contentY = (viewport.scrollTop + pointerY - PREVIEW_CANVAS_PADDING) / current;
            window.requestAnimationFrame(() => {
                const scrollLeft = contentX * next + PREVIEW_CANVAS_PADDING - pointerX;
                const scrollTop = contentY * next + PREVIEW_CANVAS_PADDING - pointerY;
                viewport.scrollLeft = scrollLeft;
                viewport.scrollTop = scrollTop;
                const previewViewport = normalizeStoryMotionPreviewViewport({
                    scrollLeft,
                    scrollTop,
                    zoom: next,
                });
                if (previewViewport) {
                    latestEditorStateRef.current = {
                        ...latestEditorStateRef.current,
                        previewViewport,
                    };
                    persistEditorPanelState({ previewViewport });
                }
            });
            return next;
        });
    }, [persistEditorPanelState]);

    const handlePreviewScroll = useCallback(() => {
        persistCurrentPreviewViewport();
    }, [persistCurrentPreviewViewport]);

    const handleTimelineWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
        if (!event.shiftKey) {
            return;
        }
        const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        const delta = normalizeWheelDelta(rawDelta, event.deltaMode, event.currentTarget.clientWidth);
        if (delta === 0) {
            return;
        }
        event.preventDefault();
        event.currentTarget.scrollLeft += delta;
    }, []);

    if (!asset) {
        return (
            <div className="flex h-full items-center justify-center bg-[#101114] text-sm text-slate-400">
                {loadError ?? "Loading motion asset..."}
            </div>
        );
    }

    return (
        <div
            ref={editorRootRef}
            className="flex h-full min-h-0 flex-col bg-[#101114] text-slate-200 outline-none"
            tabIndex={-1}
            onKeyDownCapture={handleEditorKeyDown}
            onMouseDownCapture={focusEditor}
        >
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-3">
                <div className="min-w-0 flex-[0_1_320px] truncate text-sm font-medium text-slate-100" title={asset.name}>
                    {asset.name}
                </div>
                <button className={ICON_BUTTON_CLASS} type="button" onClick={togglePlayback} title={playing ? "Pause" : "Play"}>
                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <input
                    className="h-1.5 min-w-32 flex-1 accent-primary"
                    type="range"
                    min={0}
                    max={timelineDurationMs}
                    value={Math.min(playheadMs, timelineDurationMs)}
                    onChange={event => setPlayheadMs(clampNumber(Number(event.target.value), 0, timelineDurationMs, 0))}
                />
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1">
                <div className="flex min-h-0 flex-col">
                    <div
                        ref={previewViewportRef}
                        className={`min-h-0 flex-1 overflow-auto bg-[#0f1115] ${previewPanning ? "cursor-grabbing" : "cursor-default"}`}
                        onPointerDown={handlePreviewPointerDown}
                        onPointerMove={handlePreviewPointerMove}
                        onPointerUp={stopPreviewPan}
                        onPointerCancel={stopPreviewPan}
                        onAuxClick={handlePreviewAuxClick}
                        onWheel={handlePreviewWheel}
                        onScroll={handlePreviewScroll}
                    >
                        <div
                            className="relative min-w-max"
                            style={{
                                width: stageSize.width * stageZoom + PREVIEW_CANVAS_PADDING * 2,
                                height: stageSize.height * stageZoom + PREVIEW_CANVAS_PADDING * 2,
                            }}
                        >
                            <div
                                className="absolute"
                                style={{
                                    left: PREVIEW_CANVAS_PADDING,
                                    top: PREVIEW_CANVAS_PADDING,
                                    width: stageSize.width * stageZoom,
                                    height: stageSize.height * stageZoom,
                                }}
                            >
                                <div
                                    className="absolute left-0 top-0"
                                    style={{
                                        width: stageSize.width,
                                        height: stageSize.height,
                                        transform: `scale(${stageZoom})`,
                                        transformOrigin: "top left",
                                    }}
                                >
                                    <StoryMotionStagePreview
                                        preview={visiblePreview}
                                        target={previewTarget}
                                        onPointerDrag={startPreviewDrag}
                                        stageSize={stageSize}
                                        showLabel={false}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="h-64 shrink-0 border-t border-white/10 bg-[#0f1013]">
                        <div className="flex h-12 items-center gap-3 border-b border-white/10 px-3">
                            <div className="w-[168px] text-xs font-medium text-slate-300">Animated properties</div>
                            <Select
                                className="w-44"
                                size="md"
                                options={addPropertyOptions}
                                value={selectedAddProperty}
                                onChange={value => setSelectedAddProperty(value as StoryAnimationTrackProperty)}
                                placeholder="Add property"
                                disabled={addPropertyOptions.length === 0}
                                portalMenu
                                menuZIndex={80}
                            />
                            <Button
                                variant="secondary"
                                size="md"
                                type="button"
                                onClick={() => updateTimeline(current => ensureStoryMotionTrack(current, selectedAddProperty))}
                                disabled={addPropertyOptions.length === 0}
                                className="shrink-0"
                            >
                                <Plus className="h-3.5 w-3.5" />
                                Add property
                            </Button>
                        </div>
                        <div className="h-[calc(100%-48px)] overflow-auto overscroll-contain" onWheel={handleTimelineWheel}>
                            <div
                                className="grid"
                                style={{
                                    width: 180 + timelineWidth,
                                    minWidth: "100%",
                                    gridTemplateColumns: `180px ${timelineWidth}px`,
                                }}
                            >
                                <div className="sticky left-0 top-0 z-40 flex h-8 items-center border-r border-b border-white/10 bg-[#0f1013] px-3 text-xs font-medium text-slate-300">
                                    Property
                                </div>
                                <div className="sticky top-0 z-30 h-8 border-b border-white/10 bg-[#0f1013]" onPointerDown={startPlayheadDrag}>
                                    {buildTicks(timelineDurationMs, timelineZoom, STORY_MOTION_FPS).map(tick => (
                                        <div key={tick.timeMs} className="absolute top-0 h-full border-l border-white/10" style={{ left: tick.timeMs * pxPerMs }}>
                                            <span className="ml-1 text-[10px] text-slate-500">{tick.label}</span>
                                        </div>
                                    ))}
                                    <div className="absolute top-0 z-20 h-full w-px bg-orange-400" style={{ left: playheadMs * pxPerMs }}>
                                        <div className="-ml-1.5 h-3 w-3 rounded-sm bg-orange-400 rotate-45" />
                                    </div>
                                </div>
                                {tracks.map(track => (
                                    <Fragment key={track.id}>
                                        <div className="group sticky left-0 z-20 flex h-[34px] items-center gap-2 border-r border-b border-white/[0.06] bg-[#0f1013] px-3 text-xs text-slate-400">
                                            <span className="min-w-0 flex-1 truncate">{getStoryMotionPropertyMeta(track.property).label}</span>
                                            <button
                                                type="button"
                                                className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-500 opacity-0 transition group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400/50"
                                                onClick={event => {
                                                    event.stopPropagation();
                                                    deleteTrack(track);
                                                }}
                                                onPointerDown={event => event.stopPropagation()}
                                                title="Delete track"
                                                aria-label={`Delete ${getStoryMotionPropertyMeta(track.property).label} track`}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                        <div className="relative h-[34px] border-b border-white/[0.06]">
                                            <div className="absolute top-0 z-20 h-full w-px bg-orange-400/90" style={{ left: playheadMs * pxPerMs }} />
                                            {track.keyframes.map(keyframe => (
                                                <button
                                                    key={keyframe.id}
                                                    type="button"
                                                    className={[
                                                        "absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border",
                                                        selectedKeyframeId === keyframe.id
                                                            ? "border-orange-300 bg-orange-400"
                                                            : "border-primary/80 bg-[#1f9eff]",
                                                    ].join(" ")}
                                                    style={{ left: keyframe.timeMs * pxPerMs }}
                                                    onClick={() => selectKeyframe(track, keyframe)}
                                                    onPointerDown={event => startKeyframeDrag(event, track, keyframe)}
                                                    title={`${getStoryMotionPropertyMeta(track.property).label} ${formatStoryMotionTime(keyframe.timeMs, STORY_MOTION_FPS)}`}
                                                />
                                            ))}
                                            <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-white/[0.04]" />
                                        </div>
                                    </Fragment>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}

function findKeyframe(timeline: StoryAnimationTimeline, keyframeId: string | null): { track: StoryAnimationTrack; keyframe: StoryAnimationKeyframe } | null {
    if (!keyframeId) {
        return null;
    }
    for (const track of timeline.tracks) {
        if (!isStoryMotionEditableProperty(track.property)) {
            continue;
        }
        const keyframe = track.keyframes.find(item => item.id === keyframeId);
        if (keyframe) {
            return { track, keyframe };
        }
    }
    return null;
}

function orderTracks(tracks: StoryAnimationTrack[]): StoryAnimationTrack[] {
    return [...tracks].sort((a, b) => {
        const left = STORY_MOTION_PROPERTIES.findIndex(item => item.property === a.property);
        const right = STORY_MOTION_PROPERTIES.findIndex(item => item.property === b.property);
        return left - right || a.id.localeCompare(b.id);
    });
}

function getStoryMotionEditorStatePanelId(tabId: string): string {
    return `${STORY_MOTION_EDITOR_STATE_PREFIX}:${tabId}`;
}

function normalizeStoryMotionEditorPanelState(raw: unknown): StoryMotionEditorPanelState {
    if (!raw || typeof raw !== "object") {
        return {};
    }
    const record = raw as Record<string, unknown>;
    const state: StoryMotionEditorPanelState = {};
    const previewViewport = normalizeStoryMotionPreviewViewport(record.previewViewport);
    if (previewViewport) {
        state.previewViewport = previewViewport;
    }
    const playheadMs = Number(record.playheadMs);
    if (Number.isFinite(playheadMs) && playheadMs >= 0) {
        state.playheadMs = playheadMs;
    }
    if (record.selectedKeyframeId === null || typeof record.selectedKeyframeId === "string") {
        state.selectedKeyframeId = record.selectedKeyframeId;
    }
    if (isStoryMotionTrackPropertyValue(record.selectedAddProperty)) {
        state.selectedAddProperty = record.selectedAddProperty;
    }
    return state;
}

function normalizeStoryMotionPreviewViewport(raw: unknown): StoryMotionPreviewViewportState | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const scrollLeft = Number(record.scrollLeft);
    const scrollTop = Number(record.scrollTop);
    const zoom = Number(record.zoom);
    if (!Number.isFinite(scrollLeft) || !Number.isFinite(scrollTop) || !Number.isFinite(zoom) || zoom <= 0) {
        return null;
    }
    return {
        scrollLeft,
        scrollTop,
        zoom: clampStageZoom(zoom),
    };
}

function isStoryMotionTrackPropertyValue(value: unknown): value is StoryAnimationTrackProperty {
    return typeof value === "string" && isStoryMotionEditableProperty(value as StoryAnimationTrackProperty);
}

function centerPreviewViewport(
    viewport: HTMLDivElement,
    stageSize: { width: number; height: number },
    zoom: number,
): void {
    viewport.scrollLeft = PREVIEW_CANVAS_PADDING + stageSize.width * zoom / 2 - viewport.clientWidth / 2;
    viewport.scrollTop = PREVIEW_CANVAS_PADDING + stageSize.height * zoom / 2 - viewport.clientHeight / 2;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const next = Number(value);
    if (!Number.isFinite(next)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, next));
}

function normalizeWheelDelta(delta: number, deltaMode: number, pageSize: number): number {
    if (!Number.isFinite(delta)) {
        return 0;
    }
    if (deltaMode === 1) {
        return delta * 16;
    }
    if (deltaMode === 2) {
        return delta * pageSize;
    }
    return delta;
}

function buildTicks(durationMs: number, zoom: number, fps: number): { timeMs: number; label: string }[] {
    const step = zoom > 1.5 ? 500 : zoom > 0.85 ? 1000 : 2500;
    const ticks: { timeMs: number; label: string }[] = [];
    for (let timeMs = 0; timeMs <= durationMs + step; timeMs += step) {
        const clamped = Math.min(durationMs, timeMs);
        const frame = Math.round((clamped / 1000) * fps);
        ticks.push({
            timeMs: clamped,
            label: `${(clamped / 1000).toFixed(clamped % 1000 === 0 ? 0 : 2)}s f${frame}`,
        });
        if (clamped === durationMs) {
            break;
        }
    }
    return ticks;
}

function resolveProjectStageSize(projectService: ProjectService | null): { width: number; height: number } {
    try {
        const resolution = projectService?.getProjectConfig().metadata.resolution as unknown;
        if (!resolution) {
            return DEFAULT_STAGE_SIZE;
        }
        if (typeof resolution === "string") {
            const parsed = BaseProjectService.parseResolution(resolution);
            return sanitizeStageSize(parsed.width, parsed.height);
        }
        if (typeof resolution === "object") {
            const value = resolution as { width?: unknown; height?: unknown };
            return sanitizeStageSize(Number(value.width), Number(value.height));
        }
    } catch {
        return DEFAULT_STAGE_SIZE;
    }
    return DEFAULT_STAGE_SIZE;
}

function sanitizeStageSize(width: number, height: number): { width: number; height: number } {
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        return DEFAULT_STAGE_SIZE;
    }
    return {
        width: Math.round(width),
        height: Math.round(height),
    };
}

function clampStageZoom(value: number): number {
    if (!Number.isFinite(value)) {
        return 1;
    }
    return Math.min(MAX_STAGE_ZOOM, Math.max(MIN_STAGE_ZOOM, value));
}
