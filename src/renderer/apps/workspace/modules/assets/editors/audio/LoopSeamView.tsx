import { useCallback, useEffect, useRef } from "react";
import { clipLength, type AudioClip } from "./audioClip";
import type { LoopMarker } from "./loopHistory";
import { seamDragMarker, type LoopSeam } from "./seam";
import { readCssColor } from "./WaveformView";

interface LoopSeamViewProps {
    clip: AudioClip;
    seam: LoopSeam;
    /** Samples shown on each side of the seam - the zoom, owned by the editor. */
    halfWindow: number;
    onHalfWindowChange: (samples: number) => void;
    /** Playhead position in samples; drawn on whichever side it falls in. */
    playhead: number | null;
    /** Frozen project: the halves can be looked at but not dragged. */
    readOnly: boolean;
    /** Live during a drag - the editor applies these without touching undo history. */
    onDrag: (marker: LoopMarker, sample: number) => void;
    /** End of a drag: the editor commits one history step for the whole gesture. */
    onDragEnd: () => void;
}

const RULER_HEIGHT = 16;
/** Below this a lane is too short to read, so the channels fold into one envelope. */
const MIN_LANE_HEIGHT = 36;
/** Drags shorter than this are a click, not a drag. */
const DRAG_THRESHOLD_PX = 3;
/** Wheel zoom step, matching the waveform above. */
const ZOOM_STEP = 1.25;
/** The narrowest and widest the view can get, per side. Markers are stored to the millisecond. */
export const SEAM_MIN_HALF_SECONDS = 0.005;
export const SEAM_MAX_HALF_SECONDS = 5;
export const SEAM_DEFAULT_HALF_SECONDS = 0.5;

/** Tick spacing in milliseconds that keeps relative labels readable at this scale. */
function chooseTickMs(msPerPixel: number): number {
    const target = msPerPixel * 70;
    const candidates = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    return candidates.find(candidate => candidate >= target) ?? candidates[candidates.length - 1];
}

function formatOffset(ms: number): string {
    const sign = ms > 0 ? "+" : "-";
    const magnitude = Math.abs(ms);
    return magnitude >= 1000 ? `${sign}${magnitude / 1000} s` : `${sign}${magnitude} ms`;
}

/**
 * The two sides of a loop seam, butted together: the end of the loop on the left, the point it
 * returns to on the right, joined at one line down the middle.
 *
 * Laid side by side, the two are the waveform the game actually plays across the turnaround, so a
 * step in level, a beat landing early or a click from a discontinuous sample reads straight off the
 * picture. Each half is dragged sideways to slide its marker under the seam line - the content
 * moves with the pointer, the way a clip slips in an editor - and the wheel with the zoom modifier
 * narrows or widens both halves together, down to the individual samples.
 */
