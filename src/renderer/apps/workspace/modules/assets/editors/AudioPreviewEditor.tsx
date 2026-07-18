import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AlertCircle,
    Crop,
    Flag,
    Maximize,
    Pause,
    Play,
    RefreshCw,
    Repeat,
    Square,
    Volume1,
    Volume2,
    VolumeX,
    ZoomIn,
    ZoomOut,
} from "lucide-react";
import { EditorComponentProps } from "../../types";
import { Asset } from "@/lib/workspace/services/assets/types";
import { AssetType, AssetData } from "@/lib/workspace/services/assets/assetTypes";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { useTranslation } from "@/lib/i18n";
import { WaveformView, type AudioCuePoint } from "./audio/WaveformView";
import { useClipPlayback } from "./audio/useClipPlayback";
import { clipDuration, clipLength, fromAudioBuffer, type AudioClip, type SampleRange } from "./audio/audioClip";
import { clampView, ensureVisible, fitAll, scrollByFraction, zoomAt, zoomToRange } from "./audio/viewWindow";

interface AudioPreviewPayload {
    asset: Asset<AssetType.Audio>;
}

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return "0:00.00";
    }
    const minutes = Math.floor(seconds / 60);
    const rest = seconds - minutes * 60;
    return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

/**
 * Audio preview: a read-only waveform over the asset — playback, zoom/scroll, range auditioning,
 * and cue points.
 *
 * Deliberately not an editor. Studio's job is to tell you what a clip sounds like and where its
 * interesting moments are, not to be a DAW; trimming and gain belong in the tool the audio came
 * from. What survives is the part that informs authoring: drag a range and loop it to find a BGM's
 * in/out points, then drop cue points to record them. Cue points are the only thing written back
 * (to the asset record — they are authored data, not a cache); the audio file is never modified.
 */
