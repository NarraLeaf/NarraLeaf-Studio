import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
    MouseEvent as ReactMouseEvent,
    PointerEvent as ReactPointerEvent,
    Ref,
    WheelEvent as ReactWheelEvent,
} from "react";
import { Check, ChevronLeft, ChevronRight, ClipboardPaste, Copy, Diamond, Plus, Scissors, Trash2 } from "lucide-react";
import type {
    StoryAlignPositionValue,
    StoryAnimationKeyframe,
    StoryAnimationKeyframeValue,
    StoryAnimationTrack,
    StoryAnimationTrackProperty,
} from "@shared/types/story";
import { isStoryBezierEasing } from "@shared/utils/storyEasing";
import { Button } from "@/lib/components/elements/Button";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { ShortcutContextMenu } from "../../components/ui/ShortcutContextMenu";
import {
    STORY_MOTION_DEFAULT_EASING,
    STORY_MOTION_EASING_OPTIONS,
    STORY_MOTION_FPS,
    STORY_MOTION_PROPERTIES,
    clampStoryMotionTimeMs,
    getStoryMotionPropertyMeta,
    sampleStoryMotionTrackValue,
    snapStoryMotionTimeToFrame,
} from "./storyMotionTimeline";
import { clampStoryMotionKeyframeDelta, findStoryMotionKeyframeAt, snapStoryMotionTime } from "./storyMotionEditing";

/** Width of the property column: a name, its value at the playhead, and the keyframe navigator. */
export const TIMELINE_HEADER_WIDTH = 280;
const RULER_HEIGHT = 28;
const ROW_HEIGHT = 32;
/** Room left of time zero, so a keyframe there is drawn whole instead of half under the column. */
const LANE_PAD = 12;
const DEFAULT_PX_PER_MS = 0.18;
const MIN_PX_PER_MS = 0.002;
const MAX_PX_PER_MS = 5;
const TICK_STEPS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
const TICK_MIN_PX = 64;
const SCROLL_HEADROOM_PX = 240;
/** How close, on screen, a dragged keyframe must come to the playhead or another keyframe to land on it. */
const SNAP_PX = 6;
/** Movement under this is a click, not a drag. */
const DRAG_THRESHOLD_PX = 3;

/** Operations the timeline's menus offer, carried out by the editor that owns the asset. */
export type StoryMotionTimelineActions = {
    copy: () => void;
    cut: () => void;
    paste: (atMs?: number) => void;
    canPaste: () => boolean;
    deleteSelected: () => void;
    setEasing: (easing: string | undefined) => void;
    deleteTrack: (trackId: string) => void;
    insertAtPlayhead: (trackIds: ReadonlySet<string>) => void;
    insertAt: (trackId: string, timeMs: number) => void;
    addProperty: (property: StoryAnimationTrackProperty) => void;
    writeValue: (track: StoryAnimationTrack, value: StoryAnimationKeyframeValue) => void;
    stepToKeyframe: (trackId: string, direction: -1 | 1) => void;
    toggleKeyframeAtPlayhead: (trackId: string) => void;
};

export type StoryMotionTimelineHandle = {
    zoomBy: (factor: number) => void;
    zoomToFit: () => void;
    /** Scroll a time into view if it is outside, leaving the view alone otherwise. */
    revealTime: (timeMs: number) => void;
};

type DragState =
    | { kind: "keyframes"; anchorId: string; anchorTimeMs: number; startX: number; moved: boolean; deselectOnClick: string | null; plainClick: boolean }
    | { kind: "marquee"; startX: number; startY: number; additive: boolean; base: string[]; moved: boolean; trackIndexAtStart: number };

type MenuState =
    | { kind: "keyframe"; x: number; y: number }
    | { kind: "lane"; x: number; y: number; trackId: string | null; timeMs: number }
    | { kind: "header"; x: number; y: number; trackId: string }
    | { kind: "add"; x: number; y: number };

