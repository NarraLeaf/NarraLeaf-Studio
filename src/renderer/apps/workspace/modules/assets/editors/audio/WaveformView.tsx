import { useCallback, useEffect, useRef } from "react";
import { computePeaks, type AudioClip, type SampleRange } from "./audioClip";
import type { AssetCuePoint } from "@/lib/workspace/services/assets/types";

/** Cue points are stored on the asset; the view just draws whatever it is handed. */
export type AudioCuePoint = AssetCuePoint;

interface WaveformViewProps {
    clip: AudioClip;
    /** Visible sample window — the zoom/scroll state, owned by the editor. */
    view: SampleRange;
    selection: SampleRange | null;
    cuePoints: AudioCuePoint[];
    /** Playhead position in samples, or null when stopped at the start. */
    playhead: number | null;
    onSelectionChange: (range: SampleRange | null) => void;
    onSeek: (sample: number) => void;
    onAddCue: (sample: number) => void;
    onRemoveCue: (index: number) => void;
    /** Live during a marker drag — the editor applies these without touching undo history. */
    onCueDrag: (index: number, sample: number) => void;
    /** End of a marker drag: the editor commits one history step for the whole gesture. */
    onCueDragEnd: () => void;
    onSelectAll: () => void;
}

const RULER_HEIGHT = 16;
/**
 * The marker strip, between the ruler and the waveform.
 *
 * Markers are grabbed here and nowhere else. When they were grabbable along their full height
 * every marker was a vertical dead zone across the whole waveform that swallowed selection drags;
 * confining them to their own band is what makes both gestures unambiguous — the same split
 * Premiere draws between its marker bar and its tracks.
 */
const MARKER_STRIP_HEIGHT = 13;
const WAVE_TOP = RULER_HEIGHT + MARKER_STRIP_HEIGHT;
/** Drags shorter than this are a click, not a drag. */
const DRAG_THRESHOLD_PX = 3;
/** How close the pointer must get to grab a marker or a selection edge. */
const GRAB_TOLERANCE_PX = 5;
/** Below this a lane is too short to read, so the channels fold into one envelope. */
const MIN_LANE_HEIGHT = 36;

function readCssColor(element: HTMLElement, token: string, fallback: string): string {
    const value = getComputedStyle(element).getPropertyValue(token).trim();
    return value.length > 0 ? value : fallback;
}

/** Choose a tick spacing whose labels stay readable at the current zoom. */
function chooseTickSeconds(secondsPerPixel: number): number {
    const targetSeconds = secondsPerPixel * 80; // ~80px between labels
    const candidates = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    return candidates.find(candidate => candidate >= targetSeconds) ?? candidates[candidates.length - 1];
}

function formatTick(seconds: number, step: number): string {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds - minutes * 60;
    const decimals = step < 1 ? 2 : 0;
    return `${minutes}:${rest.toFixed(decimals).padStart(decimals > 0 ? decimals + 3 : 2, "0")}`;
}

/** What the pointer is doing, decided on pointer-down and fixed for the gesture. */
type Gesture =
    | { kind: "select"; originX: number; originSample: number; moved: boolean }
    /** Resizing an existing selection: `anchor` is the edge that stays put. */
    | { kind: "resize"; anchor: number }
    | { kind: "marker"; index: number; sample: number; moved: boolean };

/**
 * The preview surface: a time ruler, a marker strip, and a min/max waveform with one lane per
 * channel when there is room — plus a selection band, a playhead and a hover readout.
 *
 * Drawn on a canvas because at this zoom range the DOM would be redrawing tens of thousands of
 * elements; everything it shows is derived from props, so the editor above stays the single source
 * of truth for the clip, view window and selection.
 */
