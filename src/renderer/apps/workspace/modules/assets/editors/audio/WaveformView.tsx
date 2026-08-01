import { useCallback, useEffect, useRef } from "react";
import { computePeaks, type AudioClip, type SampleRange } from "./audioClip";
import type { LoopMarker, LoopPoints } from "./loopHistory";

/** Which marker of the loop region a gesture is about. */
export type LoopEnd = LoopMarker;

interface WaveformViewProps {
    clip: AudioClip;
    /** Visible sample window - the zoom/scroll state, owned by the editor. */
    view: SampleRange;
    selection: SampleRange | null;
    /** The authored loop region, in milliseconds; any marker may be unmarked. */
    loop: LoopPoints;
    /** Playhead position in samples, or null when stopped at the start. */
    playhead: number | null;
    onSelectionChange: (range: SampleRange | null) => void;
    onSeek: (sample: number) => void;
    /** Live during a marker drag - the editor applies these without touching undo history. */
    onLoopDrag: (end: LoopEnd, sample: number) => void;
    /** End of a marker drag: the editor commits one history step for the whole gesture. */
    onLoopDragEnd: () => void;
    onClearLoopPoint: (end: LoopEnd) => void;
    onSelectAll: () => void;
}

const RULER_HEIGHT = 16;
/**
 * The marker strip, between the ruler and the waveform.
 *
 * The in and out points are grabbed here and nowhere else. When markers were grabbable along their
 * full height each one was a vertical dead zone across the whole waveform that swallowed selection
 * drags; confining them to their own band is what makes both gestures unambiguous - the same split
 * Premiere draws between its marker bar and its tracks.
 */
const MARKER_STRIP_HEIGHT = 13;
const WAVE_TOP = RULER_HEIGHT + MARKER_STRIP_HEIGHT;
/**
 * Tint of the segment that repeats, and of the intro that plays once before it.
 *
 * Both over the waveform, never under it: a loud master draws near-solid bars across the full lane
 * height, and a band painted underneath disappears behind exactly the clips that most need reading.
 * The repeating segment carries the same weight the selection band uses; the intro is deliberately
 * half of it, so the step at the loop point reads as "this part comes back" without a legend.
 */
const LOOP_BAND_ALPHA = 0.28;
const INTRO_BAND_ALPHA = 0.12;
/** Drags shorter than this are a click, not a drag. */
const DRAG_THRESHOLD_PX = 3;
/** How close the pointer must get to grab a marker or a selection edge. */
const GRAB_TOLERANCE_PX = 6;
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
    | { kind: "loop"; end: LoopEnd; sample: number; moved: boolean };

/**
 * The preview surface: a time ruler, a marker strip carrying the loop's in and out points, and a
 * min/max waveform with one lane per channel when there is room - plus a selection band, a
 * playhead and a hover readout.
 *
 * Drawn on a canvas because at this zoom range the DOM would be redrawing tens of thousands of
 * elements; everything it shows is derived from props, so the editor above stays the single source
 * of truth for the clip, view window, selection and loop.
 */