export function StoryMotionTimeline(props: {
    ref?: Ref<StoryMotionTimelineHandle>;
    tracks: StoryAnimationTrack[];
    durationMs: number;
    playheadMs: number;
    playing: boolean;
    selectedIds: ReadonlySet<string>;
    frozen: boolean;
    frozenReason?: string;
    pxPerMs: number | null;
    onPxPerMsChange: (next: number) => void;
    onScrub: (timeMs: number) => void;
    onSelectionChange: (ids: string[], primary: string | null, gesture: "click" | "marquee") => void;
    onDragKeyframes: (ids: ReadonlySet<string>, deltaMs: number, phase: "preview" | "commit" | "cancel") => void;
    addableProperties: StoryAnimationTrackProperty[];
    actions: StoryMotionTimelineActions;
}) {
    const { t } = useTranslation();
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const lanesRef = useRef<HTMLDivElement | null>(null);
    const dragRef = useRef<DragState | null>(null);
    const [viewport, setViewport] = useState({ width: 0, scrollLeft: 0 });
    const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
    const [menu, setMenu] = useState<MenuState | null>(null);
    const fitPendingRef = useRef(props.pxPerMs === null);
    const pxPerMs = props.pxPerMs ?? DEFAULT_PX_PER_MS;
    const { tracks, durationMs, playheadMs, selectedIds, frozen, actions } = props;

    const visibleLaneWidth = Math.max(0, viewport.width - TIMELINE_HEADER_WIDTH);
    const laneWidth = Math.max(
        visibleLaneWidth,
        LANE_PAD + durationMs * pxPerMs + Math.max(SCROLL_HEADROOM_PX, visibleLaneWidth * 0.5),
    );
    const timeToX = useCallback((timeMs: number) => LANE_PAD + timeMs * pxPerMs, [pxPerMs]);
    const xToTime = useCallback((x: number) => (x - LANE_PAD) / pxPerMs, [pxPerMs]);

    // ---- viewport ------------------------------------------------------------

    useEffect(() => {
        const container = scrollRef.current;
        if (!container) {
            return;
        }
        const update = () => {
            const width = container.clientWidth;
            // Coarse steps: the ticks only need to know roughly where the view is, and every
            // distinct value is a render.
            const scrollLeft = Math.round(container.scrollLeft / 25) * 25;
            setViewport(current => current.width === width && current.scrollLeft === scrollLeft ? current : { width, scrollLeft });
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(container);
        container.addEventListener("scroll", update, { passive: true });
        return () => {
            observer.disconnect();
            container.removeEventListener("scroll", update);
        };
    }, []);

    const fitZoom = useCallback(() => {
        const container = scrollRef.current;
        if (!container) {
            return;
        }
        const visible = container.clientWidth - TIMELINE_HEADER_WIDTH - LANE_PAD * 2;
        if (visible <= 0) {
            return;
        }
        const headroom = Math.max(durationMs * 0.15, 200);
        props.onPxPerMsChange(clampPxPerMs(visible / (durationMs + headroom)));
        container.scrollLeft = 0;
    }, [durationMs, props]);

    // A motion opened for the first time is fitted to the view; one with a saved zoom keeps it.
    useLayoutEffect(() => {
        if (!fitPendingRef.current || viewport.width === 0) {
            return;
        }
        fitPendingRef.current = false;
        if (props.pxPerMs === null) {
            fitZoom();
        }
    }, [fitZoom, props.pxPerMs, viewport.width]);

    /** Zoom about a point in the lanes, keeping the time under it where it is on screen. */
    const zoomAround = useCallback((factor: number, anchorClientX?: number) => {
        const container = scrollRef.current;
        if (!container) {
            return;
        }
        const rect = container.getBoundingClientRect();
        const visible = container.clientWidth - TIMELINE_HEADER_WIDTH;
        const playheadOnScreen = TIMELINE_HEADER_WIDTH + timeToX(playheadMs) - container.scrollLeft;
        const pointerX = anchorClientX !== undefined
            ? Math.max(TIMELINE_HEADER_WIDTH, anchorClientX - rect.left)
            : playheadOnScreen >= TIMELINE_HEADER_WIDTH && playheadOnScreen <= TIMELINE_HEADER_WIDTH + visible
                ? playheadOnScreen
                : TIMELINE_HEADER_WIDTH + visible / 2;
        const next = clampPxPerMs(pxPerMs * factor);
        if (next === pxPerMs) {
            return;
        }
        const timeAtPointer = Math.max(0, (container.scrollLeft + pointerX - TIMELINE_HEADER_WIDTH - LANE_PAD) / pxPerMs);
        props.onPxPerMsChange(next);
        window.requestAnimationFrame(() => {
            container.scrollLeft = timeAtPointer * next + LANE_PAD + TIMELINE_HEADER_WIDTH - pointerX;
        });
    }, [playheadMs, props, pxPerMs, timeToX]);

    const revealTime = useCallback((timeMs: number) => {
        const container = scrollRef.current;
        if (!container) {
            return;
        }
        const x = timeToX(timeMs);
        const visible = container.clientWidth - TIMELINE_HEADER_WIDTH;
        if (x < container.scrollLeft + LANE_PAD) {
            container.scrollLeft = Math.max(0, x - LANE_PAD * 2);
        } else if (x > container.scrollLeft + visible - LANE_PAD) {
            container.scrollLeft = x - visible + LANE_PAD * 2;
        }
    }, [timeToX]);

    useImperativeHandle(props.ref, () => ({
        zoomBy: factor => zoomAround(factor),
        zoomToFit: fitZoom,
        revealTime,
    }), [fitZoom, revealTime, zoomAround]);

    // Wherever the playhead goes - playback, a key, a jump to a keyframe - the view follows it rather
    // than letting it run off the edge. Not while keyframes are dragged: scrolling under a held
    // pointer would move them further.
    useEffect(() => {
        if (dragRef.current?.kind !== "keyframes") {
            revealTime(Math.min(playheadMs, durationMs));
        }
    }, [durationMs, playheadMs, revealTime]);

    const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
        const container = event.currentTarget;
        if (event.ctrlKey) {
            event.preventDefault();
            zoomAround(Math.exp(-event.deltaY * 0.0015), event.clientX);
            return;
        }
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
    }, [zoomAround]);

    // ---- pointer -------------------------------------------------------------

    const snappedTime = useCallback((rawMs: number, free: boolean) => {
        const clamped = clampStoryMotionTimeMs(rawMs);
        return free ? clamped : snapStoryMotionTimeToFrame(clamped, STORY_MOTION_FPS);
    }, []);

    const laneTimeAt = useCallback((clientX: number, free: boolean) => {
        const rect = lanesRef.current?.getBoundingClientRect();
        if (!rect) {
            return 0;
        }
        return snappedTime(xToTime(clientX - rect.left), free);
    }, [snappedTime, xToTime]);

    const startRulerScrub = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const scrub = (clientX: number, free: boolean) => {
            const value = snappedTime(xToTime(clientX - rect.left), free);
            // The playhead stays inside the motion: past the last keyframe there is nothing to show.
            props.onScrub(Math.min(durationMs, Math.max(0, value)));
        };
        scrub(event.clientX, event.altKey);
        const target = event.currentTarget;
        target.setPointerCapture(event.pointerId);
        const onMove = (moveEvent: PointerEvent) => scrub(moveEvent.clientX, moveEvent.altKey);
        const onUp = () => {
            target.removeEventListener("pointermove", onMove);
            target.removeEventListener("pointerup", onUp);
            target.removeEventListener("pointercancel", onUp);
        };
        target.addEventListener("pointermove", onMove);
        target.addEventListener("pointerup", onUp);
        target.addEventListener("pointercancel", onUp);
    }, [durationMs, props, snappedTime, xToTime]);

    const allKeyframes = useMemo(() => tracks.flatMap((track, rowIndex) => track.keyframes.map(keyframe => ({ track, rowIndex, keyframe }))), [tracks]);

    const startKeyframePointer = useCallback((event: ReactPointerEvent<HTMLButtonElement>, track: StoryAnimationTrack, keyframe: StoryAnimationKeyframe) => {
        if (event.button !== 0) {
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        const additive = event.shiftKey || event.ctrlKey || event.metaKey;
        const wasSelected = selectedIds.has(keyframe.id);
        let selection = [...selectedIds];
        if (additive) {
            if (!wasSelected) {
                selection = [...selection, keyframe.id];
                props.onSelectionChange(selection, keyframe.id, "click");
            }
        } else if (!wasSelected) {
            selection = [keyframe.id];
            props.onSelectionChange(selection, keyframe.id, "click");
        }
        dragRef.current = {
            kind: "keyframes",
            anchorId: keyframe.id,
            anchorTimeMs: keyframe.timeMs,
            startX: event.clientX,
            moved: false,
            deselectOnClick: additive && wasSelected ? keyframe.id : null,
            plainClick: !additive,
        };
        const ids = new Set(selection);
        const otherTimes = [
            0,
            playheadMs,
            ...allKeyframes.filter(item => !ids.has(item.keyframe.id)).map(item => item.keyframe.timeMs),
        ];
        let lastDelta = 0;
        // Against the timeline as it was when the drag began: the tracks drawn during it already
        // carry the move being previewed.
        const startTracks = tracks;
        const clampDelta = (delta: number) => clampStoryMotionKeyframeDelta({ tracks: startTracks }, ids, delta);
        const onMove = (moveEvent: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag || drag.kind !== "keyframes" || frozen) {
                return;
            }
            if (!drag.moved && Math.abs(moveEvent.clientX - drag.startX) < DRAG_THRESHOLD_PX) {
                return;
            }
            drag.moved = true;
            const rawTime = drag.anchorTimeMs + (moveEvent.clientX - drag.startX) / pxPerMs;
            const snapped = moveEvent.altKey ? null : snapStoryMotionTime(rawTime, otherTimes, SNAP_PX, pxPerMs);
            const anchorTime = snapped ?? snappedTime(rawTime, moveEvent.altKey);
            lastDelta = clampDelta(anchorTime - drag.anchorTimeMs);
            props.onDragKeyframes(ids, lastDelta, "preview");
            props.onScrub(clampStoryMotionTimeMs(drag.anchorTimeMs + lastDelta));
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onCancel);
            const drag = dragRef.current;
            dragRef.current = null;
            if (!drag || drag.kind !== "keyframes") {
                return;
            }
            if (drag.moved) {
                props.onDragKeyframes(ids, lastDelta, lastDelta === 0 ? "cancel" : "commit");
                return;
            }
            if (drag.deselectOnClick) {
                const next = selection.filter(id => id !== drag.deselectOnClick);
                props.onSelectionChange(next, next[next.length - 1] ?? null, "click");
                return;
            }
            if (drag.plainClick) {
                props.onSelectionChange([keyframe.id], keyframe.id, "click");
                props.onScrub(keyframe.timeMs);
            }
        };
        const onCancel = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onCancel);
            dragRef.current = null;
            props.onDragKeyframes(ids, 0, "cancel");
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
    }, [allKeyframes, frozen, playheadMs, props, pxPerMs, selectedIds, snappedTime, tracks]);

    const startLanePointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !lanesRef.current) {
            return;
        }
        const rect = lanesRef.current.getBoundingClientRect();
        const additive = event.shiftKey || event.ctrlKey || event.metaKey;
        const startX = event.clientX - rect.left;
        const startY = event.clientY - rect.top;
        dragRef.current = {
            kind: "marquee",
            startX,
            startY,
            additive,
            base: additive ? [...selectedIds] : [],
            moved: false,
            trackIndexAtStart: Math.floor(startY / ROW_HEIGHT),
        };
        const free = event.altKey;
        const clickTime = laneTimeAt(event.clientX, free);
        const onMove = (moveEvent: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag || drag.kind !== "marquee") {
                return;
            }
            const x = moveEvent.clientX - rect.left;
            const y = moveEvent.clientY - rect.top;
            if (!drag.moved && Math.hypot(x - drag.startX, y - drag.startY) < DRAG_THRESHOLD_PX) {
                return;
            }
            drag.moved = true;
            const box = { x0: Math.min(drag.startX, x), y0: Math.min(drag.startY, y), x1: Math.max(drag.startX, x), y1: Math.max(drag.startY, y) };
            setMarquee(box);
            const firstRow = Math.max(0, Math.floor(box.y0 / ROW_HEIGHT));
            const lastRow = Math.min(tracks.length - 1, Math.floor(box.y1 / ROW_HEIGHT));
            const fromMs = xToTime(box.x0);
            const toMs = xToTime(box.x1);
            const covered = allKeyframes
                .filter(item => item.rowIndex >= firstRow && item.rowIndex <= lastRow
                    && item.keyframe.timeMs >= fromMs && item.keyframe.timeMs <= toMs)
                .map(item => item.keyframe.id);
            const ids = [...new Set([...drag.base, ...covered])];
            props.onSelectionChange(ids, covered[covered.length - 1] ?? ids[ids.length - 1] ?? null, "marquee");
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
            const drag = dragRef.current;
            dragRef.current = null;
            setMarquee(null);
            if (!drag || drag.kind !== "marquee" || drag.moved) {
                return;
            }
            // A plain click in the lanes moves the playhead there and lets go of the selection, as
            // in the audio and video previews.
            if (!drag.additive) {
                props.onSelectionChange([], null, "click");
            }
            props.onScrub(Math.min(durationMs, clickTime));
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
    }, [allKeyframes, durationMs, laneTimeAt, props, selectedIds, tracks.length, xToTime]);

    const handleLaneDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>, track: StoryAnimationTrack | undefined) => {
        if (!track || frozen || (event.target as HTMLElement | null)?.closest("button")) {
            return;
        }
        actions.insertAt(track.id, laneTimeAt(event.clientX, event.altKey));
    }, [actions, frozen, laneTimeAt]);

    const trackAtClientY = useCallback((clientY: number) => {
        const rect = lanesRef.current?.getBoundingClientRect();
        if (!rect) {
            return undefined;
        }
        return tracks[Math.floor((clientY - rect.top) / ROW_HEIGHT)];
    }, [tracks]);

    // ---- menus ---------------------------------------------------------------

    const selectTrack = useCallback((track: StoryAnimationTrack, additive: boolean) => {
        const ids = track.keyframes.map(keyframe => keyframe.id);
        const next = additive ? [...new Set([...selectedIds, ...ids])] : ids;
        props.onSelectionChange(next, ids[0] ?? null, "click");
    }, [props, selectedIds]);

    const openKeyframeMenu = useCallback((event: ReactMouseEvent, keyframe: StoryAnimationKeyframe) => {
        event.preventDefault();
        event.stopPropagation();
        if (!selectedIds.has(keyframe.id)) {
            props.onSelectionChange([keyframe.id], keyframe.id, "click");
        }
        setMenu({ kind: "keyframe", x: event.clientX, y: event.clientY });
    }, [props, selectedIds]);

    const openLaneMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const track = trackAtClientY(event.clientY);
        setMenu({ kind: "lane", x: event.clientX, y: event.clientY, trackId: track?.id ?? null, timeMs: laneTimeAt(event.clientX, event.altKey) });
    }, [laneTimeAt, trackAtClientY]);

    const openHeaderMenu = useCallback((event: ReactMouseEvent, track: StoryAnimationTrack) => {
        event.preventDefault();
        event.stopPropagation();
        setMenu({ kind: "header", x: event.clientX, y: event.clientY, trackId: track.id });
    }, []);

    const selectedEasing = useMemo(() => {
        const easings = new Set<string>();
        for (const item of allKeyframes) {
            if (selectedIds.has(item.keyframe.id)) {
                easings.add(item.keyframe.easing ?? "");
            }
        }
        return easings.size === 1 ? [...easings][0] : null;
    }, [allKeyframes, selectedIds]);

    const menuItems = useMemo<ContextMenuDef>(() => {
        if (!menu) {
            return [];
        }
        const writeRow = frozen ? { disabled: true, tooltip: props.frozenReason } : {};
        if (menu.kind === "add") {
            const core = props.addableProperties.filter(property => getStoryMotionPropertyMeta(property).core);
            const effects = props.addableProperties.filter(property => !getStoryMotionPropertyMeta(property).core);
            const row = (property: StoryAnimationTrackProperty) => ({
                id: `add-${property}`,
                label: t(`motion.propertyLabel.${property}`),
                ...writeRow,
                onClick: () => actions.addProperty(property),
            });
            return [
                ...core.map(row),
                ...(core.length > 0 && effects.length > 0 ? [{ id: "add-separator", separator: true as const }] : []),
                ...effects.map(row),
            ];
        }
        if (menu.kind === "header") {
            const track = tracks.find(item => item.id === menu.trackId);
            if (!track) {
                return [];
            }
            return [
                { id: "insert", label: t("motion.editor.addKeyframeAtPlayhead"), icon: <Diamond className="h-4 w-4" />, ...writeRow, onClick: () => actions.insertAtPlayhead(new Set([track.id])) },
                { id: "select-track", label: t("motion.editor.selectTrackKeyframes"), onClick: () => selectTrack(track, false) },
                { id: "header-separator", separator: true },
                { id: "delete-track", label: t("motion.editor.deleteTrack"), icon: <Trash2 className="h-4 w-4" />, ...writeRow, onClick: () => actions.deleteTrack(track.id) },
            ];
        }
        if (menu.kind === "lane") {
            return [
                ...(menu.trackId
                    ? [{ id: "insert-here", label: t("motion.editor.addKeyframeHere"), icon: <Diamond className="h-4 w-4" />, ...writeRow, onClick: () => actions.insertAt(menu.trackId!, menu.timeMs) }]
                    : []),
                {
                    id: "paste",
                    label: t("common.paste"),
                    icon: <ClipboardPaste className="h-4 w-4" />,
                    ...(frozen ? writeRow : { disabled: !actions.canPaste() }),
                    onClick: () => actions.paste(menu.timeMs),
                },
            ];
        }
        const easingRows = [
            { value: "", label: t("motion.keyframe.easingDefault") },
            ...STORY_MOTION_EASING_OPTIONS.map(option => ({ value: option.value, label: t(`motion.easingOption.${option.value}`) })),
        ];
        return [
            {
                id: "easing",
                label: t("motion.keyframe.easing"),
                ...writeRow,
                submenuIconsEnabled: true,
                submenu: easingRows.map(option => ({
                    id: `easing-${option.value || "default"}`,
                    label: option.label,
                    icon: selectedEasing === option.value ? <Check className="h-4 w-4" /> : undefined,
                    onClick: () => actions.setEasing(option.value || undefined),
                })),
            },
            { id: "keyframe-separator", separator: true },
            { id: "copy", label: t("common.copy"), icon: <Copy className="h-4 w-4" />, onClick: actions.copy },
            { id: "cut", label: t("common.cut"), icon: <Scissors className="h-4 w-4" />, ...writeRow, onClick: actions.cut },
            {
                id: "paste",
                label: t("common.paste"),
                icon: <ClipboardPaste className="h-4 w-4" />,
                ...(frozen ? writeRow : { disabled: !actions.canPaste() }),
                onClick: () => actions.paste(),
            },
            { id: "delete-separator", separator: true },
            { id: "delete", label: t("common.delete"), icon: <Trash2 className="h-4 w-4" />, ...writeRow, onClick: actions.deleteSelected },
        ];
    }, [actions, frozen, menu, props.addableProperties, props.frozenReason, selectTrack, selectedEasing, t, tracks]);

    // ---- render --------------------------------------------------------------

    const ticks = useMemo(
        () => buildTicks(pxPerMs, laneWidth, viewport),
        [laneWidth, pxPerMs, viewport],
    );
    const contentHeight = tracks.length * ROW_HEIGHT;
    const endX = timeToX(durationMs);
    const playheadX = timeToX(Math.min(playheadMs, durationMs));
    const selectedTrackIds = useMemo(() => new Set(allKeyframes.filter(item => selectedIds.has(item.keyframe.id)).map(item => item.track.id)), [allKeyframes, selectedIds]);

    return (
        <div
            ref={scrollRef}
            className="relative h-full overflow-auto overscroll-contain"
            onWheel={handleWheel}
        >
            <div className="relative flex min-h-full flex-col" style={{ width: TIMELINE_HEADER_WIDTH + laneWidth }}>
                {/* The ruler row and the property column are `bg-surface-sunken`: they are sticky, so
                    they have to hide what scrolls under them, and the base surface is cleared to
                    transparent under a workspace wallpaper. */}
                <div className="sticky top-0 z-30 flex shrink-0 border-b border-edge" style={{ height: RULER_HEIGHT }}>
                    <div
                        className="sticky left-0 z-40 flex shrink-0 items-center border-r border-edge bg-surface-sunken px-1"
                        style={{ width: TIMELINE_HEADER_WIDTH }}
                    >
                        <Button
                            variant="ghost"
                            size="sm"
                            className="min-h-6 gap-1.5 px-2 text-xs"
                            onClick={event => {
                                const rect = event.currentTarget.getBoundingClientRect();
                                setMenu({ kind: "add", x: rect.left, y: rect.bottom + 2 });
                            }}
                            disabled={props.addableProperties.length === 0}
                        >
                            <Plus className="h-3.5 w-3.5" />
                            {t("motion.editor.addProperty")}
                        </Button>
                    </div>
                    <div
                        className="relative flex-1 select-none bg-surface-sunken"
                        onPointerDown={startRulerScrub}
                    >
                        {ticks.map(tick => (
                            <div key={tick.timeMs} className="pointer-events-none absolute bottom-0 h-full" style={{ left: timeToX(tick.timeMs) }}>
                                <div className="absolute bottom-0 h-1.5 border-l border-edge-strong" />
                                <span className="absolute left-1 top-1.5 whitespace-nowrap text-2xs tabular-nums text-fg-subtle">{tick.label}</span>
                            </div>
                        ))}
                        <div className="pointer-events-none absolute inset-y-0 right-0 bg-surface-canvas/40" style={{ left: endX }} />
                        <svg
                            className="pointer-events-none absolute bottom-0 z-10 -translate-x-1/2 fill-current text-fg"
                            style={{ left: playheadX }}
                            width={11}
                            height={7}
                            viewBox="0 0 11 7"
                        >
                            <path d="M0 0H11L5.5 7Z" />
                        </svg>
                    </div>
                </div>

                <div className="relative flex flex-1">
                    <div
                        className="sticky left-0 z-20 shrink-0 self-stretch border-r border-edge bg-surface-sunken"
                        style={{ width: TIMELINE_HEADER_WIDTH }}
                    >
                        {tracks.map(track => (
                            <TrackHeader
                                key={track.id}
                                track={track}
                                playheadMs={playheadMs}
                                frozen={frozen}
                                frozenReason={props.frozenReason}
                                highlighted={selectedTrackIds.has(track.id)}
                                actions={actions}
                                onSelect={selectTrack}
                                onContextMenu={openHeaderMenu}
                            />
                        ))}
                    </div>

                    <div
                        ref={lanesRef}
                        className="relative flex-1 select-none"
                        onPointerDown={startLanePointer}
                        onDoubleClick={event => handleLaneDoubleClick(event, trackAtClientY(event.clientY))}
                        onContextMenu={openLaneMenu}
                    >
                        {ticks.map(tick => (
                            <div key={tick.timeMs} className="pointer-events-none absolute inset-y-0 border-l border-edge-subtle" style={{ left: timeToX(tick.timeMs) }} />
                        ))}
                        {/* Past the last keyframe the motion has ended, so the lanes there are dimmed. */}
                        <div className="pointer-events-none absolute inset-y-0 right-0 border-l border-edge bg-surface-canvas/40" style={{ left: endX }} />
                        {tracks.map((track, index) => (
                            <TrackLane
                                key={track.id}
                                track={track}
                                top={index * ROW_HEIGHT}
                                pxPerMs={pxPerMs}
                                selectedIds={selectedIds}
                                onKeyframePointerDown={startKeyframePointer}
                                onKeyframeContextMenu={openKeyframeMenu}
                            />
                        ))}
                        <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-fg" style={{ left: playheadX }} />
                        {marquee ? (
                            <div
                                className="pointer-events-none absolute z-20 border border-primary/70 bg-primary/10"
                                style={{ left: marquee.x0, top: marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0 }}
                            />
                        ) : null}
                        <div style={{ height: contentHeight }} />
                    </div>
                </div>
            </div>
            {menu ? (
                <ShortcutContextMenu
                    items={menuItems}
                    position={{ x: menu.x, y: menu.y }}
                    visible
                    onClose={() => setMenu(null)}
                    iconsEnabled={menu.kind !== "add"}
                    shortcuts={MENU_SHORTCUTS}
                />
            ) : null}
        </div>
    );
}

