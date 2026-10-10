import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
    MouseEvent as ReactMouseEvent,
    PointerEvent as ReactPointerEvent,
    WheelEvent as ReactWheelEvent,
} from "react";
import { Pause, Play, Repeat, SkipBack, Spline, StepBack, StepForward } from "lucide-react";
import type {
    StoryAlignPositionValue,
    StoryAnimationAsset,
    StoryAnimationKeyframeValue,
    StoryAnimationTimeline,
    StoryAnimationTrack,
    StoryAnimationTrackProperty,
    StoryDocument,
} from "@shared/types/story";
import { FocusArea, type EditorTabComponentProps } from "@/lib/workspace/services/ui/types";
import { useHistoryScope, useKeybindings, whenEditorFocused, type KeybindingDefinition } from "@/apps/workspace/hooks";
import { useShortcutLabels } from "@/apps/workspace/hooks/useShortcutLabels";
import { storyMotionHistoryScope } from "@/lib/workspace/services/history/historyScopes";
import type { EditorTabDefinition } from "../../registry/types";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { BaseProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { StoryAnimationReadError, StoryService } from "@/lib/workspace/services/story/StoryService";
import { describeAssetReadFailure } from "@/lib/workspace/assets/assetReadFailure";
import { Select, type SelectOption } from "@/lib/components/elements/Select";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { TooltipGroup } from "@/lib/tooltip";
import { translate, useTranslation } from "@/lib/i18n";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { ResizableHandle } from "../../components/ui/ResizableHandle";
import { formatZoom } from "../assets/editors/video/frameViewport";
import {
    STORY_MOTION_KEYFRAME_SELECTION_TYPE,
    type StoryMotionEditorPayload,
} from "./storyMotionTypes";
import {
    STORY_MOTION_FPS,
    STORY_MOTION_PROPERTIES,
    clampStoryMotionTimeMs,
    deleteStoryMotionTrack,
    ensureStoryMotionTrack,
    getStoryMotionDurationMs,
    getStoryMotionTimeline,
    isStoryMotionEasingName,
    sampleStoryMotionPreview,
    sampleStoryMotionTrackValue,
    snapStoryMotionTimeToFrame,
    stepStoryMotionTimeByFrames,
    storyMotionFrameDurationMs,
    upsertStoryMotionKeyframe,
} from "./storyMotionTimeline";
import {
    adjacentStoryMotionKeyframeTime,
    copyStoryMotionKeyframes,
    deleteStoryMotionKeyframes,
    findStoryMotionKeyframeAt,
    insertStoryMotionKeyframes,
    moveStoryMotionKeyframes,
    pasteStoryMotionKeyframes,
    positionForWrite,
    setStoryMotionKeyframesEasing,
    type StoryMotionClipboard,
} from "./storyMotionEditing";
import { useFreezeGuard } from "../../components/ui/freezeGuard";
import { StoryMotionStagePreview, type StoryMotionPreviewDragMode } from "./StoryMotionStagePreview";
import { resolveStoryMotionPreviewTarget } from "./storyMotionPreviewTarget";
import {
    StoryMotionTimeline,
    clampPxPerMs,
    formatSeconds,
    orderStoryMotionTracks,
    type StoryMotionTimelineActions,
    type StoryMotionTimelineHandle,
} from "./StoryMotionTimelineView";

const ICON_BUTTON_CLASS = controlButtonClass();
const DEFAULT_STAGE_SIZE = { width: 1280, height: 720 };
const PREVIEW_CANVAS_PADDING = 2048;
/** Room kept around the stage when it is fitted to the view. */
const STAGE_FIT_MARGIN = 24;
const MIN_STAGE_ZOOM = 0.05;
const MAX_STAGE_ZOOM = 4;
const STAGE_ZOOM_PRESETS = [0.25, 0.5, 1, 2] as const;
const STORY_MOTION_EDITOR_STATE_PREFIX = "storyMotion.editorState";
/** One height for every motion editor: how much room the timeline gets is a habit, not a motion's. */
const STORY_MOTION_LAYOUT_STATE_ID = "storyMotion.layout";
const DEFAULT_TIMELINE_HEIGHT = 240;
const MIN_TIMELINE_HEIGHT = 120;
const MIN_STAGE_HEIGHT = 140;
const TIMELINE_UNDO_LIMIT = 100;
const TIMELINE_UNDO_COALESCE_MS = 800;
/** J and L double the speed on each further press, up to this. */
const MAX_SHUTTLE_RATE = 4;

/**
 * Keyframes copied in any motion editor, so a move can be copied from one motion into another the
 * way a timeline's clipboard works across sequences. Kept in memory only: it is the editor's own
 * clipboard, not the system's.
 */
let storyMotionClipboard: StoryMotionClipboard | null = null;

type StoryMotionPreviewViewportState = {
    scrollLeft: number;
    scrollTop: number;
    zoom: number;
    fit?: boolean;
};

type StoryMotionEditorPanelState = {
    previewViewport?: StoryMotionPreviewViewportState;
    playheadMs?: number;
    selectedKeyframeId?: string | null;
    timelinePxPerMs?: number;
    loop?: boolean;
};

type Playback = { direction: 1 | -1; rate: number };

export function createStoryMotionEditorTab(payload: StoryMotionEditorPayload): EditorTabDefinition<StoryMotionEditorPayload> {
    return {
        id: `story-motion:${payload.animationId}`,
        title: translate("motion.storyMotion"),
        icon: <Spline className="h-4 w-4" />,
        component: StoryMotionEditorTab,
        payload,
        closable: true,
        modified: false,
    };
}

export function StoryMotionEditorTab({ tabId, payload, active }: EditorTabComponentProps<StoryMotionEditorPayload>) {
    const { t } = useTranslation();
    const shortcuts = useShortcutLabels();
    const { context, isInitialized } = useWorkspace();
    // Everything that moves a keyframe or a stage handle writes the animation asset. The playhead,
    // zoom, playback and selection do not, and stay live so a frozen motion can still be watched.
    const freeze = useFreezeGuard();
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
    const editorStatePanelId = useMemo(() => `${STORY_MOTION_EDITOR_STATE_PREFIX}:${tabId}`, [tabId]);
    const editorRootRef = useRef<HTMLDivElement | null>(null);
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const previewViewportRef = useRef<HTMLDivElement | null>(null);
    const timelineRef = useRef<StoryMotionTimelineHandle | null>(null);
    const latestEditorStateRef = useRef<StoryMotionEditorPanelState>({});
    const restoredEditorStateRef = useRef<string | null>(null);
    const previewPanRef = useRef<{ pointerId: number; startX: number; startY: number; startScrollLeft: number; startScrollTop: number } | null>(null);
    const [asset, setAsset] = useState<StoryAnimationAsset | null>(null);
    const [document, setDocument] = useState<StoryDocument | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [playheadMs, setPlayheadMs] = useState(0);
    const [playback, setPlayback] = useState<Playback | null>(null);
    const [loop, setLoop] = useState(false);
    const [timelinePxPerMs, setTimelinePxPerMs] = useState<number | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [primaryId, setPrimaryId] = useState<string | null>(null);
    const [keyframeDrag, setKeyframeDrag] = useState<{ ids: ReadonlySet<string>; deltaMs: number } | null>(null);
    const [stageZoom, setStageZoom] = useState(1);
    const [stageFit, setStageFit] = useState(true);
    /** The saved view has been read back; until then the stage neither fits nor restores a scroll. */
    const [viewRestored, setViewRestored] = useState(false);
    const [previewPanning, setPreviewPanning] = useState(false);
    const [previewOverride, setPreviewOverride] = useState<Partial<ReturnType<typeof sampleStoryMotionPreview>> | null>(null);
    const [timelineHeight, setTimelineHeightState] = useState(() => readTimelineHeight(panelStateService));
    const timelineHeightRef = useRef(timelineHeight);
    const setTimelineHeight = useCallback((height: number) => {
        timelineHeightRef.current = height;
        setTimelineHeightState(height);
    }, []);
    const playheadRef = useRef(0);
    const durationRef = useRef(0);
    const loopRef = useRef(loop);
    loopRef.current = loop;
    const lastObservedTimelineRef = useRef<{ json: string; timeline: StoryAnimationTimeline } | null>(null);
    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    const playing = playback !== null;

    // ---- loading -------------------------------------------------------------

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
                    // Said by the motion's name and what the read answered. The error's own message
                    // is English and names the file by the motion's id.
                    console.warn(`[motion] could not load ${payload.animationId}`, error);
                    const entry = storyService.getAnimationIndex().animations.find(item => item.id === payload.animationId);
                    setLoadError(entry
                        ? describeAssetReadFailure(
                            payload.animationId,
                            entry.name,
                            error instanceof StoryAnimationReadError ? error.code : undefined,
                            translate,
                        )
                        : translate("motion.editor.assetDeleted"));
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

    // The tab is named after the motion it edits, so two open motions are two different tabs.
    const assetName = asset?.name;
    useEffect(() => {
        if (uiService && assetName) {
            uiService.editor.update(tabId, { title: assetName });
        }
    }, [assetName, tabId, uiService]);

    // ---- derived -------------------------------------------------------------

    const timeline = useMemo(() => getStoryMotionTimeline(asset), [asset]);
    const previewTimeline = useMemo(
        () => keyframeDrag ? moveStoryMotionKeyframes(timeline, keyframeDrag.ids, keyframeDrag.deltaMs) : timeline,
        [keyframeDrag, timeline],
    );
    const durationMs = getStoryMotionDurationMs(previewTimeline);
    const tracks = useMemo(() => orderStoryMotionTracks(previewTimeline.tracks), [previewTimeline.tracks]);
    const addableProperties = useMemo(() => {
        const existing = new Set(timeline.tracks.map(track => track.property));
        return STORY_MOTION_PROPERTIES.map(item => item.property).filter(property => !existing.has(property));
    }, [timeline.tracks]);
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
    const primary = useMemo(() => {
        if (!primaryId) {
            return null;
        }
        for (const track of timeline.tracks) {
            const keyframe = track.keyframes.find(item => item.id === primaryId);
            if (keyframe) {
                return { track, keyframe };
            }
        }
        return null;
    }, [primaryId, timeline.tracks]);

    // Keyframes deleted elsewhere (the properties panel, an undo) leave the selection.
    useEffect(() => {
        const existing = new Set(timeline.tracks.flatMap(track => track.keyframes.map(keyframe => keyframe.id)));
        setSelectedIds(current => current.every(id => existing.has(id)) ? current : current.filter(id => existing.has(id)));
        setPrimaryId(current => current && !existing.has(current) ? null : current);
    }, [timeline.tracks]);

    // ---- editor state --------------------------------------------------------

    const readEditorPanelState = useCallback(() => (
        panelStateService
            ? normalizeStoryMotionEditorPanelState(panelStateService.getPanelState<StoryMotionEditorPanelState>(editorStatePanelId))
            : {}
    ), [editorStatePanelId, panelStateService]);

    const persistEditorPanelState = useCallback((patch: Partial<StoryMotionEditorPanelState>) => {
        if (!panelStateService) {
            return;
        }
        panelStateService.setPanelState<StoryMotionEditorPanelState>(editorStatePanelId, {
            ...readEditorPanelState(),
            ...patch,
        });
    }, [editorStatePanelId, panelStateService, readEditorPanelState]);

    useEffect(() => {
        setTimelineHeight(readTimelineHeight(panelStateService));
    }, [panelStateService, setTimelineHeight]);

    useEffect(() => {
        playheadRef.current = playheadMs;
    }, [playheadMs]);

    useEffect(() => {
        durationRef.current = durationMs;
    }, [durationMs]);

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
        setStageFit(saved.previewViewport ? saved.previewViewport.fit !== false : true);
        setTimelinePxPerMs(saved.timelinePxPerMs ?? null);
        setPlayheadMs(clampStoryMotionTimeMs(saved.playheadMs ?? 0));
        setLoop(saved.loop ?? false);
        const savedPrimary = saved.selectedKeyframeId
            && timeline.tracks.some(track => track.keyframes.some(keyframe => keyframe.id === saved.selectedKeyframeId))
            ? saved.selectedKeyframeId
            : null;
        setSelectedIds(savedPrimary ? [savedPrimary] : []);
        setPrimaryId(savedPrimary);
        restoredEditorStateRef.current = restoreKey;
        setViewRestored(true);
    }, [asset, editorStatePanelId, payload?.animationId, readEditorPanelState, timeline]);

    useEffect(() => {
        lastObservedTimelineRef.current = null;
    }, [payload?.animationId]);

    useEffect(() => {
        editorRootRef.current?.focus();
    }, [payload?.animationId]);

    useEffect(() => {
        latestEditorStateRef.current = {
            ...latestEditorStateRef.current,
            playheadMs,
            selectedKeyframeId: primaryId,
            timelinePxPerMs: timelinePxPerMs ?? latestEditorStateRef.current.timelinePxPerMs,
            loop,
        };
    }, [loop, playheadMs, primaryId, timelinePxPerMs]);

    // Nothing is saved before the saved state has been read back: the first render's playhead and
    // selection are placeholders, and writing them would replace what the restore is about to read.
    useEffect(() => {
        if (playing || restoredEditorStateRef.current === null) {
            return;
        }
        persistEditorPanelState({ playheadMs, selectedKeyframeId: primaryId, loop });
    }, [loop, persistEditorPanelState, playheadMs, playing, primaryId]);

    useEffect(() => () => {
        if (restoredEditorStateRef.current !== null) {
            persistEditorPanelState({ ...latestEditorStateRef.current });
        }
    }, [persistEditorPanelState]);

    const focusEditor = useCallback(() => {
        editorRootRef.current?.focus();
        uiService?.focus.setFocus(FocusArea.Editor, tabId);
    }, [tabId, uiService]);

    // ---- playback ------------------------------------------------------------

    // Kept-alive tabs stay mounted while hidden; stop playback when this tab isn't visible so its
    // per-frame loop doesn't keep re-rendering in the background.
    useEffect(() => {
        if (!active) {
            setPlayback(null);
        }
    }, [active]);

    const stopPlayback = useCallback(() => {
        setPlayback(null);
        // Playback stops between frames; a keyframe written next should land on one.
        setPlayheadMs(current => Math.min(durationRef.current, snapStoryMotionTimeToFrame(current, STORY_MOTION_FPS)));
    }, []);

    useEffect(() => {
        if (!playback || !active) {
            return;
        }
        let frame = 0;
        let last = performance.now();
        let time = playheadRef.current;
        const tick = (now: number) => {
            const duration = durationRef.current;
            // A frame's timestamp can be a little older than the moment playback started; that is
            // no time at all, not time running backwards.
            time += Math.max(0, now - last) * playback.rate * playback.direction;
            last = Math.max(last, now);
            const ended = playback.direction > 0 ? time >= duration : time <= 0;
            if (ended) {
                if (loopRef.current && duration > 0) {
                    time = playback.direction > 0 ? time - duration : time + duration;
                } else {
                    setPlayheadMs(playback.direction > 0 ? duration : 0);
                    setPlayback(null);
                    return;
                }
            }
            time = Math.min(duration, Math.max(0, time));
            setPlayheadMs(time);
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [active, playback]);

    /** Start playing in a direction; pressed again while already going that way, double the speed. */
    const shuttle = useCallback((direction: 1 | -1, accelerate: boolean) => {
        setPlayback(current => {
            if (current && current.direction === direction && accelerate) {
                return { direction, rate: Math.min(MAX_SHUTTLE_RATE, current.rate * 2) };
            }
            return { direction, rate: 1 };
        });
        // From an end the motion cannot go on from, start over at the other one.
        setPlayheadMs(current => direction > 0
            ? current >= durationRef.current ? 0 : current
            : current <= 0 ? durationRef.current : current);
    }, []);

    const togglePlayback = useCallback(() => {
        if (playing) {
            stopPlayback();
        } else {
            shuttle(1, false);
        }
    }, [playing, shuttle, stopPlayback]);

    // ---- writing -------------------------------------------------------------

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
        setAsset(nextAsset);
    }, [asset, storyService]);

    /**
     * This asset's undo stack, in `HistoryService` like every other editor's.
     *
     * The timeline is edited through a dozen paths (drag a keyframe, retype a value, apply a preset),
     * so this editor learns about an edit by *diffing* the asset rather than by being told - see the
     * observer below. That is why the checkpoint carries its own `before`: by the time the diff runs,
     * capturing the live state would capture the edit it is meant to undo.
     */
    const timelineHistory = useHistoryScope<StoryAnimationTimeline>({
        scopeId: payload?.animationId ? storyMotionHistoryScope(payload.animationId) : null,
        label: { key: "workspace.history.scope.storyMotion" },
        capture: () => (asset ? getStoryMotionTimeline(asset) : null),
        apply: restoreTimeline,
        limit: TIMELINE_UNDO_LIMIT,
        tabId,
    });

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
        // One merge key for the whole timeline: a drag emits an edit per frame, and each of those
        // becoming its own step would make undoing the drag take fifty presses.
        timelineHistory.checkpoint(
            { key: "workspace.history.entry.storyMotionEdit" },
            { mergeKey: "timeline", mergeWindowMs: TIMELINE_UNDO_COALESCE_MS, before: previous.timeline },
        );
        lastObservedTimelineRef.current = { json, timeline: JSON.parse(json) as StoryAnimationTimeline };
    }, [asset, timelineHistory]);

    // ---- selection -----------------------------------------------------------

    /** Set on a selection gesture: the properties panel follows the selection only once one is made. */
    const selectionTouchedRef = useRef(false);
    const revealInspectorRef = useRef(false);

    const changeSelection = useCallback((ids: string[], nextPrimary: string | null, gesture: "click" | "marquee") => {
        selectionTouchedRef.current = true;
        revealInspectorRef.current = gesture === "click" && nextPrimary !== null;
        setSelectedIds(ids);
        setPrimaryId(nextPrimary);
    }, []);

    // The properties panel shows the selection's primary keyframe. Synced after the edit lands, so a
    // keyframe that was just pasted or inserted is found in the timeline it is now part of.
    const primaryTrackId = primary?.track.id ?? null;
    useEffect(() => {
        if (!uiService || !payload?.animationId || !selectionTouchedRef.current) {
            return;
        }
        const store = uiService.getStore();
        if (primaryId && primaryTrackId) {
            store.setSelection({
                type: STORY_MOTION_KEYFRAME_SELECTION_TYPE,
                data: {
                    editor: "story-motion",
                    tabId,
                    animationId: payload.animationId,
                    trackId: primaryTrackId,
                    keyframeId: primaryId,
                },
            });
            if (revealInspectorRef.current) {
                revealInspectorRef.current = false;
                uiService.panels.show("narraleaf-studio:properties");
            }
            return;
        }
        const current = store.getSelection();
        if (current.type === STORY_MOTION_KEYFRAME_SELECTION_TYPE && current.data.animationId === payload.animationId) {
            store.setSelection({ type: null, data: null });
        }
    }, [payload?.animationId, primaryId, primaryTrackId, tabId, uiService]);

    const selectKeyframes = useCallback((ids: string[]) => {
        changeSelection(ids, ids[ids.length - 1] ?? null, "marquee");
    }, [changeSelection]);

    const deleteSelected = useCallback(() => {
        if (selectedSet.size === 0) {
            return;
        }
        const ids = selectedSet;
        changeSelection([], null, "marquee");
        updateTimeline(current => deleteStoryMotionKeyframes(current, ids));
    }, [changeSelection, selectedSet, updateTimeline]);

    const copySelected = useCallback(() => {
        const clipboard = copyStoryMotionKeyframes(timeline, selectedSet);
        if (clipboard) {
            storyMotionClipboard = clipboard;
        }
    }, [selectedSet, timeline]);

    const cutSelected = useCallback(() => {
        const clipboard = copyStoryMotionKeyframes(timeline, selectedSet);
        if (clipboard) {
            storyMotionClipboard = clipboard;
            deleteSelected();
        }
    }, [deleteSelected, selectedSet, timeline]);

    const paste = useCallback((atMs?: number) => {
        const clipboard = storyMotionClipboard;
        if (!clipboard || !asset) {
            return;
        }
        const result = pasteStoryMotionKeyframes(timeline, clipboard, atMs ?? playheadRef.current);
        updateTimeline(() => result.timeline);
        selectKeyframes(result.ids);
    }, [asset, selectKeyframes, timeline, updateTimeline]);

    const nudgeSelected = useCallback((frames: number) => {
        if (selectedSet.size === 0) {
            return;
        }
        const earliest = Math.min(...timeline.tracks.flatMap(track => track.keyframes.filter(keyframe => selectedSet.has(keyframe.id)).map(keyframe => keyframe.timeMs)));
        // The earliest keyframe moves onto a frame; the others keep their distance from it.
        const target = snapStoryMotionTimeToFrame(earliest + frames * storyMotionFrameDurationMs(STORY_MOTION_FPS), STORY_MOTION_FPS);
        const delta = target - earliest;
        if (delta !== 0) {
            updateTimeline(current => moveStoryMotionKeyframes(current, selectedSet, delta));
        }
    }, [selectedSet, timeline.tracks, updateTimeline]);

    const insertAtPlayhead = useCallback((trackIds: ReadonlySet<string>) => {
        if (trackIds.size === 0) {
            return;
        }
        const result = insertStoryMotionKeyframes(timeline, trackIds, playheadRef.current);
        updateTimeline(() => result.timeline);
        selectKeyframes(result.ids);
    }, [selectKeyframes, timeline, updateTimeline]);

    /** `I`: key the tracks the selection is on, or every track when nothing is selected. */
    const insertKeyframes = useCallback(() => {
        const selectedTracks = timeline.tracks.filter(track => track.keyframes.some(keyframe => selectedSet.has(keyframe.id)));
        const trackIds = new Set((selectedTracks.length > 0 ? selectedTracks : timeline.tracks).map(track => track.id));
        insertAtPlayhead(trackIds);
    }, [insertAtPlayhead, selectedSet, timeline.tracks]);

    const seek = useCallback((timeMs: number) => {
        setPlayheadMs(Math.max(0, clampStoryMotionTimeMs(timeMs)));
    }, []);

    const jumpToKeyframe = useCallback((direction: -1 | 1, trackIds?: ReadonlySet<string>) => {
        const next = adjacentStoryMotionKeyframeTime(timeline, playheadRef.current, direction, trackIds);
        if (next !== null) {
            stopPlayback();
            setPlayheadMs(next);
            timelineRef.current?.revealTime(next);
        }
    }, [stopPlayback, timeline]);

    const stepPlayhead = useCallback((frames: number) => {
        setPlayheadMs(current => Math.min(durationRef.current, stepStoryMotionTimeByFrames(current, frames, STORY_MOTION_FPS)));
    }, []);

    const writeTrackValue = useCallback((track: StoryAnimationTrack, value: StoryAnimationKeyframeValue) => {
        const time = playheadRef.current;
        updateTimeline(current => {
            const live = current.tracks.find(item => item.id === track.id) ?? track;
            if (live.property === "position" && value && typeof value === "object") {
                const sampled = sampleStoryMotionTrackValue(live, time);
                const base = sampled && typeof sampled === "object" ? sampled : {};
                return upsertStoryMotionKeyframe(current, live.property, time, positionForWrite(live, base, value));
            }
            return upsertStoryMotionKeyframe(current, live.property, time, value);
        });
    }, [updateTimeline]);

    const timelineActions = useMemo<StoryMotionTimelineActions>(() => ({
        copy: copySelected,
        cut: freeze.run(cutSelected),
        paste: freeze.run(paste),
        canPaste: () => storyMotionClipboard !== null,
        deleteSelected: freeze.run(deleteSelected),
        setEasing: freeze.run((easing: string | undefined) => {
            const ids = selectedSet;
            updateTimeline(current => setStoryMotionKeyframesEasing(current, ids, easing));
        }),
        deleteTrack: freeze.run((trackId: string) => {
            const track = timeline.tracks.find(item => item.id === trackId);
            if (track) {
                const removed = new Set(track.keyframes.map(keyframe => keyframe.id));
                const remaining = selectedIds.filter(id => !removed.has(id));
                changeSelection(remaining, remaining[remaining.length - 1] ?? null, "marquee");
            }
            updateTimeline(current => deleteStoryMotionTrack(current, trackId));
        }),
        insertAtPlayhead: freeze.run(insertAtPlayhead),
        insertAt: freeze.run((trackId: string, timeMs: number) => {
            setPlayheadMs(timeMs);
            const result = insertStoryMotionKeyframes(timeline, new Set([trackId]), timeMs);
            updateTimeline(() => result.timeline);
            selectKeyframes(result.ids);
        }),
        addProperty: freeze.run((property: StoryAnimationTrackProperty) => {
            updateTimeline(current => ensureStoryMotionTrack(current, property, playheadRef.current));
        }),
        writeValue: freeze.run(writeTrackValue),
        stepToKeyframe: (trackId: string, direction: -1 | 1) => jumpToKeyframe(direction, new Set([trackId])),
        toggleKeyframeAtPlayhead: freeze.run((trackId: string) => {
            const track = timeline.tracks.find(item => item.id === trackId);
            if (!track) {
                return;
            }
            const existing = findStoryMotionKeyframeAt(track, playheadRef.current);
            if (existing) {
                // The last keyframe is the track itself; that goes through the track's menu.
                if (track.keyframes.length > 1) {
                    changeSelection(selectedIds.filter(id => id !== existing.id), null, "marquee");
                    updateTimeline(current => deleteStoryMotionKeyframes(current, new Set([existing.id])));
                }
                return;
            }
            insertAtPlayhead(new Set([trackId]));
        }),
    }), [changeSelection, copySelected, cutSelected, deleteSelected, freeze, insertAtPlayhead, jumpToKeyframe, paste, selectKeyframes, selectedIds, selectedSet, timeline, updateTimeline, writeTrackValue]);

    const handleDragKeyframes = useCallback((ids: ReadonlySet<string>, deltaMs: number, phase: "preview" | "commit" | "cancel") => {
        if (phase === "preview") {
            setKeyframeDrag({ ids, deltaMs });
            return;
        }
        setKeyframeDrag(null);
        if (phase === "commit" && deltaMs !== 0) {
            freeze.run(() => updateTimeline(current => moveStoryMotionKeyframes(current, ids, deltaMs)))();
        }
    }, [freeze, updateTimeline]);

    const handlePxPerMsChange = useCallback((next: number) => {
        const value = clampPxPerMs(next);
        setTimelinePxPerMs(value);
        persistEditorPanelState({ timelinePxPerMs: value });
    }, [persistEditorPanelState]);

    // ---- keys ----------------------------------------------------------------

    const keybindings = useMemo<KeybindingDefinition[]>(() => [
        { id: "undo", key: "mod+z", description: "Undo story motion edit", handler: freeze.run(() => { timelineHistory.undo(); }) },
        { id: "redo", key: "mod+shift+z", description: "Redo story motion edit", handler: freeze.run(() => { timelineHistory.redo(); }) },
        { id: "delete", key: "delete", description: "Delete selected keyframes", handler: freeze.run(deleteSelected) },
        { id: "backspace", key: "backspace", description: "Delete selected keyframes", handler: freeze.run(deleteSelected) },
        { id: "play-pause", key: "space", description: "Play or pause", handler: togglePlayback },
        { id: "play-reverse", key: "j", description: "Play backwards", handler: () => shuttle(-1, true) },
        { id: "stop", key: "k", description: "Stop", handler: () => { if (playing) stopPlayback(); } },
        { id: "play-forward", key: "l", description: "Play forwards", handler: () => shuttle(1, true) },
        { id: "loop", key: "r", description: "Toggle loop", handler: () => setLoop(value => !value) },
        { id: "prev-frame", key: "arrowleft", description: "Step playhead back one frame", handler: () => stepPlayhead(-1) },
        { id: "next-frame", key: "arrowright", description: "Step playhead forward one frame", handler: () => stepPlayhead(1) },
        { id: "prev-frames", key: "shift+arrowleft", description: "Step playhead back ten frames", handler: () => stepPlayhead(-10) },
        { id: "next-frames", key: "shift+arrowright", description: "Step playhead forward ten frames", handler: () => stepPlayhead(10) },
        { id: "playhead-start", key: "home", description: "Move playhead to start", handler: () => setPlayheadMs(0) },
        { id: "playhead-end", key: "end", description: "Move playhead to end", handler: () => setPlayheadMs(durationRef.current) },
        { id: "prev-keyframe", key: "arrowup", description: "Go to previous keyframe", handler: () => jumpToKeyframe(-1) },
        { id: "next-keyframe", key: "arrowdown", description: "Go to next keyframe", handler: () => jumpToKeyframe(1) },
        { id: "insert-keyframe", key: "i", description: "Add keyframes at playhead", handler: freeze.run(insertKeyframes) },
        { id: "select-all", key: "mod+a", description: "Select all keyframes", handler: () => selectKeyframes(timeline.tracks.flatMap(track => track.keyframes.map(keyframe => keyframe.id))) },
        { id: "clear-selection", key: "escape", description: "Clear selection", handler: () => changeSelection([], null, "marquee") },
        { id: "copy", key: "mod+c", description: "Copy keyframes", handler: copySelected },
        { id: "cut", key: "mod+x", description: "Cut keyframes", handler: freeze.run(cutSelected) },
        { id: "paste", key: "mod+v", description: "Paste keyframes at playhead", handler: freeze.run(() => paste()) },
        { id: "nudge-left", key: "alt+arrowleft", description: "Move keyframes back one frame", handler: freeze.run(() => nudgeSelected(-1)) },
        { id: "nudge-right", key: "alt+arrowright", description: "Move keyframes forward one frame", handler: freeze.run(() => nudgeSelected(1)) },
        { id: "nudge-left-large", key: "alt+shift+arrowleft", description: "Move keyframes back ten frames", handler: freeze.run(() => nudgeSelected(-10)) },
        { id: "nudge-right-large", key: "alt+shift+arrowright", description: "Move keyframes forward ten frames", handler: freeze.run(() => nudgeSelected(10)) },
        { id: "zoom-in", key: "=", description: "Zoom timeline in", handler: () => timelineRef.current?.zoomBy(1.4) },
        { id: "zoom-out", key: "-", description: "Zoom timeline out", handler: () => timelineRef.current?.zoomBy(1 / 1.4) },
        { id: "zoom-fit", key: "0", description: "Fit the motion in the timeline", handler: () => timelineRef.current?.zoomToFit() },
    ], [changeSelection, copySelected, cutSelected, deleteSelected, freeze, insertKeyframes, jumpToKeyframe, nudgeSelected, paste, playing, selectKeyframes, shuttle, stepPlayhead, stopPlayback, timeline.tracks, timelineHistory, togglePlayback]);

    useKeybindings({
        keybindings,
        enabled: Boolean(asset && storyService),
        when: whenEditorFocused(tabId),
        idPrefix: `story-motion-editor-${tabId}`,
        catalogPrefix: "story-motion.",
    });

    // ---- stage ---------------------------------------------------------------

    const fitStage = useCallback(() => {
        const viewport = previewViewportRef.current;
        if (!viewport || viewport.clientWidth <= 0 || viewport.clientHeight <= 0) {
            return;
        }
        const zoom = clampStageZoom(Math.min(
            (viewport.clientWidth - STAGE_FIT_MARGIN * 2) / stageSize.width,
            (viewport.clientHeight - STAGE_FIT_MARGIN * 2) / stageSize.height,
        ));
        setStageZoom(zoom);
        window.requestAnimationFrame(() => centerPreviewViewport(viewport, stageSize, zoom));
    }, [stageSize]);

    // Fitted, the stage follows the size of its area; zoomed by hand, it keeps the zoom it was given.
    const hasAsset = asset !== null;
    useEffect(() => {
        const viewport = previewViewportRef.current;
        if (!hasAsset || !viewRestored || !viewport || !stageFit) {
            return;
        }
        fitStage();
        const observer = new ResizeObserver(() => fitStage());
        observer.observe(viewport);
        return () => observer.disconnect();
    }, [fitStage, hasAsset, stageFit, viewRestored]);

    // A zoom chosen by hand restores where it was left.
    useEffect(() => {
        const viewport = previewViewportRef.current;
        if (!asset || !viewRestored || !viewport || stageFit) {
            return;
        }
        const saved = readEditorPanelState().previewViewport;
        const frame = window.requestAnimationFrame(() => {
            if (saved && !saved.fit && Math.abs(saved.zoom - stageZoom) < 0.001) {
                viewport.scrollLeft = saved.scrollLeft;
                viewport.scrollTop = saved.scrollTop;
            } else {
                centerPreviewViewport(viewport, stageSize, stageZoom);
            }
        });
        return () => window.cancelAnimationFrame(frame);
        // Only when the mode or the motion changes: a zoom step re-centres itself in its own handler.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [asset?.id, stageFit, viewRestored]);

    const persistPreviewViewport = useCallback((zoom: number, fit: boolean) => {
        const viewport = previewViewportRef.current;
        if (!viewport) {
            return;
        }
        const previewViewport = { scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop, zoom, fit };
        latestEditorStateRef.current = { ...latestEditorStateRef.current, previewViewport };
        persistEditorPanelState({ previewViewport });
    }, [persistEditorPanelState]);

    const setStageZoomAround = useCallback((next: number, pointer?: { x: number; y: number }) => {
        const viewport = previewViewportRef.current;
        if (!viewport) {
            return;
        }
        const zoom = clampStageZoom(next);
        const anchor = pointer ?? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
        const contentX = (viewport.scrollLeft + anchor.x - PREVIEW_CANVAS_PADDING) / stageZoom;
        const contentY = (viewport.scrollTop + anchor.y - PREVIEW_CANVAS_PADDING) / stageZoom;
        setStageFit(false);
        setStageZoom(zoom);
        window.requestAnimationFrame(() => {
            viewport.scrollLeft = contentX * zoom + PREVIEW_CANVAS_PADDING - anchor.x;
            viewport.scrollTop = contentY * zoom + PREVIEW_CANVAS_PADDING - anchor.y;
            persistPreviewViewport(zoom, false);
        });
    }, [persistPreviewViewport, stageZoom]);

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
        setStageZoomAround(stageZoom * Math.exp(-event.deltaY * 0.0015), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    }, [setStageZoomAround, stageZoom]);

    const handlePreviewPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        focusEditor();
        if (event.button !== 1 || !previewViewportRef.current) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const viewport = previewViewportRef.current;
        previewPanRef.current = {
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
        if (!pan || pan.pointerId !== event.pointerId || !viewport) {
            return;
        }
        event.preventDefault();
        viewport.scrollLeft = pan.startScrollLeft - (event.clientX - pan.startX);
        viewport.scrollTop = pan.startScrollTop - (event.clientY - pan.startY);
    }, []);

    const stopPreviewPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const pan = previewPanRef.current;
        if (!pan || pan.pointerId !== event.pointerId) {
            return;
        }
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        previewPanRef.current = null;
        setPreviewPanning(false);
        // Panning is choosing a view by hand, so the stage stops following the area's size.
        setStageFit(false);
        persistPreviewViewport(stageZoom, false);
    }, [persistPreviewViewport, stageZoom]);

    const handlePreviewAuxClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.button === 1) {
            event.preventDefault();
        }
    }, []);

    const startPreviewDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, mode: StoryMotionPreviewDragMode) => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        stopPlayback();
        const startX = event.clientX;
        const startY = event.clientY;
        const startPreview = visiblePreview;
        const time = playheadRef.current;
        let latestValue: StoryAnimationKeyframeValue | null = null;
        let latestProperty: StoryAnimationTrackProperty | null = null;
        const onMove = (moveEvent: PointerEvent) => {
            // Position tracks the cursor in stage space (compensate the stage zoom); scale, zoom and
            // rotation follow raw screen movement so sensitivity stays constant at any stage zoom.
            const screenDx = moveEvent.clientX - startX;
            const screenDy = moveEvent.clientY - startY;
            if (mode === "position") {
                const position: StoryAlignPositionValue = {
                    xoffset: startPreview.position.xoffset + screenDx / stageZoom,
                    // yoffset is measured up from the stage bottom (NLR origin), so dragging the
                    // cursor down must decrease it for the frame to follow the pointer.
                    yoffset: startPreview.position.yoffset - screenDy / stageZoom,
                };
                latestProperty = "position";
                latestValue = position;
                setPreviewOverride({ position: { ...startPreview.position, ...position } as typeof startPreview.position });
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
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setPreviewOverride(null);
            const property = latestProperty;
            const value = latestValue;
            if (!property || value === null) {
                return;
            }
            updateTimeline(current => {
                if (property === "position" && typeof value === "object") {
                    const track = current.tracks.find(item => item.property === "position");
                    return upsertStoryMotionKeyframe(current, property, time, positionForWrite(track, startPreview.position, value));
                }
                return upsertStoryMotionKeyframe(current, property, time, value);
            });
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }, [stageZoom, stopPlayback, updateTimeline, visiblePreview]);

    const stageZoomOptions = useMemo<SelectOption[]>(() => {
        const options: SelectOption[] = [
            { value: "fit", label: t("motion.editor.zoomFit") },
            ...STAGE_ZOOM_PRESETS.map(zoom => ({ value: String(zoom), label: formatZoom(zoom) })),
        ];
        if (!stageFit && !STAGE_ZOOM_PRESETS.some(zoom => Math.abs(zoom - stageZoom) < 1e-3)) {
            options.push({ value: "custom", label: formatZoom(stageZoom) });
        }
        return options;
    }, [stageFit, stageZoom, t]);
    const stageZoomValue = stageFit
        ? "fit"
        : STAGE_ZOOM_PRESETS.find(zoom => Math.abs(zoom - stageZoom) < 1e-3)?.toString() ?? "custom";

    // ---- layout --------------------------------------------------------------

    const handleTimelineResize = useCallback((delta: number): number => {
        const bodyHeight = bodyRef.current?.clientHeight ?? 0;
        const ceiling = Math.max(MIN_TIMELINE_HEIGHT, bodyHeight - MIN_STAGE_HEIGHT);
        const current = timelineHeightRef.current;
        const next = Math.round(Math.min(ceiling, Math.max(MIN_TIMELINE_HEIGHT, current - delta)));
        setTimelineHeight(next);
        // `ResizableHandle` moves its anchor by the part of the pointer's travel the height did not
        // follow, so the seam stays under the pointer once the height is clamped. The timeline sits
        // below the seam: the pointer moving up (a negative delta) makes it taller.
        const applied = current - next;
        return applied - delta;
    }, [setTimelineHeight]);

    const saveTimelineHeight = useCallback(() => {
        panelStateService?.setPanelState(STORY_MOTION_LAYOUT_STATE_ID, { timelineHeight: timelineHeightRef.current });
    }, [panelStateService]);

    if (!asset) {
        return (
            <div className="flex h-full items-center justify-center bg-surface text-sm text-fg-muted">
                {loadError ?? t("motion.editor.loading")}
            </div>
        );
    }

    const separator = <span className="mx-1.5 h-4 w-px shrink-0 bg-edge" />;
    const shownPlayhead = Math.min(playheadMs, durationMs);
    const frameMs = storyMotionFrameDurationMs(STORY_MOTION_FPS);
    const totalFrames = Math.round(durationMs / frameMs);
    const currentFrame = Math.round(shownPlayhead / frameMs);

    return (
        <div
            ref={editorRootRef}
            className="flex h-full min-h-0 flex-col bg-surface text-fg outline-none"
            data-help-topic="storyMotion"
            tabIndex={-1}
            onMouseDownCapture={event => {
                // Only for a press on the editor itself. A menu the timeline opens is portalled out
                // of this element but still under it in React, so its presses arrive here too - and
                // taking focus from a menu closes it before the click on its row can land.
                const target = event.target as HTMLElement;
                if (!event.currentTarget.contains(target)) {
                    return;
                }
                uiService?.focus.setFocus(FocusArea.Editor, tabId);
                // A control takes focus itself, and an open dropdown closes when focus leaves it;
                // the root takes it for a press on the stage or the lanes, which hold none.
                if (!target.closest("input, textarea, select, button, [role='listbox'], [role='option'], [contenteditable='true']")) {
                    editorRootRef.current?.focus();
                }
            }}
        >
            {/* Transport and view. Everything else is a gesture, a shortcut or a track's own control. */}
            <TooltipGroup className="flex shrink-0 flex-wrap items-center gap-1 border-b border-edge bg-surface-raised px-2 py-1.5">
                <button
                    type="button"
                    onClick={togglePlayback}
                    className={ICON_BUTTON_CLASS}
                    data-tip={playing ? t("motion.editor.pause") : t("motion.editor.play")}
                    data-tip-shortcut={shortcuts.forBinding("story-motion.play-pause")}
                    aria-label={playing ? t("motion.editor.pause") : t("motion.editor.play")}
                >
                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <button
                    type="button"
                    onClick={() => setPlayheadMs(0)}
                    className={ICON_BUTTON_CLASS}
                    data-tip={t("motion.editor.toStart")}
                    data-tip-shortcut={shortcuts.forBinding("story-motion.playhead-start")}
                    aria-label={t("motion.editor.toStart")}
                >
                    <SkipBack className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    onClick={() => stepPlayhead(-1)}
                    className={ICON_BUTTON_CLASS}
                    data-tip={t("motion.editor.previousFrame")}
                    data-tip-shortcut={shortcuts.forBinding("story-motion.prev-frame")}
                    aria-label={t("motion.editor.previousFrame")}
                >
                    <StepBack className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    onClick={() => stepPlayhead(1)}
                    className={ICON_BUTTON_CLASS}
                    data-tip={t("motion.editor.nextFrame")}
                    data-tip-shortcut={shortcuts.forBinding("story-motion.next-frame")}
                    aria-label={t("motion.editor.nextFrame")}
                >
                    <StepForward className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    onClick={() => setLoop(value => !value)}
                    className={controlButtonClass(loop)}
                    data-tip={t("motion.editor.loop")}
                    data-tip-shortcut={shortcuts.forBinding("story-motion.loop")}
                    aria-label={t("motion.editor.loop")}
                    aria-pressed={loop}
                >
                    <Repeat className="h-4 w-4" />
                </button>

                {separator}

                <span className="shrink-0 tabular-nums text-xs text-fg-muted">
                    {formatClock(shownPlayhead)} / {formatClock(durationMs)}
                </span>

                {separator}

                <Select
                    size="md"
                    className="w-28"
                    options={stageZoomOptions}
                    value={stageZoomValue}
                    onChange={value => {
                        if (value === "fit") {
                            setStageFit(true);
                            persistPreviewViewport(stageZoom, true);
                        } else if (value !== "custom") {
                            setStageZoomAround(Number(value));
                        }
                    }}
                    ariaLabel={t("motion.editor.stageZoom")}
                />
            </TooltipGroup>

            <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
                <div
                    ref={previewViewportRef}
                    className={`min-h-0 flex-1 overflow-auto bg-surface-sunken ${previewPanning ? "cursor-grabbing" : "cursor-default"}`}
                    onPointerDown={handlePreviewPointerDown}
                    onPointerMove={handlePreviewPointerMove}
                    onPointerUp={stopPreviewPan}
                    onPointerCancel={stopPreviewPan}
                    onAuxClick={handlePreviewAuxClick}
                    onWheel={handlePreviewWheel}
                    onScroll={stageFit ? undefined : () => persistPreviewViewport(stageZoom, false)}
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
                                    // The stage handles are drawn only when they can be grabbed. A
                                    // resize handle IS the gesture affordance - leaving one visible
                                    // that refuses to move is the half-inert drag that reads as a
                                    // broken editor, so while frozen the frame is inspect-only.
                                    interactive={!freeze.frozen}
                                    stageSize={stageSize}
                                    showLabel={false}
                                    backgroundUrl={previewBackgroundUrl}
                                    allowOverflow
                                    canvasScale={stageZoom}
                                />
                                {positionPath.length > 1 ? (
                                    <svg
                                        className="pointer-events-none absolute left-0 top-0 overflow-visible"
                                        width={stageSize.width}
                                        height={stageSize.height}
                                        viewBox={`0 0 ${stageSize.width} ${stageSize.height}`}
                                    >
                                        <polyline
                                            points={positionPath.map(point => `${point.x},${point.y}`).join(" ")}
                                            className="fill-none stroke-primary"
                                            strokeOpacity={0.6}
                                            strokeWidth={2 / stageZoom}
                                            strokeDasharray={`${6 / stageZoom} ${6 / stageZoom}`}
                                        />
                                        {positionPath.map(point => (
                                            <circle key={point.id} cx={point.x} cy={point.y} r={4 / stageZoom} className="fill-primary" />
                                        ))}
                                    </svg>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>

                <ResizableHandle
                    direction="vertical"
                    onResize={handleTimelineResize}
                    onDragEnd={saveTimelineHeight}
                    onReset={() => {
                        setTimelineHeight(DEFAULT_TIMELINE_HEIGHT);
                        panelStateService?.setPanelState(STORY_MOTION_LAYOUT_STATE_ID, { timelineHeight: DEFAULT_TIMELINE_HEIGHT });
                    }}
                    keyboardStep={24}
                    label={t("motion.editor.resizeTimeline")}
                />

                <div className="shrink-0" style={{ height: timelineHeight }}>
                    <StoryMotionTimeline
                        ref={timelineRef}
                        tracks={tracks}
                        durationMs={durationMs}
                        playheadMs={playheadMs}
                        playing={playing}
                        selectedIds={selectedSet}
                        frozen={freeze.frozen}
                        frozenReason={freeze.reason}
                        pxPerMs={timelinePxPerMs}
                        onPxPerMsChange={handlePxPerMsChange}
                        onScrub={timeMs => {
                            if (playing) {
                                setPlayback(null);
                            }
                            seek(timeMs);
                        }}
                        onSelectionChange={changeSelection}
                        onDragKeyframes={handleDragKeyframes}
                        addableProperties={addableProperties}
                        actions={timelineActions}
                    />
                </div>
            </div>

            {/* One status bar, values only. */}
            <div className="flex shrink-0 items-center gap-3 border-t border-edge px-3 py-1 text-2xs tabular-nums text-fg-subtle">
                {selectedIds.length > 1 ? (
                    <span className="text-fg-muted">{t("motion.editor.keyframesSelected", { count: selectedIds.length })}</span>
                ) : primary ? (
                    <span className="text-fg-muted">
                        {t(`motion.propertyLabel.${primary.track.property}`)}
                        {" · "}
                        {formatSeconds(primary.keyframe.timeMs)}
                        {" · "}
                        {easingLabel(primary.keyframe.easing, t)}
                    </span>
                ) : null}
                <span className="flex-1" />
                <span>{t("motion.editor.frame", { frame: currentFrame, total: totalFrames })}</span>
                <span>{STORY_MOTION_FPS} fps</span>
                <span className="max-w-[16rem] truncate">{asset.name}</span>
            </div>
        </div>
    );
}

function easingLabel(easing: string | undefined, t: ReturnType<typeof useTranslation>["t"]): string {
    if (!easing) {
        return t("motion.keyframe.easingDefault");
    }
    return isStoryMotionEasingName(easing) ? t(`motion.easingOption.${easing}`) : t("motion.keyframe.easingCustom");
}

/** `m:ss.cc`, as the audio and video previews print a time. */
function formatClock(ms: number): string {
    const seconds = Math.max(0, Number.isFinite(ms) ? ms / 1000 : 0);
    const minutes = Math.floor(seconds / 60);
    const rest = seconds - minutes * 60;
    return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

function readTimelineHeight(panelStateService: PanelStateService | null): number {
    const saved = Number(panelStateService?.getPanelState<{ timelineHeight?: number }>(STORY_MOTION_LAYOUT_STATE_ID)?.timelineHeight);
    return Number.isFinite(saved) && saved >= MIN_TIMELINE_HEIGHT ? Math.round(saved) : DEFAULT_TIMELINE_HEIGHT;
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
    const timelinePxPerMs = Number(record.timelinePxPerMs);
    if (Number.isFinite(timelinePxPerMs) && timelinePxPerMs > 0) {
        state.timelinePxPerMs = clampPxPerMs(timelinePxPerMs);
    }
    if (typeof record.loop === "boolean") {
        state.loop = record.loop;
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
    // A view saved before the stage could be fitted was the old default, not a choice: fit it.
    return { scrollLeft, scrollTop, zoom: clampStageZoom(zoom), fit: record.fit !== false };
}

function centerPreviewViewport(
    viewport: HTMLDivElement,
    stageSize: { width: number; height: number },
    zoom: number,
): void {
    viewport.scrollLeft = PREVIEW_CANVAS_PADDING + stageSize.width * zoom / 2 - viewport.clientWidth / 2;
    viewport.scrollTop = PREVIEW_CANVAS_PADDING + stageSize.height * zoom / 2 - viewport.clientHeight / 2;
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
