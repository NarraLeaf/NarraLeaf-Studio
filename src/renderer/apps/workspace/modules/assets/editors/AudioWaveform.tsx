import { useCallback, useEffect, useRef, useState } from "react";
import { Flag } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

export interface AudioCuePoint {
    timeMs: number;
    label?: string;
}

const PEAK_BUCKETS = 800;

/** Downsample decoded PCM into `buckets` max-abs peaks (0..1), rounded for compact persistence. */
export function computeWaveformPeaks(buffer: AudioBuffer, buckets: number = PEAK_BUCKETS): number[] {
    const channel = buffer.getChannelData(0);
    const bucketSize = Math.max(1, Math.floor(channel.length / buckets));
    const peaks: number[] = [];
    for (let index = 0; index < buckets; index++) {
        const start = index * bucketSize;
        if (start >= channel.length) {
            break;
        }
        let peak = 0;
        const end = Math.min(channel.length, start + bucketSize);
        for (let sample = start; sample < end; sample++) {
            const value = Math.abs(channel[sample]);
            if (value > peak) {
                peak = value;
            }
        }
        peaks.push(Math.round(peak * 100) / 100);
    }
    return peaks;
}

interface AudioWaveformProps {
    /** Raw audio bytes; decoded only when no cached peaks are supplied. */
    bytes: Uint8Array | null;
    /** Cached peaks from the asset record — skips decoding entirely. */
    cachedPeaks?: number[];
    cuePoints: AudioCuePoint[];
    currentTime: number;
    duration: number;
    onSeek: (timeSeconds: number) => void;
    onAddCue: (timeMs: number) => void;
    onRemoveCue: (index: number) => void;
    /** Freshly computed peaks, for the caller to persist. */
    onPeaksComputed?: (peaks: number[]) => void;
}

/**
 * Canvas waveform with click-to-seek and cue-point markers. Peaks come from the asset's cached
 * extras when available; otherwise the audio is decoded once via Web Audio and the result handed
 * up for caching. Alt/⌥-click adds a cue at that position; clicking a cue flag removes it.
 */
export function AudioWaveform({
    bytes,
    cachedPeaks,
    cuePoints,
    currentTime,
    duration,
    onSeek,
    onAddCue,
    onRemoveCue,
    onPeaksComputed,
}: AudioWaveformProps) {
    const { t } = useTranslation();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [peaks, setPeaks] = useState<number[] | null>(cachedPeaks ?? null);
    const [decodeError, setDecodeError] = useState(false);

    // Decode once when there is no cache.
    useEffect(() => {
        if (peaks || !bytes) {
            return;
        }
        let cancelled = false;
        const audioContext = new AudioContext();
        const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        audioContext
            .decodeAudioData(arrayBuffer)
            .then(decoded => {
                if (cancelled) {
                    return;
                }
                const computed = computeWaveformPeaks(decoded);
                setPeaks(computed);
                onPeaksComputed?.(computed);
            })
            .catch(() => {
                if (!cancelled) {
                    setDecodeError(true);
                }
            })
            .finally(() => {
                void audioContext.close();
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bytes, peaks]);

    // Draw: bars, played-portion tint, playhead, cue markers.
    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container || !peaks) {
            return;
        }
        const width = container.clientWidth;
        const height = 96;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return;
        }
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, width, height);

        const styles = getComputedStyle(container);
        const barColor = styles.getPropertyValue("color") || "#888";
        const playedRatio = duration > 0 ? Math.min(1, currentTime / duration) : 0;
        const playedX = playedRatio * width;
        const mid = height / 2;
        const barWidth = width / peaks.length;

        for (let index = 0; index < peaks.length; index++) {
            const x = index * barWidth;
            const barHeight = Math.max(1, peaks[index] * (height - 8));
            ctx.fillStyle = barColor;
            ctx.globalAlpha = x <= playedX ? 0.9 : 0.35;
            ctx.fillRect(x, mid - barHeight / 2, Math.max(1, barWidth - 1), barHeight);
        }
        ctx.globalAlpha = 1;

        // Playhead
        ctx.fillStyle = barColor;
        ctx.fillRect(playedX - 0.5, 0, 1, height);

        // Cue markers
        for (const cue of cuePoints) {
            const x = duration > 0 ? (cue.timeMs / 1000 / duration) * width : 0;
            ctx.fillStyle = barColor;
            ctx.globalAlpha = 0.8;
            ctx.fillRect(x - 0.5, 0, 1, height);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x + 6, 5);
            ctx.lineTo(x, 10);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }, [peaks, currentTime, duration, cuePoints]);

    const timeAtEvent = useCallback(
        (event: React.MouseEvent<HTMLElement>): number => {
            const container = containerRef.current;
            if (!container || duration <= 0) {
                return 0;
            }
            const rect = container.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            return ratio * duration;
        },
        [duration],
    );

    if (decodeError) {
        return null; // The plain controls still work; the waveform just doesn't render.
    }

    return (
        <div className="w-full">
            <div
                ref={containerRef}
                className="relative w-full cursor-default rounded-md border border-edge bg-surface-sunken text-primary"
                title={t("assets.audio.waveformHint")}
                onClick={event => {
                    const time = timeAtEvent(event);
                    if (event.altKey) {
                        onAddCue(Math.round(time * 1000));
                    } else {
                        onSeek(time);
                    }
                }}
            >
                {!peaks ? (
                    <div className="flex h-24 items-center justify-center text-xs text-fg-subtle">
                        {t("assets.audio.analyzing")}
                    </div>
                ) : (
                    <canvas ref={canvasRef} className="block h-24 w-full" />
                )}
            </div>
            {cuePoints.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {cuePoints.map((cue, index) => (
                        <button
                            key={`${cue.timeMs}-${index}`}
                            type="button"
                            onClick={() => onSeek(cue.timeMs / 1000)}
                            onDoubleClick={() => onRemoveCue(index)}
                            title={t("assets.audio.cueChipHint")}
                            className="flex items-center gap-1 rounded border border-edge bg-fill-subtle px-1.5 py-0.5 text-2xs tabular-nums text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                        >
                            <Flag className="h-2.5 w-2.5" />
                            <span>{(cue.timeMs / 1000).toFixed(2)}s</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