/** Menu row id → the command it shares a key with, so the menu prints the key. */
const MENU_SHORTCUTS: Readonly<Record<string, string>> = {
    "copy": "story-motion.copy",
    "cut": "story-motion.cut",
    "paste": "story-motion.paste",
    "delete": "story-motion.delete",
    "insert": "story-motion.insert-keyframe",
};

const TrackHeader = memo(function TrackHeader(props: {
    track: StoryAnimationTrack;
    playheadMs: number;
    frozen: boolean;
    frozenReason?: string;
    highlighted: boolean;
    actions: StoryMotionTimelineActions;
    onSelect: (track: StoryAnimationTrack, additive: boolean) => void;
    onContextMenu: (event: ReactMouseEvent, track: StoryAnimationTrack) => void;
}) {
    const { t } = useTranslation();
    const { track, playheadMs, actions } = props;
    const label = t(`motion.propertyLabel.${track.property}`);
    const onKeyframe = findStoryMotionKeyframeAt(track, playheadMs) !== null;
    const times = track.keyframes.map(keyframe => keyframe.timeMs);
    const hasPrevious = times.some(time => time < playheadMs - 0.5);
    const hasNext = times.some(time => time > playheadMs + 0.5);
    const writes = props.frozen ? { disabled: true, "data-tip": props.frozenReason } : {};
    return (
        <div
            className="group flex items-center gap-1.5 border-b border-edge-subtle pl-3 pr-1"
            style={{ height: ROW_HEIGHT }}
            onContextMenu={event => props.onContextMenu(event, track)}
        >
            <button
                type="button"
                className={cn(
                    "min-w-0 flex-1 cursor-default truncate text-left text-xs focus-visible:outline-none",
                    props.highlighted ? "text-fg" : "text-fg-muted hover:text-fg",
                )}
                onClick={event => props.onSelect(track, event.shiftKey || event.ctrlKey || event.metaKey)}
            >
                {label}
            </button>
            <TrackValue track={track} playheadMs={playheadMs} frozen={props.frozen} label={label} onWrite={actions.writeValue} />
            <div className="flex shrink-0 items-center">
                <ToolbarButton
                    size="xs"
                    onClick={() => actions.stepToKeyframe(track.id, -1)}
                    disabled={!hasPrevious}
                    aria-label={t("motion.editor.previousKeyframe")}
                >
                    <ChevronLeft className="h-3.5 w-3.5" />
                </ToolbarButton>
                <ToolbarButton
                    size="xs"
                    onClick={() => actions.toggleKeyframeAtPlayhead(track.id)}
                    aria-label={onKeyframe ? t("motion.editor.removeKeyframeAria", { property: label }) : t("motion.editor.addKeyframeAria", { property: label })}
                    aria-pressed={onKeyframe}
                    className={onKeyframe ? "text-primary hover:text-primary" : undefined}
                    {...writes}
                >
                    <Diamond className={cn("h-3.5 w-3.5", onKeyframe && "fill-current")} />
                </ToolbarButton>
                <ToolbarButton
                    size="xs"
                    onClick={() => actions.stepToKeyframe(track.id, 1)}
                    disabled={!hasNext}
                    aria-label={t("motion.editor.nextKeyframe")}
                >
                    <ChevronRight className="h-3.5 w-3.5" />
                </ToolbarButton>
            </div>
        </div>
    );
});

