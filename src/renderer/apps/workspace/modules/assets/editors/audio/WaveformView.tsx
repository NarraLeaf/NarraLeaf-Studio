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
    onScrub?: (sample: number) => void;
}

const RULER_HEIGHT = 18;
/** Drags shorter than this are a click (seek), not a selection. */
const DRAG_THRESHOLD_PX = 3;

/**
 * Resolve a design-system color token for the canvas, which cannot use CSS.
 *
 * The channel tokens (`--nl-fg-muted`, `--nl-primary`, …) hold space-separated RGB channels, not
 * a color, so they are wrapped here. `--nl-edge` and friends are already whole colors and are
 * read with `whole: true`.
 */
function readCssColor(element: HTMLElement, token: string, fallback: string, whole = false): string {
    const value = getComputedStyle(element).getPropertyValue(token).trim();
    if (value.length === 0) {
        return fallback;
    }
    return whole ? value : `rgb(${value})`;
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

/**
 * The editing surface: a time ruler over a min/max waveform, with a selection band, cue markers
 * and a playhead. Drawn on a canvas because at this zoom range the DOM would be redrawing tens of
 * thousands of elements; everything it shows is derived from props, so the editor above stays the
 * single source of truth for the clip, view window and selection.
 */
export function WaveformView({
    clip,
    view,
    selection,
    cuePoints,
    playhead,
    onSelectionChange,
    onSeek,
    onScrub,
}: WaveformViewProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const dragRef = useRef<{ originX: number; originSample: number; moved: boolean } | null>(null);

    const sampleAtClientX = useCallback(
        (clientX: number): number => {
            const canvas = canvasRef.current;
            if (!canvas) {
                return view.start;
            }
            const rect = canvas.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            return Math.round(view.start + ratio * (view.end - view.start));
        },
        [view],
    );

    // Latest props for the draw routine, so redrawing never re-subscribes the ResizeObserver:
    // re-observing on every prop change, while the draw itself resizes the canvas, is a feedback
    // loop that repaints (and reallocates the backing store) without end.
    const propsRef = useRef({ clip, view, selection, cuePoints, playhead });
    propsRef.current = { clip, view, selection, cuePoints, playhead };

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) {
            return;
        }
        const { clip, view, selection, cuePoints, playhead } = propsRef.current;
        {
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
            const waveColor = readCssColor(styleHost, "--nl-fg-muted", "#8a8a8a");
            const subtleColor = readCssColor(styleHost, "--nl-fg-subtle", "#6a6a6a");
            const primaryColor = readCssColor(styleHost, "--nl-primary", "#40a8c4");
            const edgeColor = readCssColor(styleHost, "--nl-edge", "#3a3a3a", true);

            const waveTop = RULER_HEIGHT;
            const waveHeight = height - RULER_HEIGHT;
            const midline = waveTop + waveHeight / 2;
            const visibleSamples = Math.max(1, view.end - view.start);
            const sampleToX = (sample: number) => ((sample - view.start) / visibleSamples) * width;

            // Selection band, painted under the waveform so the samples stay legible.
            if (selection && selection.end > selection.start) {
                const from = sampleToX(selection.start);
                const to = sampleToX(selection.end);
                context.fillStyle = primaryColor;
                context.globalAlpha = 0.18;
                context.fillRect(from, waveTop, Math.max(1, to - from), waveHeight);
                context.globalAlpha = 1;
            }

            // Ruler.
            context.fillStyle = edgeColor;
            context.fillRect(0, RULER_HEIGHT - 1, width, 1);
            const secondsPerPixel = visibleSamples / clip.sampleRate / width;
            const tickStep = chooseTickSeconds(secondsPerPixel);
            const firstTick = Math.ceil(view.start / clip.sampleRate / tickStep) * tickStep;
            const lastSecond = view.end / clip.sampleRate;
            context.fillStyle = subtleColor;
            context.font = "9px ui-monospace, monospace";
            context.textBaseline = "top";
            for (let seconds = firstTick; seconds <= lastSecond; seconds += tickStep) {
                const x = sampleToX(seconds * clip.sampleRate);
                context.fillRect(x, RULER_HEIGHT - 5, 1, 4);
                context.fillText(formatTick(seconds, tickStep), x + 3, 3);
            }

            // Waveform: one min/max column per device-independent pixel.
            const peaks = computePeaks(clip, view, width);
            context.fillStyle = waveColor;
            for (let x = 0; x < width; x++) {
                const minimum = peaks[x * 2];
                const maximum = peaks[x * 2 + 1];
                const top = midline - (maximum * waveHeight) / 2;
                const bottom = midline - (minimum * waveHeight) / 2;
                context.fillRect(x, top, 1, Math.max(1, bottom - top));
            }

            // Midline.
            context.fillStyle = edgeColor;
            context.fillRect(0, midline, width, 1);

            // Cue points.
            for (const cue of cuePoints) {
                const x = sampleToX((cue.timeMs / 1000) * clip.sampleRate);
                if (x < 0 || x > width) {
                    continue;
                }
                context.fillStyle = primaryColor;
                context.fillRect(x, waveTop, 1, waveHeight);
                context.beginPath();
                context.moveTo(x, waveTop);
                context.lineTo(x + 6, waveTop + 4);
                context.lineTo(x, waveTop + 8);
                context.closePath();
                context.fill();
            }

            // Playhead last, so it is never hidden by anything else.
            if (playhead !== null) {
                const x = sampleToX(playhead);
                if (x >= 0 && x <= width) {
                    context.fillStyle = readCssColor(styleHost, "--color-fg", "#f0f0f0");
                    context.fillRect(x, 0, 1, height);
                }
            }
        }
    }, []);

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

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { originX: event.clientX, originSample: sampleAtClientX(event.clientX), moved: false };
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const drag = dragRef.current;
        if (!drag) {
            return;
        }
        if (!drag.moved && Math.abs(event.clientX - drag.originX) < DRAG_THRESHOLD_PX) {
            return;
        }
        drag.moved = true;
        const current = sampleAtClientX(event.clientX);
        onSelectionChange({ start: Math.min(drag.originSample, current), end: Math.max(drag.originSample, current) });
        onScrub?.(current);
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (!drag) {
            return;
        }
        event.currentTarget.releasePointerCapture(event.pointerId);
        if (!drag.moved) {
            // A plain click clears the selection and moves the playhead, like every audio editor.
            onSelectionChange(null);
            onSeek(drag.originSample);
        }
    };

    return (
        <canvas
            ref={canvasRef}
            // Absolutely positioned inside the (relative) container on purpose: an in-flow canvas
            // contributes its *attribute* size to layout, so resizing the backing store during a
            // draw resizes the container, the resize observer redraws, and the two chase each
            // other until the renderer runs out of memory. Out of flow, that path cannot exist.
            className="absolute inset-0 block h-full w-full cursor-text select-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
        />
    );
}
