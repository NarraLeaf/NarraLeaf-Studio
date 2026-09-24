import { useCallback, useEffect, useRef } from "react";
import { computePeaks, type AudioClip, type SampleRange } from "../audio/audioClip";
import { readCanvasPalette } from "../audio/WaveformView";
import { tileKeyStep, type FilmstripDecoder } from "./filmstrip";

interface VideoTimelineViewProps {
    durationMs: number;
    /** Visible window in milliseconds - the zoom/scroll state, owned by the editor. */
    view: SampleRange;
    selection: SampleRange | null;
    /** Playhead in milliseconds. */
    playhead: number;
    /** Width over height of the picture, for the filmstrip's tile shape. */
    frameAspect: number;
    filmstrip: FilmstripDecoder | null;
    /** Bumped by the editor whenever a filmstrip frame lands, so the strip repaints. */
    filmstripRevision: number;
    /** The clip's sound, decoded; null when it has none or it would not decode. */
    audio: AudioClip | null;
    onSelectionChange: (range: SampleRange | null) => void;
    /** A click in the lanes: move the playhead there. */
    onSeek: (ms: number) => void;
    /** A drag along the ruler: the playhead follows the pointer and the picture follows it. */
    onScrub: (ms: number) => void;
    onSelectAll: () => void;
}

/**
 * The time ruler. Dragging here scrubs, and nowhere else does: the lanes below take drags as range
 * selections, the split Premiere draws between its ruler and its tracks.
 */
export const RULER_HEIGHT = 16;
export const FILMSTRIP_HEIGHT = 52;
export const AUDIO_LANE_HEIGHT = 36;
/** Drags shorter than this are a click, not a drag. */
const DRAG_THRESHOLD_PX = 3;
/** How close the pointer must get to grab a selection edge. */
const GRAB_TOLERANCE_PX = 6;

/** The timeline's height for a clip with or without a sound lane. */
export function timelineHeight(hasAudio: boolean): number {
    return RULER_HEIGHT + FILMSTRIP_HEIGHT + (hasAudio ? AUDIO_LANE_HEIGHT : 0);
}