/**
 * The track's value at the playhead, as a field: typing a number keys it there. Position shows its
 * two offsets, which are what dragging the target on the stage changes; a text property shows its
 * value, edited in the keyframe's properties.
 */
function TrackValue(props: {
    track: StoryAnimationTrack;
    playheadMs: number;
    frozen: boolean;
    label: string;
    onWrite: (track: StoryAnimationTrack, value: StoryAnimationKeyframeValue) => void;
}) {
    const { t } = useTranslation();
    const { track } = props;
    const meta = getStoryMotionPropertyMeta(track.property);
    const value = sampleStoryMotionTrackValue(track, props.playheadMs);
    const resetKey = `${track.id}:${Math.round(props.playheadMs)}`;
    const fieldProps = {
        size: "sm" as const,
        popoverWhenNarrow: false,
        selectAllOnFocus: true,
        commitOn: "blur" as const,
        inputMode: "decimal" as const,
        readOnly: props.frozen,
        draftResetKey: resetKey,
        onPointerDown: (event: ReactPointerEvent) => event.stopPropagation(),
    };
    if (meta.valueKind === "position") {
        const position = value && typeof value === "object" ? value : {};
        const write = (axis: keyof StoryAlignPositionValue, next: number) => props.onWrite(track, { [axis]: next });
        return (
            <div className="flex shrink-0 items-center gap-1">
                {(["xoffset", "yoffset"] as const).map(axis => (
                    <NumericDraftEnhancedInput
                        key={axis}
                        {...fieldProps}
                        className="w-14 shrink-0"
                        inputClassName="pl-5 pr-1.5 text-right tabular-nums"
                        leftIcon={<span className="text-2xs text-fg-subtle">{axis === "xoffset" ? "X" : "Y"}</span>}
                        committedDisplay={formatNumber(position[axis] ?? 0, 0)}
                        onFiniteNumber={next => write(axis, next)}
                        aria-label={t(axis === "xoffset" ? "motion.keyframe.xOffset" : "motion.keyframe.yOffset")}
                    />
                ))}
            </div>
        );
    }
    if (meta.valueKind === "number") {
        return (
            <NumericDraftEnhancedInput
                {...fieldProps}
                className="w-16 shrink-0"
                inputClassName="px-1.5 text-right tabular-nums"
                committedDisplay={formatNumber(typeof value === "number" ? value : 0, track.property === "rotation" ? 1 : 2)}
                onFiniteNumber={next => props.onWrite(track, next)}
                aria-label={props.label}
            />
        );
    }
    return typeof value === "string" && value ? (
        <span className="min-w-0 max-w-28 shrink truncate text-2xs text-fg-subtle">{value}</span>
    ) : null;
}