export function WaveformView({
    clip,
    view,
    selection,
    cuePoints,
    playhead,
    onSelectionChange,
    onSeek,
    onAddCue,
    onRemoveCue,
    onCueDrag,
    onCueDragEnd,
    onSelectAll,
}: WaveformViewProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gestureRef = useRef<Gesture | null>(null);
    /**
     * Hover lives in a ref, not state: it changes on every mouse move, and a re-render per move
     * would put the whole draw (and React's reconciliation) on the pointer's critical path.
     */
    const hoverRef = useRef<{ sample: number; inStrip: boolean } | null>(null);

    // Latest props for the draw routine, so redrawing never re-subscribes the ResizeObserver:
    // re-observing on every prop change, while the draw itself resizes the canvas, is a feedback
    // loop that repaints (and reallocates the backing store) without end.
    const propsRef = useRef({ clip, view, selection, cuePoints, playhead });
    propsRef.current = { clip, view, selection, cuePoints, playhead };

    /**
     * Last computed peaks, keyed by everything they depend on.
     *
     * Worth caching because `computePeaks` walks every sample in the visible window — at full zoom
     * out that is the entire clip — and the playhead alone repaints this canvas on every animation
     * frame while sounding. Without the cache a four-minute clip re-scans ten million samples sixty
     * times a second just to move a one-pixel line.
     */
    const peaksRef = useRef<{ key: string; clip: AudioClip; lanes: Float32Array[] } | null>(null);

    const lanePeaks = useCallback(
        (clip: AudioClip, view: SampleRange, width: number, laneChannels: (number | undefined)[]): Float32Array[] => {
            const key = `${view.start}|${view.end}|${width}|${laneChannels.join(",")}`;
            const cached = peaksRef.current;
            if (cached && cached.clip === clip && cached.key === key) {
                return cached.lanes;
            }
            const lanes = laneChannels.map(channel => computePeaks(clip, view, width, channel));
            peaksRef.current = { key, clip, lanes };
            return lanes;
        },
        [],
    );

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) {
            return;
        }
        const { clip, view, selection, cuePoints, playhead } = propsRef.current;
        const hover = hoverRef.current;

        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        // Assigning width/height clears and reallocates the canvas, so only do it on a real
        // size change. The target must be rounded first: `canvas.width` is an integer
        // attribute, so at a fractional device pixel ratio (any non-100% UI zoom) an
        // unrounded target never equals what was stored, every draw resizes the canvas, the
        // resize observer redraws — and that loop eats memory until the renderer dies.
        const targetWidth = Math.round(width * dpr);
        const targetHeight = Math.round(height * dpr);
        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
        }
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);

        const styleHost = canvas.parentElement ?? canvas;
        const waveColor = readCssColor(styleHost, "--color-fg-muted", "#8a8a8a");
        const subtleColor = readCssColor(styleHost, "--color-fg-subtle", "#6a6a6a");
        const primaryColor = readCssColor(styleHost, "--color-primary", "#40a8c4");
        const edgeColor = readCssColor(styleHost, "--color-edge", "#3a3a3a");
        const fgColor = readCssColor(styleHost, "--color-fg", "#f0f0f0");
        const sunkenColor = readCssColor(styleHost, "--color-surface-sunken", "#1a1a1a");

        const waveHeight = height - WAVE_TOP;
        const visibleSamples = Math.max(1, view.end - view.start);
        const sampleToX = (sample: number) => ((sample - view.start) / visibleSamples) * width;

        // One lane per channel, folded into a single envelope when they would be too short to
        // read. `undefined` means "every channel at once".
        const channelCount = Math.max(1, clip.channels.length);
        const laneChannels: (number | undefined)[] =
            channelCount > 1 && waveHeight / channelCount >= MIN_LANE_HEIGHT
                ? clip.channels.map((_, index) => index)
                : [undefined];
        const laneHeight = waveHeight / laneChannels.length;

        // Selection band, painted under the waveform so the samples stay legible.
        if (selection && selection.end > selection.start) {
            const from = sampleToX(selection.start);
            const to = sampleToX(selection.end);
            context.fillStyle = primaryColor;
            context.globalAlpha = 0.16;
            context.fillRect(from, WAVE_TOP, Math.max(1, to - from), waveHeight);
            context.globalAlpha = 0.7;
            // Edge handles: the selection is resizable, and nothing else says so.
            context.fillRect(from - 1, WAVE_TOP, 2, waveHeight);
            context.fillRect(to - 1, WAVE_TOP, 2, waveHeight);
            context.globalAlpha = 1;
        }

        // Ruler.
        const secondsPerPixel = visibleSamples / clip.sampleRate / width;
        const tickStep = chooseTickSeconds(secondsPerPixel);
        const firstTick = Math.ceil(view.start / clip.sampleRate / tickStep) * tickStep;
        const lastSecond = view.end / clip.sampleRate;
        context.fillStyle = subtleColor;
        context.font = "9px ui-monospace, monospace";
        context.textBaseline = "top";
        for (let seconds = firstTick; seconds <= lastSecond; seconds += tickStep) {
            const x = sampleToX(seconds * clip.sampleRate);
            context.fillRect(x, RULER_HEIGHT - 4, 1, 3);
            context.fillText(formatTick(seconds, tickStep), x + 3, 2);
        }

        // Marker strip: its own band, so it reads as the place markers live. Tinted with the edge
        // colour rather than filled with a surface token — the workspace surfaces are translucent
        // when a background image is set, so a surface fill over a surface reads as no band at all.
        context.fillStyle = edgeColor;
        context.globalAlpha = 0.3;
        context.fillRect(0, RULER_HEIGHT, width, MARKER_STRIP_HEIGHT);
        context.globalAlpha = 1;
        context.fillRect(0, RULER_HEIGHT, width, 1);
        context.fillRect(0, WAVE_TOP - 1, width, 1);

        // Waveform: one min/max column per device-independent pixel, per lane.
        const lanes = lanePeaks(clip, view, width, laneChannels);
        lanes.forEach((peaks, lane) => {
            const top = WAVE_TOP + lane * laneHeight;
            const midline = top + laneHeight / 2;
            context.fillStyle = waveColor;
            for (let x = 0; x < width; x++) {
                const minimum = peaks[x * 2];
                const maximum = peaks[x * 2 + 1];
                const barTop = midline - (maximum * laneHeight) / 2;
                const barBottom = midline - (minimum * laneHeight) / 2;
                context.fillRect(x, barTop, 1, Math.max(1, barBottom - barTop));
            }
            context.fillStyle = edgeColor;
            context.fillRect(0, midline, width, 1);
            if (lane > 0) {
                context.fillRect(0, top, width, 1);
            }
        });

        // Markers: a tab in the strip, and a faint line down the waveform to read against.
        const hoveredMarker =
            hover?.inStrip && gestureRef.current === null ? nearestCue(cuePoints, clip, hover.sample, visibleSamples / width) : null;
        cuePoints.forEach((cue, index) => {
            const x = sampleToX((cue.timeMs / 1000) * clip.sampleRate);
            if (x < -8 || x > width + 8) {
                return;
            }
            context.fillStyle = primaryColor;
            context.globalAlpha = 0.35;
            context.fillRect(x, WAVE_TOP, 1, waveHeight);
            context.globalAlpha = index === hoveredMarker ? 1 : 0.85;
            // A pennant pointing right from the marker's exact time.
            context.beginPath();
            context.moveTo(x, RULER_HEIGHT + 1);
            context.lineTo(x + 7, RULER_HEIGHT + 1);
            context.lineTo(x + 7, RULER_HEIGHT + 6);
            context.lineTo(x, RULER_HEIGHT + 10);
            context.closePath();
            context.fill();
            context.fillRect(x - 1, RULER_HEIGHT + 1, 1, MARKER_STRIP_HEIGHT - 2);
            context.globalAlpha = 1;
        });

        // Hover guide: a faint line plus the time under the pointer, so a click lands where the
        // eye expects. Suppressed mid-gesture, where the playhead and selection already say it.
        if (hover && !hover.inStrip && gestureRef.current === null) {
            const x = sampleToX(hover.sample);
            if (x >= 0 && x <= width) {
                context.fillStyle = subtleColor;
                context.globalAlpha = 0.5;
                context.fillRect(x, WAVE_TOP, 1, waveHeight);
                context.globalAlpha = 1;
                const label = formatTick(hover.sample / clip.sampleRate, Math.min(tickStep, 0.5));
                const textWidth = context.measureText(label).width;
                // Flip the label to the other side rather than let it run off the edge.
                const labelX = x + 4 + textWidth > width ? x - 4 - textWidth : x + 4;
                // Two coats: the surface token first, then an edge tint, so the readout stays
                // legible over a translucent panel with a background image behind it.
                context.fillStyle = sunkenColor;
                context.fillRect(labelX - 2, WAVE_TOP + 2, textWidth + 4, 11);
                context.fillStyle = edgeColor;
                context.globalAlpha = 0.9;
                context.fillRect(labelX - 2, WAVE_TOP + 2, textWidth + 4, 11);
                context.globalAlpha = 1;
                context.fillStyle = fgColor;
                context.fillText(label, labelX, WAVE_TOP + 3);
            }
        }

        // Playhead last, so it is never hidden by anything else.
        if (playhead !== null) {
            const x = sampleToX(playhead);
            if (x >= 0 && x <= width) {
                context.fillStyle = fgColor;
                context.fillRect(x, RULER_HEIGHT, 1, height - RULER_HEIGHT);
            }
        }
    }, [lanePeaks]);

    // Repaint on prop changes…
    useEffect(() => {
        draw();
    }, [draw, clip, view, selection, cuePoints, playhead]);

    // …and when the element is resized. The observer watches the *container*, not the canvas:
    // drawing resizes the canvas, so observing the canvas would let a repaint trigger the next
    // one. It also only redraws on a real size change, as a second line of defence.
    useEffect(() => {
        const container = canvasRef.current?.parentElement;
        if (!container) {
            return;
        }
        let lastWidth = 0;
        let lastHeight = 0;
        const observer = new ResizeObserver(entries => {
            const rect = entries[0]?.contentRect;
            if (!rect || (Math.round(rect.width) === lastWidth && Math.round(rect.height) === lastHeight)) {
                return;
            }
            lastWidth = Math.round(rect.width);
            lastHeight = Math.round(rect.height);
            draw();
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, [draw]);

    // ---- pointer geometry ---------------------------------------------------

    const localPoint = useCallback(
        (clientX: number, clientY: number): { sample: number; y: number; samplesPerPixel: number } => {
            const canvas = canvasRef.current;
            const rect = canvas?.getBoundingClientRect();
            if (!rect) {
                return { sample: view.start, y: 0, samplesPerPixel: 1 };
            }
            const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            return {
                sample: Math.round(view.start + ratio * (view.end - view.start)),
                y: clientY - rect.top,
                samplesPerPixel: (view.end - view.start) / Math.max(1, rect.width),
            };
        },
        [view],
    );

    /** Which selection edge the pointer is on, with the opposite edge as the resize anchor. */
    const selectionEdgeAt = useCallback(
        (sample: number, samplesPerPixel: number): number | null => {
            if (!selection || selection.end <= selection.start) {
                return null;
            }
            const tolerance = GRAB_TOLERANCE_PX * samplesPerPixel;
            if (Math.abs(selection.start - sample) <= tolerance) {
                return selection.end;
            }
            if (Math.abs(selection.end - sample) <= tolerance) {
                return selection.start;
            }
            return null;
        },
        [selection],
    );

    // ---- pointer handling ---------------------------------------------------

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const { sample, y, samplesPerPixel } = localPoint(event.clientX, event.clientY);
        const inStrip = y >= RULER_HEIGHT && y < WAVE_TOP;

        // Alt-click drops a marker wherever the pointer is, without a trip to the toolbar.
        if (event.altKey) {
            onAddCue(sample);
            return;
        }

        event.currentTarget.setPointerCapture(event.pointerId);

        if (inStrip) {
            const index = nearestCue(cuePoints, clip, sample, samplesPerPixel);
            if (index !== null) {
                gestureRef.current = { kind: "marker", index, sample, moved: false };
                return;
            }
            // Empty strip: clicking it places a marker, which is what the band is for.
            onAddCue(sample);
            return;
        }

        const anchor = selectionEdgeAt(sample, samplesPerPixel);
        if (anchor !== null) {
            gestureRef.current = { kind: "resize", anchor };
            return;
        }
        gestureRef.current = { kind: "select", originX: event.clientX, originSample: sample, moved: false };
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const { sample, y, samplesPerPixel } = localPoint(event.clientX, event.clientY);
        const gesture = gestureRef.current;

        if (!gesture) {
            const inStrip = y >= RULER_HEIGHT && y < WAVE_TOP;
            hoverRef.current = { sample, inStrip };
            const overMarker = inStrip && nearestCue(cuePoints, clip, sample, samplesPerPixel) !== null;
            const overEdge = !inStrip && selectionEdgeAt(sample, samplesPerPixel) !== null;
            event.currentTarget.style.cursor = overMarker || overEdge ? "col-resize" : inStrip ? "copy" : "text";
            draw();
            return;
        }

        if (gesture.kind === "marker") {
            // Below the threshold this is still a click on the marker, not a move — otherwise a
            // one-pixel wobble while clicking silently nudges it and costs an undo step.
            if (!gesture.moved && Math.abs(sample - gesture.sample) / samplesPerPixel < DRAG_THRESHOLD_PX) {
                return;
            }
            gesture.moved = true;
            onCueDrag(gesture.index, sample);
            return;
        }
        if (gesture.kind === "resize") {
            onSelectionChange({ start: Math.min(gesture.anchor, sample), end: Math.max(gesture.anchor, sample) });
            return;
        }
        if (!gesture.moved && Math.abs(event.clientX - gesture.originX) < DRAG_THRESHOLD_PX) {
            return;
        }
        gesture.moved = true;
        onSelectionChange({ start: Math.min(gesture.originSample, sample), end: Math.max(gesture.originSample, sample) });
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const gesture = gestureRef.current;
        gestureRef.current = null;
        if (!gesture) {
            return;
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (gesture.kind === "marker") {
            if (gesture.moved) {
                // One history step for the whole drag, not one per pointer move.
                onCueDragEnd();
            } else {
                onSeek(gesture.sample);
            }
            return;
        }
        if (gesture.kind === "select" && !gesture.moved) {
            // A plain click clears the selection and moves the playhead, like every audio editor.
            onSelectionChange(null);
            onSeek(gesture.originSample);
        }
    };

    const handlePointerLeave = () => {
        hoverRef.current = null;
        draw();
    };

    const handleDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const { sample, y, samplesPerPixel } = localPoint(event.clientX, event.clientY);
        if (y >= RULER_HEIGHT && y < WAVE_TOP) {
            // Double-clicking a marker removes it — the strip's own delete gesture, so removing
            // one never means hunting for it in a list somewhere else.
            const index = nearestCue(cuePoints, clip, sample, samplesPerPixel);
            if (index !== null) {
                onRemoveCue(index);
            }
            return;
        }
        onSelectAll();
    };

    return (
        <canvas
            ref={canvasRef}
            // Absolutely positioned inside the (relative) container on purpose: an in-flow canvas
            // contributes its *attribute* size to layout, so resizing the backing store during a
            // draw resizes the container, the resize observer redraws, and the two chase each
            // other until the renderer runs out of memory. Out of flow, that path cannot exist.
            className="absolute inset-0 block h-full w-full select-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            onDoubleClick={handleDoubleClick}
        />
    );
}

/** Index of the marker within grabbing distance of `sample`, preferring the closest. */
function nearestCue(
    cuePoints: AudioCuePoint[],
    clip: AudioClip,
    sample: number,
    samplesPerPixel: number,
): number | null {
    const tolerance = GRAB_TOLERANCE_PX * samplesPerPixel;
    let best: number | null = null;
    let bestDistance = Infinity;
    cuePoints.forEach((cue, index) => {
        const distance = Math.abs((cue.timeMs / 1000) * clip.sampleRate - sample);
        if (distance <= tolerance && distance < bestDistance) {
            bestDistance = distance;
            best = index;
        }
    });
    return best;
}