export function WaveformView({
    clip,
    view,
    selection,
    loop,
    playhead,
    onSelectionChange,
    onSeek,
    onLoopDrag,
    onLoopDragEnd,
    onClearLoopPoint,
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
    const propsRef = useRef({ clip, view, selection, loop, playhead });
    propsRef.current = { clip, view, selection, loop, playhead };

    /**
     * Last computed peaks, keyed by everything they depend on.
     *
     * Worth caching because `computePeaks` walks every sample in the visible window - at full zoom
     * out that is the entire clip - and the playhead alone repaints this canvas on every animation
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
        const { clip, view, selection, loop, playhead } = propsRef.current;
        const hover = hoverRef.current;

        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        // Assigning width/height clears and reallocates the canvas, so only do it on a real
        // size change. The target must be rounded first: `canvas.width` is an integer
        // attribute, so at a fractional device pixel ratio (any non-100% UI zoom) an
        // unrounded target never equals what was stored, every draw resizes the canvas, the
        // resize observer redraws - and that loop eats memory until the renderer dies.
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
        const msToX = (ms: number) => sampleToX((ms / 1000) * clip.sampleRate);

        // One lane per channel, folded into a single envelope when they would be too short to
        // read. `undefined` means "every channel at once".
        const channelCount = Math.max(1, clip.channels.length);
        const laneChannels: (number | undefined)[] =
            channelCount > 1 && waveHeight / channelCount >= MIN_LANE_HEIGHT
                ? clip.channels.map((_, index) => index)
                : [undefined];
        const laneHeight = waveHeight / laneChannels.length;

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

        // Marker strip: its own band, so it reads as the place the loop points live. Tinted with
        // the edge colour rather than filled with a surface token - the workspace surfaces are
        // translucent when a background image is set, so a surface fill over a surface reads as
        // no band at all.
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

        // Intro and loop segments, over the waveform - but only once a loop point exists.
        //
        // Without one there is nothing here the strip's own bar does not already say, and a second
        // band in the waveform body would compete with the selection for the same pixels. With one,
        // the strip cannot carry it: "which half repeats" is a property of the samples, and it has
        // to be readable against them. Drawn before the selection so a selection still wins.
        const bandFrom = loop.inMs ?? (view.start / clip.sampleRate) * 1000;
        const bandTo = loop.outMs ?? (view.end / clip.sampleRate) * 1000;
        const bandsDrawn = loop.loopStartMs !== null;
        if (loop.loopStartMs !== null && loop.loopStartMs > bandFrom) {
            context.fillStyle = primaryColor;
            context.globalAlpha = INTRO_BAND_ALPHA;
            const from = msToX(bandFrom);
            const to = msToX(loop.loopStartMs);
            context.fillRect(from, WAVE_TOP, Math.max(1, to - from), waveHeight);
            context.globalAlpha = 1;
        }
        if (loop.loopStartMs !== null && bandTo > loop.loopStartMs) {
            context.fillStyle = primaryColor;
            context.globalAlpha = LOOP_BAND_ALPHA;
            const from = msToX(loop.loopStartMs);
            const to = msToX(bandTo);
            context.fillRect(from, WAVE_TOP, Math.max(1, to - from), waveHeight);
            context.globalAlpha = 1;
        }

        // Selection band, painted *over* the waveform rather than under it.
        //
        // Underneath is where it started, on the theory that the samples should stay unobscured -
        // but a loud, dense clip draws near-solid bars across the full lane height and swallows
        // the band whole, which is exactly when a selection is hardest to see. A tint on top
        // colours those same bars instead of hiding behind them, and at this alpha the waveform
        // still reads straight through it. Opaque edges mark the handles.
        if (selection && selection.end > selection.start) {
            const from = sampleToX(selection.start);
            const to = sampleToX(selection.end);
            context.fillStyle = primaryColor;
            context.globalAlpha = 0.28;
            context.fillRect(from, WAVE_TOP, Math.max(1, to - from), waveHeight);
            context.globalAlpha = 1;
            context.fillRect(from - 1, WAVE_TOP, 2, waveHeight);
            context.fillRect(to - 1, WAVE_TOP, 2, waveHeight);
        }

        // The loop region as a bar inside the strip, the way Premiere shows its work area. Until a
        // loop point exists this is the *only* place it is drawn, so it never competes with the
        // selection band for the waveform's pixels - one says "what plays", the other says "what is
        // marked".
        if (loop.inMs !== null && loop.outMs !== null) {
            const from = msToX(loop.inMs);
            const to = msToX(loop.outMs);
            // Split at the loop point when there is one, so the strip says which half repeats too -
            // the same weights the bands over the waveform use, one glance apart.
            const split = loop.loopStartMs !== null && loop.loopStartMs > loop.inMs && loop.loopStartMs < loop.outMs
                ? msToX(loop.loopStartMs)
                : null;
            context.fillStyle = primaryColor;
            context.globalAlpha = split === null ? 0.85 : 0.35;
            context.fillRect(from, RULER_HEIGHT + 2, Math.max(1, (split ?? to) - from), MARKER_STRIP_HEIGHT - 4);
            if (split !== null) {
                context.globalAlpha = 0.85;
                context.fillRect(split, RULER_HEIGHT + 2, Math.max(1, to - split), MARKER_STRIP_HEIGHT - 4);
            }
            context.globalAlpha = 1;
        }

        // The markers: a flag facing into the region it opens or closes, a pennant centred on the
        // loop point (it faces neither way - playback arrives at it and returns to it), plus an
        // opaque edge down the waveform so the bands have a handle to read against.
        const hoveredEnd = hover?.inStrip && gestureRef.current === null
            ? loopEndAt(loop, clip, hover.sample, visibleSamples / width)
            : null;
        const drawPoint = (end: LoopEnd, ms: number) => {
            const x = msToX(ms);
            if (x < -10 || x > width + 10) {
                return;
            }
            context.fillStyle = primaryColor;
            // Where a band ends, its edge is a handle and has to be opaque - the same treatment the
            // selection band gets, and for the same reason: a low-alpha tint has no readable border
            // of its own over a dense waveform. With no bands drawn the markers are back to being
            // guides against the samples, and stand down to a hairline so they do not read as edges
            // of a region that is not there.
            context.globalAlpha = bandsDrawn ? 1 : 0.4;
            context.fillRect(x - (bandsDrawn ? 1 : 0), WAVE_TOP, bandsDrawn ? 2 : 1, waveHeight);
            context.globalAlpha = end === hoveredEnd ? 1 : 0.9;
            context.beginPath();
            if (end === "loop") {
                context.moveTo(x - 5, RULER_HEIGHT + 1);
                context.lineTo(x + 5, RULER_HEIGHT + 1);
                context.lineTo(x, RULER_HEIGHT + 8);
            } else {
                const direction = end === "in" ? 1 : -1;
                context.moveTo(x, RULER_HEIGHT + 1);
                context.lineTo(x + 7 * direction, RULER_HEIGHT + 1);
                context.lineTo(x + 7 * direction, RULER_HEIGHT + 6);
                context.lineTo(x, RULER_HEIGHT + 10);
            }
            context.closePath();
            context.fill();
            context.fillRect(x - (end === "in" ? 1 : 0), RULER_HEIGHT + 1, 1, MARKER_STRIP_HEIGHT - 2);
            context.globalAlpha = 1;
        };
        if (loop.inMs !== null) {
            drawPoint("in", loop.inMs);
        }
        // After in and out, so a loop point sharing a pixel with either draws on top of it.
        if (loop.outMs !== null) {
            drawPoint("out", loop.outMs);
        }
        if (loop.loopStartMs !== null) {
            drawPoint("loop", loop.loopStartMs);
        }

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

    // Repaint on prop changes...
    useEffect(() => {
        draw();
    }, [draw, clip, view, selection, loop, playhead]);

    // ...and when the element is resized. The observer watches the *container*, not the canvas:
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

        event.currentTarget.setPointerCapture(event.pointerId);

        if (inStrip) {
            // The strip only ever adjusts points that already exist. Marking is the two toolbar
            // buttons and their shortcuts: a bare click here cannot say which end it meant.
            const end = loopEndAt(loop, clip, sample, samplesPerPixel);
            if (end !== null) {
                gestureRef.current = { kind: "loop", end, sample, moved: false };
            }
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
            const overPoint = inStrip && loopEndAt(loop, clip, sample, samplesPerPixel) !== null;
            const overEdge = !inStrip && selectionEdgeAt(sample, samplesPerPixel) !== null;
            event.currentTarget.style.cursor = overPoint || overEdge ? "col-resize" : inStrip ? "default" : "text";
            draw();
            return;
        }

        if (gesture.kind === "loop") {
            // Below the threshold this is still a click on the marker, not a move - otherwise a
            // one-pixel wobble while clicking silently nudges it and costs an undo step.
            if (!gesture.moved && Math.abs(sample - gesture.sample) / samplesPerPixel < DRAG_THRESHOLD_PX) {
                return;
            }
            gesture.moved = true;
            onLoopDrag(gesture.end, sample);
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
        if (gesture.kind === "loop") {
            if (gesture.moved) {
                // One history step for the whole drag, not one per pointer move.
                onLoopDragEnd();
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
            // Double-clicking a point clears that end - the strip's own delete gesture.
            const end = loopEndAt(loop, clip, sample, samplesPerPixel);
            if (end !== null) {
                onClearLoopPoint(end);
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

/**
 * Whichever marker is within grabbing distance of `sample`, preferring the closer one.
 *
 * Considered in time order, and ties go to the first considered - so a loop point parked exactly on
 * the in point (a legal state, and the same playback as no loop point at all) leaves the in point
 * grabbable. The loop point is still reachable from the keyboard, which is what a coincident pair
 * needs; two markers on one pixel cannot both answer a click.
 */
function loopEndAt(loop: LoopPoints, clip: AudioClip, sample: number, samplesPerPixel: number): LoopEnd | null {
    const tolerance = GRAB_TOLERANCE_PX * samplesPerPixel;
    let best: LoopEnd | null = null;
    let bestDistance = Infinity;
    const consider = (end: LoopEnd, ms: number | null) => {
        if (ms === null) {
            return;
        }
        const distance = Math.abs((ms / 1000) * clip.sampleRate - sample);
        if (distance <= tolerance && distance < bestDistance) {
            bestDistance = distance;
            best = end;
        }
    };
    consider("in", loop.inMs);
    consider("loop", loop.loopStartMs);
    consider("out", loop.outMs);
    return best;
}