const TrackLane = memo(function TrackLane(props: {
    track: StoryAnimationTrack;
    top: number;
    pxPerMs: number;
    selectedIds: ReadonlySet<string>;
    onKeyframePointerDown: (event: ReactPointerEvent<HTMLButtonElement>, track: StoryAnimationTrack, keyframe: StoryAnimationKeyframe) => void;
    onKeyframeContextMenu: (event: ReactMouseEvent, keyframe: StoryAnimationKeyframe) => void;
}) {
    const { t } = useTranslation();
    const { track, pxPerMs } = props;
    const label = t(`motion.propertyLabel.${track.property}`);
    const times = track.keyframes.map(keyframe => keyframe.timeMs);
    const first = Math.min(...times);
    const last = Math.max(...times);
    return (
        <div className="absolute inset-x-0 border-b border-edge-subtle" style={{ top: props.top, height: ROW_HEIGHT }}>
            {/* Where the property is changing: from its first keyframe to its last. */}
            {last > first ? (
                <div
                    className="pointer-events-none absolute top-1/2 border-t border-edge-strong"
                    style={{ left: LANE_PAD + first * pxPerMs, width: (last - first) * pxPerMs }}
                />
            ) : null}
            {track.keyframes.map(keyframe => {
                const selected = props.selectedIds.has(keyframe.id);
                const eased = keyframeIsEased(keyframe);
                return (
                    <button
                        key={keyframe.id}
                        type="button"
                        tabIndex={-1}
                        className="group absolute top-1/2 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-default place-items-center focus:outline-none"
                        style={{ left: LANE_PAD + keyframe.timeMs * pxPerMs }}
                        onPointerDown={event => props.onKeyframePointerDown(event, track, keyframe)}
                        onContextMenu={event => props.onKeyframeContextMenu(event, keyframe)}
                        aria-label={`${label} ${formatSeconds(keyframe.timeMs)}`}
                        aria-pressed={selected}
                    >
                        {/* A diamond is a linear keyframe; a round one eases into its value. */}
                        <span
                            className={cn(
                                "block border",
                                eased ? "h-2.5 w-2.5 rounded-full" : "h-2.5 w-2.5 rotate-45 rounded-sm",
                                selected
                                    ? "border-primary bg-primary"
                                    : "border-fg-muted bg-fg-muted group-hover:border-fg group-hover:bg-fg",
                            )}
                        />
                    </button>
                );
            })}
        </div>
    );
});