/** A tick spacing whose labels stay readable at the current zoom. */
function chooseTickSeconds(secondsPerPixel: number): number {
    const targetSeconds = secondsPerPixel * 80;
    const candidates = [0.04, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    return candidates.find(candidate => candidate >= targetSeconds) ?? candidates[candidates.length - 1];
}

function formatTick(seconds: number, step: number): string {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds - minutes * 60;
    const decimals = step < 1 ? 2 : 0;
    return `${minutes}:${rest.toFixed(decimals).padStart(decimals > 0 ? decimals + 3 : 2, "0")}`;
}

type Gesture =
    | { kind: "scrub" }
    | { kind: "select"; originX: number; originMs: number; moved: boolean }
    /** Resizing an existing selection: `anchor` is the edge that stays put. */
    | { kind: "resize"; anchor: number };

/**
 * The video preview's timeline: a ruler, a filmstrip of the clip's frames, and - when the clip has
 * sound - its waveform, with a selection band and a playhead across all of them.
 *
 * Drawn on a canvas for the same reason the audio preview's waveform is: it repaints on every frame
 * while the clip plays, and everything it shows is derived from props, so the editor above stays the
 * single source of truth for the view, the selection and the playhead.
 */
export function VideoTimelineView({
    durationMs,
    view,
    selection,
    playhead,
    frameAspect,
    filmstrip,
    filmstripRevision,
    audio,
    onSelectionChange,
    onSeek,
    onScrub,
    onSelectAll,
}: VideoTimelineViewProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gestureRef = useRef<Gesture | null>(null);
    /** In a ref, not state: it changes on every mouse move, and a render per move is wasted work. */
    const hoverRef = useRef<{ ms: number; inRuler: boolean } | null>(null);
    const propsRef = useRef({ durationMs, view, selection, playhead, frameAspect, filmstrip, audio });
    propsRef.current = { durationMs, view, selection, playhead, frameAspect, filmstrip, audio };
    /** Keys last asked of the decoder, so a repaint that wants the same frames does not re-queue them. */
    const requestedRef = useRef("");
    /** Peaks for the visible window, reused while only the playhead moves. */
    const peaksRef = useRef<{ key: string; audio: AudioClip; peaks: Float32Array } | null>(null);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) {
            return;
        }
        const { durationMs, view, selection, playhead, frameAspect, filmstrip, audio } = propsRef.current;
        const hover = hoverRef.current;

        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        // Rounded before comparing: `canvas.width` is an integer attribute, and an unrounded target
        // at a fractional pixel ratio never matches, so every draw would reallocate the canvas.
        const targetWidth = Math.round(width * dpr);
        const targetHeight = Math.round(height * dpr);
        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
        }
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);

        const {
            wave: waveColor,
            subtle: subtleColor,
            primary: primaryColor,
            edge: edgeColor,
            fg: fgColor,
            sunken: sunkenColor,
        } = readCanvasPalette(canvas.parentElement ?? canvas);

        const visibleMs = Math.max(1, view.end - view.start);
        const msPerPixel = visibleMs / width;
        const toX = (ms: number) => (ms - view.start) / msPerPixel;
        const filmTop = RULER_HEIGHT;
        const filmHeight = audio ? height - RULER_HEIGHT - AUDIO_LANE_HEIGHT : height - RULER_HEIGHT;
        const audioTop = filmTop + filmHeight;

        // Ruler, tinted with the edge colour rather than filled with a surface token: the workspace
        // surfaces are translucent over a background image, and a surface over a surface draws nothing.
        context.fillStyle = edgeColor;
        context.globalAlpha = 0.3;
        context.fillRect(0, 0, width, RULER_HEIGHT);
        context.globalAlpha = 1;
        context.fillRect(0, RULER_HEIGHT - 1, width, 1);
        const tickStep = chooseTickSeconds(msPerPixel / 1000);
        const firstTick = Math.ceil(view.start / 1000 / tickStep) * tickStep;
        context.fillStyle = subtleColor;
        context.font = "9px ui-monospace, monospace";
        context.textBaseline = "top";
        for (let seconds = firstTick; seconds <= view.end / 1000; seconds += tickStep) {
            const x = toX(seconds * 1000);
            context.fillRect(x, RULER_HEIGHT - 5, 1, 4);
            context.fillText(formatTick(seconds, tickStep), x + 3, 2);
        }

        // Filmstrip. Tiles sit on a fixed time grid - tile k starts at k tile-lengths - so they slide
        // with the view instead of re-deciding which frame to show as it scrolls, and each shows the
        // frame at its left edge, snapped to a grid the decoder's cache is keyed on.
        const tileWidth = Math.max(8, filmHeight * (frameAspect > 0 ? frameAspect : 16 / 9));
        const tileMs = tileWidth * msPerPixel;
        const keyStep = tileKeyStep(tileMs);
        const lastKey = Math.max(0, durationMs - 1);
        const wanted: number[] = [];
        context.save();
        context.beginPath();
        context.rect(0, filmTop, width, filmHeight);
        context.clip();
        for (let tile = Math.floor(view.start / tileMs); tile * tileMs < view.end; tile++) {
            const tileStart = tile * tileMs;
            const x = toX(tileStart);
            const key = Math.min(lastKey, Math.max(0, Math.round(tileStart / keyStep) * keyStep));
            wanted.push(key);
            const frame = filmstrip?.frameAt(key) ?? filmstrip?.nearestFrame(key);
            if (frame) {
                context.drawImage(frame, x, filmTop, tileWidth, filmHeight);
            } else {
                context.fillStyle = edgeColor;
                context.globalAlpha = 0.3;
                context.fillRect(x, filmTop, tileWidth, filmHeight);
                context.globalAlpha = 1;
            }
            // A hairline between tiles, so neighbouring frames of a static shot still read as tiles.
            context.fillStyle = sunkenColor;
            context.fillRect(x, filmTop, 1, filmHeight);
        }
        context.restore();
        const wantedKey = wanted.join(",");
        if (filmstrip && wantedKey !== requestedRef.current) {
            requestedRef.current = wantedKey;
            filmstrip.request(wanted);
        }

        // The sound lane: one min/max column per pixel, channels folded into one envelope.
        if (audio) {
            context.fillStyle = edgeColor;
            context.fillRect(0, audioTop, width, 1);
            const sampleRange = {
                start: Math.round((view.start / 1000) * audio.sampleRate),
                end: Math.round((view.end / 1000) * audio.sampleRate),
            };
            const peaksKey = `${sampleRange.start}|${sampleRange.end}|${width}`;
            let cached = peaksRef.current;
            if (!cached || cached.audio !== audio || cached.key !== peaksKey) {
                cached = { key: peaksKey, audio, peaks: computePeaks(audio, sampleRange, width) };
                peaksRef.current = cached;
            }
            const laneHeight = AUDIO_LANE_HEIGHT - 1;
            const midline = audioTop + 1 + laneHeight / 2;
            context.fillStyle = waveColor;
            for (let x = 0; x < width; x++) {
                const minimum = Math.max(-1, cached.peaks[x * 2]);
                const maximum = Math.min(1, cached.peaks[x * 2 + 1]);
                const barTop = midline - (maximum * laneHeight) / 2;
                const barBottom = midline - (minimum * laneHeight) / 2;
                context.fillRect(x, barTop, 1, Math.max(1, barBottom - barTop));
            }
            context.fillStyle = edgeColor;
            context.fillRect(0, midline, width, 1);
        }

        // Selection, over the lanes rather than under them: a filmstrip is opaque, and a band painted
        // beneath it would never be seen at all. Opaque edges mark the handles.
        if (selection && selection.end > selection.start) {
            const from = toX(selection.start);
            const to = toX(selection.end);
            context.fillStyle = primaryColor;
            context.globalAlpha = 0.28;
            context.fillRect(from, RULER_HEIGHT, Math.max(1, to - from), height - RULER_HEIGHT);
            context.globalAlpha = 1;
            context.fillRect(from - 1, RULER_HEIGHT, 2, height - RULER_HEIGHT);
            context.fillRect(to - 1, RULER_HEIGHT, 2, height - RULER_HEIGHT);
        }

        // Hover guide with the time under the pointer, suppressed mid-gesture where the playhead and
        // the selection already say it.
        if (hover && gestureRef.current === null) {
            const x = toX(hover.ms);
            if (x >= 0 && x <= width) {
                context.fillStyle = subtleColor;
                context.globalAlpha = 0.6;
                context.fillRect(x, RULER_HEIGHT, 1, height - RULER_HEIGHT);
                context.globalAlpha = 1;
                const label = formatTick(hover.ms / 1000, Math.min(tickStep, 0.5));
                const textWidth = context.measureText(label).width;
                const labelX = x + 4 + textWidth > width ? x - 4 - textWidth : x + 4;
                // Two coats, so the readout stays legible over a frame of any colour.
                context.fillStyle = sunkenColor;
                context.fillRect(labelX - 2, RULER_HEIGHT + 2, textWidth + 4, 11);
                context.fillStyle = edgeColor;
                context.globalAlpha = 0.9;
                context.fillRect(labelX - 2, RULER_HEIGHT + 2, textWidth + 4, 11);
                context.globalAlpha = 1;
                context.fillStyle = fgColor;
                context.fillText(label, labelX, RULER_HEIGHT + 3);
            }
        }

        // Playhead last, so nothing hides it: a line through the lanes and a head in the ruler, which
        // is where it is grabbed.
        const playheadX = toX(playhead);
        if (playheadX >= -6 && playheadX <= width + 6) {
            context.fillStyle = fgColor;
            context.fillRect(Math.round(playheadX), RULER_HEIGHT - 6, 1, height - RULER_HEIGHT + 6);
            context.beginPath();
            context.moveTo(playheadX - 5, RULER_HEIGHT - 9);
            context.lineTo(playheadX + 5, RULER_HEIGHT - 9);
            context.lineTo(playheadX, RULER_HEIGHT - 3);
            context.closePath();
            context.fill();
        }
    }, []);

    useEffect(() => {
        draw();
    }, [draw, durationMs, view, selection, playhead, frameAspect, filmstrip, filmstripRevision, audio]);

    // Repaint on a real size change of the container - not the canvas, which the draw itself resizes.
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

    // ---- pointer ------------------------------------------------------------

    const localPoint = useCallback(
        (clientX: number, clientY: number) => {
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) {
                return { ms: view.start, y: 0, msPerPixel: 1 };
            }
            const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            return {
                ms: Math.round(view.start + ratio * (view.end - view.start)),
                y: clientY - rect.top,
                msPerPixel: (view.end - view.start) / Math.max(1, rect.width),
            };
        },
        [view],
    );

    const selectionEdgeAt = useCallback(
        (ms: number, msPerPixel: number): number | null => {
            if (!selection || selection.end <= selection.start) {
                return null;
            }
            const tolerance = GRAB_TOLERANCE_PX * msPerPixel;
            if (Math.abs(selection.start - ms) <= tolerance) {
                return selection.end;
            }
            if (Math.abs(selection.end - ms) <= tolerance) {
                return selection.start;
            }
            return null;
        },
        [selection],
    );

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const { ms, y, msPerPixel } = localPoint(event.clientX, event.clientY);
        event.currentTarget.setPointerCapture(event.pointerId);
        if (y < RULER_HEIGHT) {
            gestureRef.current = { kind: "scrub" };
            onScrub(ms);
            return;
        }
        const anchor = selectionEdgeAt(ms, msPerPixel);
        gestureRef.current = anchor !== null
            ? { kind: "resize", anchor }
            : { kind: "select", originX: event.clientX, originMs: ms, moved: false };
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const { ms, y, msPerPixel } = localPoint(event.clientX, event.clientY);
        const gesture = gestureRef.current;
        if (!gesture) {
            const inRuler = y < RULER_HEIGHT;
            hoverRef.current = { ms, inRuler };
            const overEdge = !inRuler && selectionEdgeAt(ms, msPerPixel) !== null;
            event.currentTarget.style.cursor = overEdge ? "col-resize" : inRuler ? "default" : "text";
            draw();
            return;
        }
        if (gesture.kind === "scrub") {
            onScrub(ms);
            return;
        }
        if (gesture.kind === "resize") {
            onSelectionChange({ start: Math.min(gesture.anchor, ms), end: Math.max(gesture.anchor, ms) });
            return;
        }
        if (!gesture.moved && Math.abs(event.clientX - gesture.originX) < DRAG_THRESHOLD_PX) {
            return;
        }
        gesture.moved = true;
        onSelectionChange({ start: Math.min(gesture.originMs, ms), end: Math.max(gesture.originMs, ms) });
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const gesture = gestureRef.current;
        gestureRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (gesture?.kind === "select" && !gesture.moved) {
            // A plain click clears the selection and moves the playhead, as in the audio preview.
            onSelectionChange(null);
            onSeek(gesture.originMs);
        }
    };

    const handlePointerLeave = () => {
        hoverRef.current = null;
        draw();
    };

    const handleDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
        if (localPoint(event.clientX, event.clientY).y >= RULER_HEIGHT) {
            onSelectAll();
        }
    };

    return (
        <canvas
            ref={canvasRef}
            // Out of flow on purpose: an in-flow canvas lends its attribute size to layout, so resizing
            // its backing store would resize the container and set the observer and the draw chasing
            // each other.
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
