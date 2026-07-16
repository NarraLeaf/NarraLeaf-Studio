import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
    KeyboardEvent as ReactKeyboardEvent,
    MouseEvent as ReactMouseEvent,
    PointerEvent as ReactPointerEvent,
    WheelEvent as ReactWheelEvent,
} from "react";
import { Diamond, Pause, Play, Plus, Spline, Trash2 } from "lucide-react";
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
import { useKeybindings, whenEditorFocused, type KeybindingDefinition } from "@/apps/workspace/hooks";
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
import { useTranslation } from "@/lib/i18n";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import {
    STORY_MOTION_KEYFRAME_SELECTION_TYPE,
    isStoryMotionKeyframeSelectionData,
    type StoryMotionEditorPayload,
} from "./storyMotionTypes";
import {
    STORY_MOTION_FPS,
    STORY_MOTION_PROPERTIES,
    clampStoryMotionTimeMs,
    deleteStoryMotionKeyframe,
    deleteStoryMotionTrack,
    ensureStoryMotionTrack,
    formatStoryMotionTime,
    getStoryMotionDurationMs,
    getStoryMotionPropertyMeta,
    getStoryMotionTimeline,
    sampleStoryMotionPreview,
    sampleStoryMotionTrackValue,
    snapStoryMotionTimeToFrame,
    stepStoryMotionTimeByFrames,
    updateStoryMotionKeyframe,
    upsertStoryMotionKeyframe,
} from "./storyMotionTimeline";
import { StoryMotionStagePreview, type StoryMotionPreviewDragMode } from "./StoryMotionStagePreview";
import { resolveStoryMotionPreviewTarget } from "./storyMotionPreviewTarget";

const ICON_BUTTON_CLASS = controlButtonClass();
const MIN_TIMELINE_WIDTH = 760;
const DEFAULT_STAGE_SIZE = { width: 1280, height: 720 };
const PREVIEW_CANVAS_PADDING = 2048;
const MIN_STAGE_ZOOM = 0.2;
const MAX_STAGE_ZOOM = 4;
const STORY_MOTION_EDITOR_STATE_PREFIX = "storyMotion.editorState";
const TIMELINE_LEFT_COL_PX = 180;
const DEFAULT_TIMELINE_PX_PER_MS = 0.18;
const MIN_TIMELINE_PX_PER_MS = 0.002;
const MAX_TIMELINE_PX_PER_MS = 5;
const TIMELINE_TICK_STEPS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
const TIMELINE_TICK_MIN_PX = 70;
const TIMELINE_TICK_BUFFER_PX = 200;
const TIMELINE_SCROLL_HEADROOM_PX = 240;
const TIMELINE_PLAYHEAD_SNAP_PX = 8;
const TIMELINE_UNDO_LIMIT = 100;
const TIMELINE_UNDO_COALESCE_MS = 800;

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
    timelinePxPerMs?: number;
};

export function createStoryMotionEditorTab(payload: StoryMotionEditorPayload): EditorTabDefinition<StoryMotionEditorPayload> {
    return {
        id: `story-motion:${payload.animationId}`,
        title: "Story Motion",
        icon: <Spline className="h-4 w-4" />,
        component: StoryMotionEditorTab,
        payload,
        closable: true,
        modified: false,
    };
}