function keyframeIsEased(keyframe: StoryAnimationKeyframe): boolean {
    const easing = keyframe.easing ?? STORY_MOTION_DEFAULT_EASING;
    if (isStoryBezierEasing(easing)) {
        return easing.replace(/\s+/g, "") !== "cubic-bezier(0,0,1,1)";
    }
    return easing !== "linear";
}

/** The value of a property as the track header and the status bar print it. */
export function formatStoryMotionValue(property: StoryAnimationTrackProperty, value: StoryAnimationKeyframeValue | undefined): string {
    if (value === undefined) {
        return "";
    }
    if (typeof value === "number") {
        return property === "rotation" ? `${formatNumber(value, 1)}°` : formatNumber(value, 2);
    }
    if (typeof value === "object") {
        return `${formatNumber(value.xoffset ?? 0, 0)}, ${formatNumber(value.yoffset ?? 0, 0)}`;
    }
    return value;
}

function formatNumber(value: number, digits: number): string {
    if (!Number.isFinite(value)) {
        return "0";
    }
    const fixed = value.toFixed(digits);
    const trimmed = digits > 0 ? fixed.replace(/\.?0+$/, "") : fixed;
    return trimmed === "-0" ? "0" : trimmed;
}

/** Seconds with as many decimals as a frame needs, never a trailing zero. */
export function formatSeconds(timeMs: number): string {
    return `${formatNumber(timeMs / 1000, 3)}s`;
}