export function LoopSeamView({
    clip,
    seam,
    halfWindow,
    onHalfWindowChange,
    playhead,
    readOnly,
    onDrag,
    onDragEnd,
}: LoopSeamViewProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gestureRef = useRef<{
        marker: LoopMarker;
        side: "end" | "start";
        originX: number;
        originSample: number;
        samplesPerPixel: number;
        moved: boolean;
    } | null>(null);
    /** Which half the pointer is over. A ref, so hovering does not re-render. */
    const hoverRef = useRef<"end" | "start" | null>(null);

    const propsRef = useRef({ clip, seam, halfWindow, playhead, readOnly });
    propsRef.current = { clip, seam, halfWindow, playhead, readOnly };

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) {
            return;
        }
        const { clip, seam, halfWindow, playhead, readOnly } = propsRef.current;
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(2, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        // Rounded before comparing, for the reason the waveform above gives: an unrounded target at a
        // fractional device pixel ratio never matches and reallocates the canvas on every draw.
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

        const mid = Math.floor(width / 2);
        const total = clipLength(clip);
        const waveTop = RULER_HEIGHT;
        const waveHeight = height - waveTop;
        const channelCount = Math.max(1, clip.channels.length);
        const laneChannels: (number | undefined)[] =
            channelCount > 1 && waveHeight / channelCount >= MIN_LANE_HEIGHT
                ? clip.channels.map((_, index) => index)
                : [undefined];
        const laneHeight = waveHeight / laneChannels.length;

        // The two halves: where each starts in the clip, and the pixels it occupies.
        const halves = [
            { side: "end" as const, first: seam.end - halfWindow, x0: 0, x1: mid },
            { side: "start" as const, first: seam.start, x0: mid, x1: width },
        ];

        if (!readOnly && hoverRef.current && gestureRef.current === null) {
            // The half a drag would move. Edge tint rather than a surface fill: surfaces are
            // translucent over a workspace background image and would draw nothing. Faint, because
            // it sits under the samples and a quiet passage has little ink to show through it.
            const half = halves.find(candidate => candidate.side === hoverRef.current);
            if (half) {
                context.fillStyle = edgeColor;
                context.globalAlpha = 0.12;
                context.fillRect(half.x0, waveTop, half.x1 - half.x0, waveHeight);
                context.globalAlpha = 1;
            }
        }

        for (const half of halves) {
            const pixels = half.x1 - half.x0;
            if (pixels <= 0) {
                continue;
            }
            const samplesPerPixel = halfWindow / pixels;
            laneChannels.forEach((channel, lane) => {
                const sources = channel === undefined ? clip.channels : [clip.channels[channel]];
                const midline = waveTop + lane * laneHeight + laneHeight / 2;
                context.fillStyle = waveColor;
                context.strokeStyle = waveColor;
                if (samplesPerPixel < 1) {
                    // Zoomed past one sample per pixel: min/max columns would draw a row of dots, so
                    // join the samples instead. Folded lanes draw each channel's line in turn.
                    for (const samples of sources) {
                        context.beginPath();
                        let started = false;
                        const lastIndex = Math.ceil(half.first + halfWindow);
                        for (let index = Math.floor(half.first); index <= lastIndex; index++) {
                            if (index < 0 || index >= total) {
                                continue;
                            }
                            const x = half.x0 + (index - half.first) / samplesPerPixel;
                            if (x < half.x0 || x > half.x1) {
                                continue;
                            }
                            const y = midline - (samples[index] * laneHeight) / 2;
                            if (started) {
                                context.lineTo(x, y);
                            } else {
                                context.moveTo(x, y);
                                started = true;
                            }
                        }
                        context.lineWidth = 1;
                        context.stroke();
                    }
                } else {
                    for (let column = 0; column < pixels; column++) {
                        const from = Math.max(0, Math.floor(half.first + column * samplesPerPixel));
                        const to = Math.min(total, Math.floor(half.first + (column + 1) * samplesPerPixel));
                        if (to <= from) {
                            continue;
                        }
                        let minimum = 0;
                        let maximum = 0;
                        for (const samples of sources) {
                            for (let index = from; index < to; index++) {
                                const value = samples[index];
                                if (value < minimum) minimum = value;
                                if (value > maximum) maximum = value;
                            }
                        }
                        const barTop = midline - (maximum * laneHeight) / 2;
                        const barBottom = midline - (minimum * laneHeight) / 2;
                        context.fillRect(half.x0 + column, barTop, 1, Math.max(1, barBottom - barTop));
                    }
                }
                context.fillStyle = edgeColor;
                context.fillRect(half.x0, midline, pixels, 1);
                if (lane > 0) {
                    context.fillRect(half.x0, waveTop + lane * laneHeight, pixels, 1);
                }
            });
        }

        // Ruler: offsets from the seam, both ways.
        const msPerPixel = (halfWindow / clip.sampleRate) * 1000 / Math.max(1, mid);
        const tickMs = chooseTickMs(msPerPixel);
        context.fillStyle = edgeColor;
        context.fillRect(0, RULER_HEIGHT - 1, width, 1);
        context.font = "9px ui-monospace, monospace";
        context.textBaseline = "top";
        const halfMs = (halfWindow / clip.sampleRate) * 1000;
        for (let offset = tickMs; offset <= halfMs + 1e-6; offset += tickMs) {
            const left = mid - (offset / halfMs) * mid;
            const right = mid + (offset / halfMs) * (width - mid);
            context.fillStyle = subtleColor;
            context.fillRect(left, RULER_HEIGHT - 4, 1, 3);
            context.fillRect(right, RULER_HEIGHT - 4, 1, 3);
            const leftLabel = formatOffset(-offset);
            const labelWidth = context.measureText(leftLabel).width;
            if (left - 3 - labelWidth >= 0) {
                context.fillText(leftLabel, left - 3 - labelWidth, 2);
            }
            const rightLabel = formatOffset(offset);
            if (right + 3 + context.measureText(rightLabel).width <= width) {
                context.fillText(rightLabel, right + 3, 2);
            }
        }

        // The seam itself, opaque and full height: every other mark here is read against it.
        context.fillStyle = primaryColor;
        context.fillRect(mid - 1, 0, 2, height);

        // Playhead last. During an audition it crosses the left half, jumps the seam, and carries on
        // across the right - the same turnaround the speakers make.
        if (playhead !== null) {
            for (const half of halves) {
                if (playhead >= half.first && playhead < half.first + halfWindow) {
                    const x = half.x0 + ((playhead - half.first) / halfWindow) * (half.x1 - half.x0);
                    context.fillStyle = fgColor;
                    context.fillRect(x, RULER_HEIGHT, 1, waveHeight);
                    break;
                }
            }
        }
    }, []);

    useEffect(() => {
        draw();
    }, [draw, clip, seam, halfWindow, playhead, readOnly]);

    // Observe the container, not the canvas - the same guard against a draw-resize loop the
    // waveform above documents.
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

    // Zoom with the same modifier the waveform uses. A bare wheel is left alone so the panel this
    // sits in still scrolls.
    const zoomRef = useRef({ halfWindow, onHalfWindowChange, sampleRate: clip.sampleRate });
    zoomRef.current = { halfWindow, onHalfWindowChange, sampleRate: clip.sampleRate };
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const onWheel = (event: WheelEvent) => {
            if (!event.ctrlKey && !event.metaKey) {
                return;
            }
            event.preventDefault();
            const { halfWindow, onHalfWindowChange, sampleRate } = zoomRef.current;
            const next = event.deltaY < 0 ? halfWindow / ZOOM_STEP : halfWindow * ZOOM_STEP;
            onHalfWindowChange(clampHalfWindow(next, sampleRate));
        };
        canvas.addEventListener("wheel", onWheel, { passive: false });
        return () => canvas.removeEventListener("wheel", onWheel);
    }, []);

    const sideAt = (clientX: number): "end" | "start" => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) {
            return "end";
        }
        return clientX - rect.left < Math.floor(rect.width) / 2 ? "end" : "start";
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (readOnly || event.button !== 0) {
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const side = sideAt(event.clientX);
        const mid = Math.floor(rect.width) / 2;
        event.currentTarget.setPointerCapture(event.pointerId);
        // The marker is settled here, once. A drag on a side the file itself places turns that side
        // into a marker on the first move, and the gesture must keep moving that one.
        gestureRef.current = {
            marker: seamDragMarker(seam, side),
            side,
            originX: event.clientX,
            originSample: side === "end" ? seam.end : seam.start,
            samplesPerPixel: halfWindow / Math.max(1, side === "end" ? mid : rect.width - mid),
            moved: false,
        };
        draw();
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const gesture = gestureRef.current;
        if (!gesture) {
            const side = sideAt(event.clientX);
            if (hoverRef.current !== side) {
                hoverRef.current = side;
                draw();
            }
            event.currentTarget.style.cursor = readOnly ? "default" : "ew-resize";
            return;
        }
        const dx = event.clientX - gesture.originX;
        if (!gesture.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) {
            return;
        }
        gesture.moved = true;
        // Dragging the content right brings earlier samples under the seam line, so the marker
        // moves the opposite way to the pointer.
        const total = clipLength(clip);
        const raw = gesture.originSample - dx * gesture.samplesPerPixel;
        const sample = gesture.side === "end"
            ? Math.max(1, Math.min(total, raw))
            : Math.max(0, Math.min(total - 1, raw));
        onDrag(gesture.marker, Math.round(sample));
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
        if (gesture.moved) {
            onDragEnd();
        }
        draw();
    };

    const handlePointerLeave = () => {
        hoverRef.current = null;
        draw();
    };

    return (
        <canvas
            ref={canvasRef}
            // Out of flow for the same reason as the waveform's canvas: an in-flow canvas feeds its
            // backing-store size back into the container's layout.
            className="absolute inset-0 block h-full w-full select-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerLeave}
        />
    );
}

/** Keep a zoom inside the range the view can usefully draw. */
export function clampHalfWindow(samples: number, sampleRate: number): number {
    const minimum = Math.round(SEAM_MIN_HALF_SECONDS * sampleRate);
    const maximum = Math.round(SEAM_MAX_HALF_SECONDS * sampleRate);
    return Math.round(Math.max(minimum, Math.min(maximum, samples)));
}