export function AudioPreviewEditor({ payload, active }: EditorComponentProps<AudioPreviewPayload>) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const asset = payload?.asset;

    const [metadata, setMetadata] = useState<AssetData<AssetType.Audio>["metadata"] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // One decoded copy of the samples, replaced only when the asset itself changes.
    const [clip, setClip] = useState<AudioClip | null>(null);

    const [view, setView] = useState<SampleRange>({ start: 0, end: 1 });
    const [selection, setSelection] = useState<SampleRange | null>(null);
    const [cuePoints, setCuePoints] = useState<AudioCuePoint[]>(() => payload?.asset.extras?.cuePoints ?? []);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);

    const playback = useClipPlayback(clip);
    const { playing, position, setPosition, loop, setLoop, play, stop, setGain } = playback;
    useEffect(() => setGain(muted ? 0 : volume), [muted, volume, setGain]);
    const totalSamples = clip ? clipLength(clip) : 0;

    // ---- loading -----------------------------------------------------------

    useEffect(() => {
        if (!context || !asset) {
            return;
        }
        let mounted = true;
        setLoading(true);
        setError(null);
        const assetsService = context.services.get<AssetsService>(Services.Assets);
        void assetsService
            .fetch(asset)
            .then(async result => {
                if (!mounted) {
                    return;
                }
                if (!result.success) {
                    setError(result.error || t("assets.audio.loadError"));
                    setLoading(false);
                    return;
                }
                setMetadata(result.data.metadata);
                const bytes = new Uint8Array(result.data.data as ArrayLike<number>);
                const audioContext = new AudioContext();
                try {
                    const decoded = await audioContext.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);
                    if (!mounted) {
                        return;
                    }
                    const loaded = fromAudioBuffer(decoded);
                    setClip(loaded);
                    setView(fitAll(clipLength(loaded)));
                } catch (decodeError) {
                    if (mounted) {
                        setError(String(decodeError));
                    }
                } finally {
                    void audioContext.close();
                    if (mounted) {
                        setLoading(false);
                    }
                }
            })
            .catch(fetchError => {
                if (mounted) {
                    setError(String(fetchError));
                    setLoading(false);
                }
            });
        return () => {
            mounted = false;
        };
    }, [context, asset?.id, asset?.hash]);

    // A newly decoded clip has its own length; keep the view and selection inside it.
    useEffect(() => {
        if (!clip) {
            return;
        }
        setView(current => clampView(current, clipLength(clip)));
        setSelection(current => {
            if (!current) {
                return null;
            }
            const length = clipLength(clip);
            return current.start >= length ? null : { start: current.start, end: Math.min(current.end, length) };
        });
    }, [clip]);

    const hasSelection = Boolean(selection && selection.end > selection.start);

    // ---- cue points --------------------------------------------------------

    // Cue points ride with the asset record, so they survive closing the tab and are visible to
    // anything else reading the asset.
    const persistCuePoints = useCallback(
        (next: AudioCuePoint[]) => {
            if (context && asset) {
                void context.services.get<AssetsService>(Services.Assets).patchAssetExtras(asset, {
                    cuePoints: next.length > 0 ? next : undefined,
                });
            }
        },
        [context, asset],
    );

    const addCue = useCallback(
        (sample: number) => {
            if (!clip) {
                return;
            }
            const timeMs = Math.round((sample / clip.sampleRate) * 1000);
            setCuePoints(previous => {
                const next = [...previous, { timeMs }].sort((a, b) => a.timeMs - b.timeMs);
                persistCuePoints(next);
                return next;
            });
        },
        [clip, persistCuePoints],
    );

    const removeCue = useCallback(
        (index: number) => {
            setCuePoints(previous => {
                const next = previous.filter((_, i) => i !== index);
                persistCuePoints(next);
                return next;
            });
        },
        [persistCuePoints],
    );

    // ---- transport ---------------------------------------------------------

    const playhead = position;
    const togglePlay = useCallback(() => {
        if (playing) {
            stop();
        } else {
            play(hasSelection && selection ? Math.max(selection.start, position) : position, selection);
        }
    }, [playing, stop, play, hasSelection, selection, position]);

    // Follow the playhead once it leaves the visible window.
    useEffect(() => {
        if (!playing || !clip) {
            return;
        }
        setView(current => ensureVisible(current, clipLength(clip), Math.round(playhead)));
    }, [playing, playhead, clip]);

    // Kept-alive tabs stay mounted while hidden; hidden tabs must not keep sounding.
    useEffect(() => {
        if (!active) {
            stop();
        }
    }, [active, stop]);

    const wheelRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const element = wheelRef.current;
        if (!element || !clip) {
            return;
        }
        // Non-passive: zooming has to be able to cancel the page's own scroll.
        const onWheel = (event: WheelEvent) => {
            if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
                const rect = element.getBoundingClientRect();
                setView(current => {
                    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                    const anchor = current.start + ratio * (current.end - current.start);
                    return zoomAt(current, clipLength(clip), event.deltaY < 0 ? 1.2 : 1 / 1.2, anchor);
                });
            } else if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
                event.preventDefault();
                setView(current => scrollByFraction(current, clipLength(clip), event.deltaX / 400));
            }
        };
        element.addEventListener("wheel", onWheel, { passive: false });
        return () => element.removeEventListener("wheel", onWheel);
    }, [clip]);

    // ---- render ------------------------------------------------------------

    const selectionSeconds = useMemo(
        () => (clip && hasSelection && selection ? (selection.end - selection.start) / clip.sampleRate : 0),
        [clip, hasSelection, selection],
    );

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center bg-surface">
                <div className="flex items-center gap-2 text-fg-muted">
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    <span>{t("assets.audio.loading")}</span>
                </div>
            </div>
        );
    }

    if (error || !clip) {
        return (
            <div className="flex h-full items-center justify-center bg-surface p-4">
                <div className="flex max-w-md items-start gap-2 rounded-md bg-danger/10 p-4 text-danger">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                        <p className="font-medium">{t("assets.audio.loadError")}</p>
                        {error && <p className="mt-1 text-sm text-danger/80">{error}</p>}
                    </div>
                </div>
            </div>
        );
    }

    const duration = clipDuration(clip);
    const toolButton = "rounded p-1.5 text-fg-muted transition-colors hover:bg-fill hover:text-fg disabled:opacity-40";
    const textButton =
        "rounded border border-edge px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-fill hover:text-fg disabled:opacity-40";

    return (
        <div className="flex h-full flex-col bg-surface">
            {/* Transport + view controls */}
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-edge bg-surface-raised px-3 py-1.5">
                <button type="button" onClick={togglePlay} className={toolButton} title={t("assets.audio.play")}>
                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <button
                    type="button"
                    onClick={() => {
                        stop();
                        setPosition(hasSelection && selection ? selection.start : 0);
                    }}
                    className={toolButton}
                    title={t("assets.audio.editor.stop")}
                >
                    <Square className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    onClick={() => setLoop(value => !value)}
                    className={`${toolButton} ${loop ? "bg-primary/20 text-fg" : ""}`}
                    title={t("assets.audio.editor.loop")}
                >
                    <Repeat className="h-4 w-4" />
                </button>

                <span className="mx-2 h-4 w-px bg-edge" />

                <span className="tabular-nums text-xs text-fg-muted">
                    {formatTime(position / clip.sampleRate)} / {formatTime(duration)}
                </span>

                <span className="mx-2 h-4 w-px bg-edge" />

                <button
                    type="button"
                    onClick={() => setView(current => zoomAt(current, totalSamples, 1.4, (current.start + current.end) / 2))}
                    className={toolButton}
                    title={t("assets.audio.editor.zoomIn")}
                >
                    <ZoomIn className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    onClick={() => setView(current => zoomAt(current, totalSamples, 1 / 1.4, (current.start + current.end) / 2))}
                    className={toolButton}
                    title={t("assets.audio.editor.zoomOut")}
                >
                    <ZoomOut className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    onClick={() => setView(fitAll(totalSamples))}
                    className={toolButton}
                    title={t("assets.audio.editor.zoomFit")}
                >
                    <Maximize className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    disabled={!hasSelection}
                    onClick={() => selection && setView(zoomToRange(selection, totalSamples))}
                    className={toolButton}
                    title={t("assets.audio.editor.zoomSelection")}
                >
                    <Crop className="h-4 w-4" />
                </button>

                <span className="mx-2 h-4 w-px bg-edge" />

                <button
                    type="button"
                    onClick={() => setMuted(value => !value)}
                    className={toolButton}
                    title={muted ? t("assets.audio.unmute") : t("assets.audio.mute")}
                >
                    {muted || volume === 0 ? (
                        <VolumeX className="h-4 w-4" />
                    ) : volume < 0.5 ? (
                        <Volume1 className="h-4 w-4" />
                    ) : (
                        <Volume2 className="h-4 w-4" />
                    )}
                </button>
                <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={muted ? 0 : volume}
                    onChange={event => {
                        setVolume(Number(event.target.value));
                        setMuted(false);
                    }}
                    className="h-1 w-20 rounded bg-fill accent-fg/70"
                    aria-label={t("assets.audio.volume")}
                />
            </div>

            {/* Waveform */}
            <div ref={wheelRef} className="min-h-0 flex-1 px-3 py-2">
                <div className="relative h-full w-full overflow-hidden rounded border border-edge bg-surface-sunken">
                    <WaveformView
                        clip={clip}
                        view={view}
                        selection={selection}
                        cuePoints={cuePoints}
                        playhead={playhead}
                        onSelectionChange={setSelection}
                        onSeek={sample => {
                            stop();
                            setPosition(sample);
                        }}
                    />
                </div>
            </div>

            {/* Cue points: drag a range and loop it to find in/out points, then mark them. */}
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-edge bg-surface-raised px-3 py-1.5">
                <span className="mr-1 text-xs text-fg-subtle">
                    {hasSelection
                        ? t("assets.audio.editor.selectionLabel", { duration: formatTime(selectionSeconds) })
                        : t("assets.audio.editor.wholeClipLabel")}
                </span>
                <button type="button" className={textButton} onClick={() => addCue(position)}>
                    <Flag className="mr-1 inline h-3 w-3" />
                    {t("assets.audio.editor.addCue")}
                </button>
                {hasSelection && selection && (
                    <button
                        type="button"
                        className={textButton}
                        onClick={() => {
                            addCue(selection.start);
                            addCue(selection.end);
                        }}
                    >
                        <Flag className="mr-1 inline h-3 w-3" />
                        {t("assets.audio.editor.markSelectionEnds")}
                    </button>
                )}
            </div>

            {/* Cue list */}
            {cuePoints.length > 0 && (
                <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-edge px-3 py-1.5">
                    {cuePoints.map((cue, index) => (
                        <button
                            key={`${cue.timeMs}-${index}`}
                            type="button"
                            onClick={() => setPosition(Math.round((cue.timeMs / 1000) * clip.sampleRate))}
                            onDoubleClick={() => removeCue(index)}
                            title={t("assets.audio.cueChipHint")}
                            className="rounded bg-fill-subtle px-2 py-0.5 text-xs tabular-nums text-fg-muted transition-colors hover:bg-fill hover:text-fg"
                        >
                            {formatTime(cue.timeMs / 1000)}
                        </button>
                    ))}
                </div>
            )}

            {metadata && (
                <div className="flex shrink-0 items-center gap-3 border-t border-edge px-3 py-1 text-2xs text-fg-subtle">
                    <span>{clip.sampleRate} Hz</span>
                    <span>{t("assets.audio.editor.channels", { count: clip.channels.length })}</span>
                    <span>{(metadata.size / 1024).toFixed(1)} KB</span>
                    <span className="truncate">{asset?.name}</span>
                </div>
            )}
        </div>
    );
}