function buildTicks(
    pxPerMs: number,
    laneWidth: number,
    viewport: { width: number; scrollLeft: number },
): { timeMs: number; label: string }[] {
    const step = TICK_STEPS.find(candidate => candidate * pxPerMs >= TICK_MIN_PX) ?? TICK_STEPS[TICK_STEPS.length - 1];
    const maxTimeMs = (laneWidth - LANE_PAD) / pxPerMs;
    // A full viewport of buffer each side, so a fast scroll does not outrun the ticks drawn.
    const bufferPx = Math.max(200, viewport.width);
    const startMs = viewport.width > 0 ? Math.max(0, (viewport.scrollLeft - LANE_PAD - bufferPx) / pxPerMs) : 0;
    const endMs = viewport.width > 0
        ? Math.min(maxTimeMs, (viewport.scrollLeft + viewport.width - LANE_PAD + bufferPx) / pxPerMs)
        : maxTimeMs;
    const digits = step % 1000 === 0 ? 0 : step % 100 === 0 ? 1 : step % 10 === 0 ? 2 : 3;
    const ticks: { timeMs: number; label: string }[] = [];
    for (let timeMs = Math.floor(startMs / step) * step; timeMs <= endMs; timeMs += step) {
        ticks.push({ timeMs, label: `${(timeMs / 1000).toFixed(digits)}s` });
    }
    return ticks;
}

export function clampPxPerMs(value: number): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_PX_PER_MS;
    }
    return Math.min(MAX_PX_PER_MS, Math.max(MIN_PX_PER_MS, value));
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

/** Every property, in the order the timeline lists tracks. */
export function orderStoryMotionTracks(tracks: StoryAnimationTrack[]): StoryAnimationTrack[] {
    return [...tracks].sort((a, b) => {
        const left = STORY_MOTION_PROPERTIES.findIndex(item => item.property === a.property);
        const right = STORY_MOTION_PROPERTIES.findIndex(item => item.property === b.property);
        return left - right || a.id.localeCompare(b.id);
    });
}