export function StoryMotionEditorTab({ tabId, payload, active }: EditorTabComponentProps<StoryMotionEditorPayload>) {
    const { t } = useTranslation();
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
    const [timelinePxPerMs, setTimelinePxPerMs] = useState<number | null>(null);
    const [timelineViewport, setTimelineViewport] = useState({ width: 0, scrollLeft: 0 });
    const [keyframeDrag, setKeyframeDrag] = useState<{ keyframeId: string; timeMs: number } | null>(null);
    const [stageZoom, setStageZoom] = useState(1);
    const [previewPanning, setPreviewPanning] = useState(false);
    const autoKey = true;
    const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
    const [selectedAddProperty, setSelectedAddProperty] = useState<StoryAnimationTrackProperty>("position");
    const [previewOverride, setPreviewOverride] = useState<Partial<ReturnType<typeof sampleStoryMotionPreview>> | null>(null);
    const timelineScrollRef = useRef<HTMLDivElement | null>(null);
    const timelineFitInitializedRef = useRef<string | null>(null);
    const playheadRef = useRef(0);
    const durationRef = useRef(0);
    const undoStackRef = useRef<StoryAnimationTimeline[]>([]);
    const redoStackRef = useRef<StoryAnimationTimeline[]>([]);
    const lastObservedTimelineRef = useRef<{ json: string; timeline: StoryAnimationTimeline } | null>(null);
    const lastTimelineRecordAtRef = useRef(0);

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
                setLoadError(t("motion.editor.assetDeleted"));
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
    }, [payload?.animationId, storyService, uiService, t]);

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
    const pxPerMs = timelinePxPerMs ?? DEFAULT_TIMELINE_PX_PER_MS;
    const timelineWidth = Math.max(
        timelineViewport.width - TIMELINE_LEFT_COL_PX,
        MIN_TIMELINE_WIDTH,
        durationMs * pxPerMs + Math.max(TIMELINE_SCROLL_HEADROOM_PX, (timelineViewport.width - TIMELINE_LEFT_COL_PX) * 0.5),
    );
    const tracks = useMemo(() => orderTracks(timeline.tracks), [timeline.tracks]);
    const selected = useMemo(() => findKeyframe(timeline, selectedKeyframeId), [selectedKeyframeId, timeline]);
    const addPropertyOptions = useMemo<SelectOption[]>(() => {
        const existing = new Set(tracks.map(track => track.property));
        return STORY_MOTION_PROPERTIES
            .filter(item => !existing.has(item.property))
            .map(item => ({
                value: item.property,
                label: t(`motion.propertyLabel.${item.property}`),
            }));
    }, [tracks, t]);
    const previewTimeline = useMemo(() => {
        if (!keyframeDrag) {
            return timeline;
        }
        return {
            ...timeline,
            tracks: timeline.tracks.map(track => track.keyframes.some(keyframe => keyframe.id === keyframeDrag.keyframeId)
                ? {
                    ...track,
                    keyframes: track.keyframes.map(keyframe => keyframe.id === keyframeDrag.keyframeId
                        ? { ...keyframe, timeMs: keyframeDrag.timeMs }
                        : keyframe),
                }
                : track),
        };
    }, [keyframeDrag, timeline]);
    const preview = sampleStoryMotionPreview(previewTimeline, playheadMs);
    const visiblePreview = previewOverride
        ? { ...preview, ...previewOverride, position: previewOverride.position ?? preview.position }
        : preview;
    const previewTarget = useMemo(() => resolveStoryMotionPreviewTarget({
        document,
        sceneId: payload?.actionContext?.sceneId,
        blockId: payload?.actionContext?.blockId,
        fallbackKind: asset?.targetKind ?? "image",
        fallbackLabel: asset?.name ?? "Displayable",
        previewAssetId: asset?.previewAssetId,
    }), [asset?.name, asset?.previewAssetId, asset?.targetKind, document, payload?.actionContext?.blockId, payload?.actionContext?.sceneId]);
    const stageSize = useMemo(() => resolveStoryMotionStageSize(projectService), [projectService]);
    const { url: previewBackgroundUrl } = useAssetObjectUrl(asset?.previewBackgroundAssetId ?? null);
    const positionPath = useMemo(() => {
        const track = previewTimeline.tracks.find(item => item.property === "position");
        if (!track || track.keyframes.length < 2) {
            return [];
        }
        return [...track.keyframes]
            .sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id))
            .map(keyframe => {
                const value = keyframe.value && typeof keyframe.value === "object" ? keyframe.value : {};
                return {
                    id: keyframe.id,
                    x: (value.xalign ?? 0.5) * stageSize.width + (value.xoffset ?? 0),
                    // SVG y runs top-down; the stage anchors from the bottom, so flip it.
                    y: stageSize.height - ((value.yalign ?? 0.55) * stageSize.height + (value.yoffset ?? 0)),
                };
            });
    }, [previewTimeline, stageSize]);

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
        playheadRef.current = playheadMs;
    }, [playheadMs]);

    useEffect(() => {
        durationRef.current = durationMs;
    }, [durationMs]);

    // Kept-alive tabs stay mounted while hidden; stop timeline playback when this tab isn't visible so
    // its per-frame rAF loop doesn't keep re-rendering in the background.
    useEffect(() => {
        if (!active) {
            setPlaying(false);
        }
    }, [active]);

    useEffect(() => {
        if (!playing || !active) {
            return;
        }
        let frame = 0;
        const startedAt = performance.now() - playheadRef.current;
        const tick = (now: number) => {
            const next = now - startedAt;
            if (next >= durationRef.current) {
                setPlayheadMs(durationRef.current);
                setPlaying(false);
                return;
            }
            setPlayheadMs(next);
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing]);

    useEffect(() => {
        undoStackRef.current = [];
        redoStackRef.current = [];
        lastObservedTimelineRef.current = null;
        lastTimelineRecordAtRef.current = 0;
        timelineFitInitializedRef.current = null;
    }, [payload?.animationId]);

    useEffect(() => {
        if (!asset) {
            lastObservedTimelineRef.current = null;
            return;
        }
        const json = JSON.stringify(getStoryMotionTimeline(asset));
        const previous = lastObservedTimelineRef.current;
        if (!previous) {
            lastObservedTimelineRef.current = { json, timeline: JSON.parse(json) as StoryAnimationTimeline };
            return;
        }
        if (previous.json === json) {
            return;
        }
        const now = Date.now();
        if (now - lastTimelineRecordAtRef.current > TIMELINE_UNDO_COALESCE_MS) {
            undoStackRef.current.push(previous.timeline);
            if (undoStackRef.current.length > TIMELINE_UNDO_LIMIT) {
                undoStackRef.current.shift();
            }
        }
        lastTimelineRecordAtRef.current = now;
        redoStackRef.current = [];
        lastObservedTimelineRef.current = { json, timeline: JSON.parse(json) as StoryAnimationTimeline };
    }, [asset]);

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
        setTimelinePxPerMs(saved.timelinePxPerMs ?? null);
        setPlayheadMs(clampStoryMotionTimeMs(saved.playheadMs ?? 0));
        setSelectedKeyframeId(saved.selectedKeyframeId && findKeyframe(timeline, saved.selectedKeyframeId)
            ? saved.selectedKeyframeId
            : null);
        if (saved.selectedAddProperty) {
            setSelectedAddProperty(saved.selectedAddProperty);
        }
        restoredEditorStateRef.current = restoreKey;
        initializedPreviewViewportRef.current = null;
    }, [asset, editorStatePanelId, payload?.animationId, readEditorPanelState, timeline]);

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
        if (!asset || !payload?.animationId) {
            return;
        }
        const restoreKey = `${editorStatePanelId}:${payload.animationId}`;
        if (restoredEditorStateRef.current !== restoreKey || timelineFitInitializedRef.current === restoreKey) {
            return;
        }
        if (timelinePxPerMs !== null) {
            timelineFitInitializedRef.current = restoreKey;
            return;
        }
        const container = timelineScrollRef.current;
        if (!container) {
            return;
        }
        const frame = window.requestAnimationFrame(() => {
            const visibleWidth = container.clientWidth - TIMELINE_LEFT_COL_PX;
            const duration = durationRef.current;
            const headroom = Math.max(duration * 0.15, 500);
            if (visibleWidth > 0) {
                setTimelinePxPerMs(clampTimelinePxPerMs(visibleWidth / (duration + headroom)));
            }
            timelineFitInitializedRef.current = restoreKey;
        });
        return () => window.cancelAnimationFrame(frame);
    }, [asset, editorStatePanelId, payload?.animationId, timelinePxPerMs]);

    const hasAsset = Boolean(asset);
    useEffect(() => {
        if (!hasAsset) {
            return;
        }
        const container = timelineScrollRef.current;
        if (!container) {
            return;
        }
        const update = () => {
            const width = container.clientWidth;
            const scrollLeft = Math.round(container.scrollLeft / 25) * 25;
            setTimelineViewport(current => current.width === width && current.scrollLeft === scrollLeft
                ? current
                : { width, scrollLeft });
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(container);
        container.addEventListener("scroll", update, { passive: true });
        return () => {
            observer.disconnect();
            container.removeEventListener("scroll", update);
        };
    }, [hasAsset]);

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
            timelinePxPerMs: timelinePxPerMs ?? latestEditorStateRef.current.timelinePxPerMs,
        };
    }, [playheadMs, selectedAddProperty, selectedKeyframeId, stageZoom, timelinePxPerMs]);

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

    const scrubToClientX = useCallback((clientX: number, rect: DOMRect, snap: boolean) => {
        const raw = (clientX - rect.left) / pxPerMs;
        const value = snap ? snapStoryMotionTimeToFrame(raw, STORY_MOTION_FPS) : clampStoryMotionTimeMs(raw);
        // The playhead stays inside the timeline; dragging past the end must not
        // extend the lane or spawn phantom horizontal scroll.
        setPlayheadMs(Math.min(durationRef.current, Math.max(0, value)));
    }, [pxPerMs]);

    const startPlayheadDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        scrubToClientX(event.clientX, rect, !event.altKey);
        const onMove = (moveEvent: PointerEvent) => scrubToClientX(moveEvent.clientX, rect, !moveEvent.altKey);
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
        let lastTime = startTime;
        const onMove = (moveEvent: PointerEvent) => {
            const raw = clampStoryMotionTimeMs(startTime + (moveEvent.clientX - startX) / pxPerMs);
            lastTime = moveEvent.altKey ? raw : snapStoryMotionTimeToFrame(raw, STORY_MOTION_FPS);
            setKeyframeDrag({ keyframeId: keyframe.id, timeMs: lastTime });
            setPlayheadMs(lastTime);
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            if (lastTime !== startTime) {
                updateTimeline(current => updateStoryMotionKeyframe(current, keyframe.id, currentKeyframe => ({
                    ...currentKeyframe,
                    timeMs: lastTime,
                })));
            }
            setKeyframeDrag(null);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }, [pxPerMs, selectKeyframe, updateTimeline]);

    const addKeyframeAtTime = useCallback((track: StoryAnimationTrack, timeMs: number) => {
        const time = clampStoryMotionTimeMs(timeMs);
        const value = sampleStoryMotionTrackValue(track, time);
        if (value === undefined) {
            return;
        }
        updateTimeline(current => upsertStoryMotionKeyframe(current, track.property, time, value));
    }, [updateTimeline]);

    const handleLaneDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>, track: StoryAnimationTrack) => {
        if ((event.target as HTMLElement | null)?.closest("button")) {
            return;
        }
        const raw = clampStoryMotionTimeMs((event.clientX - event.currentTarget.getBoundingClientRect().left) / pxPerMs);
        const timeMs = Math.abs(raw - playheadMs) * pxPerMs <= TIMELINE_PLAYHEAD_SNAP_PX
            ? playheadMs
            : event.altKey ? raw : snapStoryMotionTimeToFrame(raw, STORY_MOTION_FPS);
        addKeyframeAtTime(track, timeMs);
        setPlayheadMs(timeMs);
    }, [addKeyframeAtTime, playheadMs, pxPerMs]);

    const deleteSelectedKeyframe = useCallback(() => {
        if (!selected) {
            return;
        }
        const keyframeId = selected.keyframe.id;
        setSelectedKeyframeId(null);
        const selection = uiService?.getStore().getSelection();
        if (
            selection?.type === STORY_MOTION_KEYFRAME_SELECTION_TYPE
            && isStoryMotionKeyframeSelectionData(selection.data)
            && selection.data.keyframeId === keyframeId
        ) {
            uiService?.getStore().setSelection({ type: null, data: null });
        }
        updateTimeline(current => deleteStoryMotionKeyframe(current, keyframeId));
    }, [selected, uiService, updateTimeline]);

    const restoreTimeline = useCallback((snapshot: StoryAnimationTimeline) => {
        if (!storyService || !asset) {
            return;
        }
        const nextAsset = storyService.updateAnimationAsset(asset.id, current => ({
            ...current,
            timeline: JSON.parse(JSON.stringify(snapshot)) as StoryAnimationTimeline,
        }));
        const json = JSON.stringify(getStoryMotionTimeline(nextAsset));
        lastObservedTimelineRef.current = { json, timeline: JSON.parse(json) as StoryAnimationTimeline };
        lastTimelineRecordAtRef.current = 0;
        setAsset(nextAsset);
    }, [asset, storyService]);

    const undoTimelineEdit = useCallback(() => {
        const snapshot = undoStackRef.current.pop();
        if (!snapshot || !asset) {
            return;
        }
        redoStackRef.current.push(lastObservedTimelineRef.current?.timeline ?? getStoryMotionTimeline(asset));
        restoreTimeline(snapshot);
    }, [asset, restoreTimeline]);

    const redoTimelineEdit = useCallback(() => {
        const snapshot = redoStackRef.current.pop();
        if (!snapshot || !asset) {
            return;
        }
        undoStackRef.current.push(lastObservedTimelineRef.current?.timeline ?? getStoryMotionTimeline(asset));
        restoreTimeline(snapshot);
    }, [asset, restoreTimeline]);

    const stepPlayhead = useCallback((frames: number) => {
        setPlayheadMs(current => Math.min(durationRef.current, stepStoryMotionTimeByFrames(current, frames, STORY_MOTION_FPS)));
    }, []);

    const keybindings = useMemo<KeybindingDefinition[]>(() => [
        {
            id: "undo",
            key: "ctrl+z",
            description: "Undo story motion edit",
            handler: undoTimelineEdit,
        },
        {
            id: "redo",
            key: "ctrl+shift+z",
            description: "Redo story motion edit",
            handler: redoTimelineEdit,
        },
        {
            id: "delete",
            key: "delete",
            description: "Delete selected keyframe",
            handler: deleteSelectedKeyframe,
        },
        {
            id: "backspace",
            key: "backspace",
            description: "Delete selected keyframe",
            handler: deleteSelectedKeyframe,
        },
        {
            id: "prev-frame",
            key: "arrowleft",
            description: "Step playhead back one frame",
            handler: () => stepPlayhead(-1),
        },
        {
            id: "next-frame",
            key: "arrowright",
            description: "Step playhead forward one frame",
            handler: () => stepPlayhead(1),
        },
        {
            id: "prev-frames",
            key: "shift+arrowleft",
            description: "Step playhead back ten frames",
            handler: () => stepPlayhead(-10),
        },
        {
            id: "next-frames",
            key: "shift+arrowright",
            description: "Step playhead forward ten frames",
            handler: () => stepPlayhead(10),
        },
        {
            id: "playhead-start",
            key: "home",
            description: "Move playhead to start",
            handler: () => setPlayheadMs(0),
        },
        {
            id: "playhead-end",
            key: "end",
            description: "Move playhead to end",
            handler: () => setPlayheadMs(durationRef.current),
        },
    ], [deleteSelectedKeyframe, redoTimelineEdit, stepPlayhead, undoTimelineEdit]);

    useKeybindings({
        keybindings,
        enabled: Boolean(asset && storyService),
        when: whenEditorFocused(tabId),
        idPrefix: `story-motion-editor-${tabId}`,
    });

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

    const startPreviewDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, mode: StoryMotionPreviewDragMode) => {
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
            // Position tracks the cursor in stage space (compensate the stage zoom);
            // scale/zoom/rotation follow raw screen movement so sensitivity stays
            // constant regardless of how far the stage is zoomed out.
            const screenDx = moveEvent.clientX - startX;
            const screenDy = moveEvent.clientY - startY;
            if (mode === "position") {
                const position = {
                    ...startPreview.position,
                    xoffset: startPreview.position.xoffset + screenDx / stageZoom,
                    // yoffset is measured up from the stage bottom (NLR origin), so dragging
                    // the cursor down must decrease it for the frame to follow the pointer.
                    yoffset: startPreview.position.yoffset - screenDy / stageZoom,
                };
                latestProperty = "position";
                latestValue = position;
                setPreviewOverride({ position });
            } else if (mode === "zoom") {
                const zoomValue = Math.max(0.1, startPreview.zoom + screenDx / 180);
                latestProperty = "zoom";
                latestValue = Number(zoomValue.toFixed(3));
                setPreviewOverride({ zoom: zoomValue });
            } else if (mode === "scaleX") {
                const scaleX = Math.max(0.05, startPreview.scaleX + screenDx / 180);
                latestProperty = "scaleX";
                latestValue = Number(scaleX.toFixed(3));
                setPreviewOverride({ scaleX });
            } else if (mode === "scaleY") {
                const scaleY = Math.max(0.05, startPreview.scaleY + screenDy / 180);
                latestProperty = "scaleY";
                latestValue = Number(scaleY.toFixed(3));
                setPreviewOverride({ scaleY });
            } else {
                const rotation = startPreview.rotation + screenDx / 2;
                latestProperty = "rotation";
                latestValue = Number(rotation.toFixed(2));
                setPreviewOverride({ rotation });
            }
        };
        const onUp = () => {
            if (autoKey && latestProperty && latestValue !== null) {
                updateTimeline(current => upsertStoryMotionKeyframe(current, latestProperty!, playheadMs, latestValue!));
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
        if (event.ctrlKey) {
            const container = timelineScrollRef.current;
            if (!container) {
                return;
            }
            event.preventDefault();
            const rect = container.getBoundingClientRect();
            const pointerX = Math.max(TIMELINE_LEFT_COL_PX, event.clientX - rect.left);
            const scrollLeft = container.scrollLeft;
            setTimelinePxPerMs(current => {
                const base = current ?? DEFAULT_TIMELINE_PX_PER_MS;
                const next = clampTimelinePxPerMs(base * Math.exp(-event.deltaY * 0.0015));
                if (next === base) {
                    return current;
                }
                const timeAtPointer = Math.max(0, (scrollLeft + pointerX - TIMELINE_LEFT_COL_PX) / base);
                window.requestAnimationFrame(() => {
                    container.scrollLeft = timeAtPointer * next + TIMELINE_LEFT_COL_PX - pointerX;
                });
                persistEditorPanelState({ timelinePxPerMs: next });
                return next;
            });
            return;
        }
        const container = event.currentTarget;
        const horizontalIntent = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
        const noVerticalOverflow = container.scrollHeight <= container.clientHeight + 1;
        if (!horizontalIntent && !noVerticalOverflow) {
            return;
        }
        const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        const delta = normalizeWheelDelta(rawDelta, event.deltaMode, container.clientWidth);
        if (delta === 0) {
            return;
        }
        event.preventDefault();
        container.scrollLeft += delta;
    }, [persistEditorPanelState]);

    if (!asset) {
        return (
            <div className="flex h-full items-center justify-center bg-surface text-sm text-fg-muted">
                {loadError ?? t("motion.editor.loading")}
            </div>
        );
    }

    return (
        <div
            ref={editorRootRef}
            className="flex h-full min-h-0 flex-col bg-surface text-fg outline-none"
            tabIndex={-1}
            onKeyDownCapture={handleEditorKeyDown}
            onMouseDownCapture={focusEditor}
        >
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-3">
                <div className="min-w-0 flex-[0_1_320px] truncate text-sm font-medium text-fg" title={asset.name}>
                    {asset.name}
                </div>
                <button className={ICON_BUTTON_CLASS} type="button" onClick={togglePlayback} title={playing ? t("motion.editor.pause") : t("motion.editor.play")}>
                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <input
                    className="h-1.5 min-w-32 flex-1 accent-primary"
                    type="range"
                    min={0}
                    max={durationMs}
                    value={Math.min(playheadMs, durationMs)}
                    onChange={event => setPlayheadMs(clampNumber(Number(event.target.value), 0, durationMs, 0))}
                />
                <span className="shrink-0 text-2xs tabular-nums text-fg-subtle">
                    {formatStoryMotionTime(Math.min(playheadMs, durationMs))}
                </span>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1">
                <div className="flex min-h-0 flex-col">
                    <div
                        ref={previewViewportRef}
                        className={`min-h-0 flex-1 overflow-auto bg-surface ${previewPanning ? "cursor-grabbing" : "cursor-default"}`}
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
                                        backgroundUrl={previewBackgroundUrl}
                                        allowOverflow
                                        canvasScale={stageZoom}
                                    />
                                    {positionPath.length > 1 ? (
                                        <svg
                                            className="pointer-events-none absolute left-0 top-0"
                                            width={stageSize.width}
                                            height={stageSize.height}
                                            viewBox={`0 0 ${stageSize.width} ${stageSize.height}`}
                                        >
                                            <polyline
                                                points={positionPath.map(point => `${point.x},${point.y}`).join(" ")}
                                                fill="none"
                                                stroke="rgba(31,158,255,0.55)"
                                                strokeWidth={2}
                                                strokeDasharray="6 6"
                                            />
                                            {positionPath.map(point => (
                                                <circle key={point.id} cx={point.x} cy={point.y} r={4} fill="#1f9eff" stroke="rgba(255,255,255,0.7)" />
                                            ))}
                                        </svg>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="h-64 shrink-0 border-t border-edge bg-surface">
                        <div className="flex h-12 items-center gap-3 border-b border-edge px-3">
                            <div className="w-[168px] text-xs font-medium text-fg-muted">{t("motion.editor.animatedProperties")}</div>
                            <Select
                                className="w-44"
                                size="md"
                                options={addPropertyOptions}
                                value={selectedAddProperty}
                                onChange={value => setSelectedAddProperty(value as StoryAnimationTrackProperty)}
                                placeholder={t("motion.editor.addProperty")}
                                disabled={addPropertyOptions.length === 0}
                                portalMenu
                                menuZIndex={80}
                            />
                            <Button
                                variant="secondary"
                                size="md"
                                type="button"
                                onClick={() => updateTimeline(current => ensureStoryMotionTrack(current, selectedAddProperty, playheadMs))}
                                disabled={addPropertyOptions.length === 0}
                                className="shrink-0"
                            >
                                <Plus className="h-3.5 w-3.5" />
                                {t("motion.editor.addProperty")}
                            </Button>
                        </div>
                        <div ref={timelineScrollRef} className="h-[calc(100%-48px)] overflow-auto overscroll-contain" onWheel={handleTimelineWheel}>
                            <div
                                className="grid"
                                style={{
                                    width: TIMELINE_LEFT_COL_PX + timelineWidth,
                                    minWidth: "100%",
                                    gridTemplateColumns: `${TIMELINE_LEFT_COL_PX}px ${timelineWidth}px`,
                                }}
                            >
                                <div className="sticky left-0 top-0 z-40 flex h-8 items-center border-r border-b border-edge bg-surface px-3 text-xs font-medium text-fg-muted">
                                    {t("motion.property")}
                                </div>
                                <div className="sticky top-0 z-30 h-8 border-b border-edge bg-surface" onPointerDown={startPlayheadDrag}>
                                    {buildTicks(pxPerMs, timelineWidth, timelineViewport, STORY_MOTION_FPS).map(tick => (
                                        <div key={tick.timeMs} className="absolute top-0 h-full border-l border-edge" style={{ left: tick.timeMs * pxPerMs }}>
                                            <span className="ml-1 text-2xs text-fg-subtle">{tick.label}</span>
                                        </div>
                                    ))}
                                    <div className="absolute top-0 z-20 h-full w-px bg-orange-400" style={{ left: playheadMs * pxPerMs }}>
                                        <div className="-ml-1.5 h-3 w-3 rounded-sm bg-orange-400 rotate-45" />
                                    </div>
                                </div>
                                {tracks.map(track => (
                                    <Fragment key={track.id}>
                                        <div className="group sticky left-0 z-20 flex h-[34px] items-center gap-2 border-r border-b border-edge-subtle bg-surface px-3 text-xs text-fg-muted">
                                            <span className="min-w-0 flex-1 truncate">{getStoryMotionPropertyMeta(track.property).label}</span>
                                            <button
                                                type="button"
                                                className="grid h-6 w-6 shrink-0 place-items-center rounded text-fg-subtle opacity-0 transition group-hover:opacity-100 hover:bg-primary/10 hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                                                onClick={event => {
                                                    event.stopPropagation();
                                                    addKeyframeAtTime(track, playheadMs);
                                                }}
                                                onPointerDown={event => event.stopPropagation()}
                                                title={t("motion.editor.addKeyframeAtPlayhead")}
                                                aria-label={t("motion.editor.addKeyframeAria", { property: getStoryMotionPropertyMeta(track.property).label })}
                                            >
                                                <Diamond className="h-3.5 w-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                className="grid h-6 w-6 shrink-0 place-items-center rounded text-fg-subtle opacity-0 transition group-hover:opacity-100 hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger/50"
                                                onClick={event => {
                                                    event.stopPropagation();
                                                    deleteTrack(track);
                                                }}
                                                onPointerDown={event => event.stopPropagation()}
                                                title={t("motion.editor.deleteTrack")}
                                                aria-label={t("motion.editor.deleteTrackAria", { property: getStoryMotionPropertyMeta(track.property).label })}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                        <div
                                            className="relative h-[34px] border-b border-edge-subtle"
                                            onDoubleClick={event => handleLaneDoubleClick(event, track)}
                                        >
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
                                                    style={{
                                                        left: (keyframeDrag?.keyframeId === keyframe.id ? keyframeDrag.timeMs : keyframe.timeMs) * pxPerMs,
                                                    }}
                                                    onClick={() => selectKeyframe(track, keyframe)}
                                                    onPointerDown={event => startKeyframeDrag(event, track, keyframe)}
                                                    title={`${getStoryMotionPropertyMeta(track.property).label} ${formatStoryMotionTime(keyframe.timeMs, STORY_MOTION_FPS)}`}
                                                />
                                            ))}
                                            <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-edge-subtle" />
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
    const timelinePxPerMs = Number(record.timelinePxPerMs);
    if (Number.isFinite(timelinePxPerMs) && timelinePxPerMs > 0) {
        state.timelinePxPerMs = clampTimelinePxPerMs(timelinePxPerMs);
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
    return typeof value === "string" && STORY_MOTION_PROPERTIES.some(item => item.property === value);
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

function buildTicks(
    pxPerMs: number,
    laneWidth: number,
    viewport: { width: number; scrollLeft: number },
    fps: number,
): { timeMs: number; label: string }[] {
    const step = TIMELINE_TICK_STEPS.find(candidate => candidate * pxPerMs >= TIMELINE_TICK_MIN_PX)
        ?? TIMELINE_TICK_STEPS[TIMELINE_TICK_STEPS.length - 1];
    const maxTimeMs = laneWidth / pxPerMs;
    // Buffer a full viewport on each side so fast horizontal scrolls never outrun
    // the generated window (the scroll position is sampled in coarse steps).
    const bufferPx = Math.max(TIMELINE_TICK_BUFFER_PX, viewport.width);
    const startMs = viewport.width > 0
        ? Math.max(0, (viewport.scrollLeft - TIMELINE_LEFT_COL_PX - bufferPx) / pxPerMs)
        : 0;
    const endMs = viewport.width > 0
        ? Math.min(maxTimeMs, (viewport.scrollLeft + viewport.width - TIMELINE_LEFT_COL_PX + bufferPx) / pxPerMs)
        : maxTimeMs;
    const ticks: { timeMs: number; label: string }[] = [];
    for (let timeMs = Math.floor(startMs / step) * step; timeMs <= endMs; timeMs += step) {
        const frame = Math.round((timeMs / 1000) * fps);
        ticks.push({
            timeMs,
            label: `${(timeMs / 1000).toFixed(timeMs % 1000 === 0 ? 0 : 2)}s f${frame}`,
        });
    }
    return ticks;
}

function clampTimelinePxPerMs(value: number): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_TIMELINE_PX_PER_MS;
    }
    return Math.min(MAX_TIMELINE_PX_PER_MS, Math.max(MIN_TIMELINE_PX_PER_MS, value));
}

export function resolveStoryMotionStageSize(projectService: ProjectService | null): { width: number; height: number } {
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
