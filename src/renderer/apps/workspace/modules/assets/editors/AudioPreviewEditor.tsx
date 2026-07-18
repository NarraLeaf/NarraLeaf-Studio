import { useCallback, useState, useEffect, useRef } from "react";
import { AudioWaveform, type AudioCuePoint } from "./AudioWaveform";
import { RefreshCw, AlertCircle, Play, Pause, Volume2, VolumeX } from "lucide-react";
import { EditorComponentProps } from "../../types";
import { Asset } from "@/lib/workspace/services/assets/types";
import { AssetType, AssetData } from "@/lib/workspace/services/assets/assetTypes";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { ActionDefinition, useRegistry } from "../../../registry";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { useTranslation } from "@/lib/i18n";

interface AudioPreviewPayload {
    asset: Asset<AssetType.Audio>;
}

function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return "0:00";
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

/**
 * Audio preview editor component
 * Displays audio with playback controls and metadata
 */
export function AudioPreviewEditor({ tabId, payload, active }: EditorComponentProps<AudioPreviewPayload>) {
    const { t, tn } = useTranslation();
    const { context } = useWorkspace();
    const [audioData, setAudioData] = useState<AssetData<AssetType.Audio> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, setVolume] = useState(0.8);
    const [isMuted, setIsMuted] = useState(false);
    const audioUrlRef = useRef<string | null>(null);
    const audioRef = useRef<HTMLAudioElement>(null);

    // Waveform + cue points. Cues live in the asset's persisted extras; local state is the
    // editing copy, written back through patchAssetExtras on every change.
    const [cuePoints, setCuePoints] = useState<AudioCuePoint[]>(
        () => (payload?.asset.extras?.cuePoints as AudioCuePoint[] | undefined) ?? [],
    );
    const persistExtras = useCallback(
        (patch: Record<string, unknown>) => {
            if (!context || !payload?.asset) {
                return;
            }
            const assetsService = context.services.get<AssetsService>(Services.Assets);
            void assetsService.patchAssetExtras(payload.asset, patch);
        },
        [context, payload?.asset],
    );
    const handleWaveformSeek = useCallback((timeSeconds: number) => {
        const element = audioRef.current;
        if (element) {
            element.currentTime = timeSeconds;
            setCurrentTime(timeSeconds);
        }
    }, []);
    const handleAddCue = useCallback(
        (timeMs: number) => {
            setCuePoints(previous => {
                const next = [...previous, { timeMs }].sort((a, b) => a.timeMs - b.timeMs);
                persistExtras({ cuePoints: next });
                return next;
            });
        },
        [persistExtras],
    );
    const handleRemoveCue = useCallback(
        (index: number) => {
            setCuePoints(previous => {
                const next = previous.filter((_, i) => i !== index);
                persistExtras({ cuePoints: next.length > 0 ? next : undefined });
                return next;
            });
        },
        [persistExtras],
    );

    const { registerActionGroup, unregisterActionGroup } = useRegistry();

    useEffect(() => {
        const groupId = `${tabId}-audio-preview-actions`;
        const focusWhen = (ctx: any) => ctx?.area === FocusArea.Editor && ctx?.targetId === tabId;
        const namespace = "narraleaf-studio:audio-preview";

        const playAction: ActionDefinition = {
            id: `${namespace}:${groupId}-play`,
            icon: <Play className="w-4 h-4" />,
            label: t("assets.audio.play"),
            shortcut: "Space",
            onClick: () => {
                const el = audioRef.current;
                if (el) {
                    if (el.paused) el.play();
                    else el.pause();
                }
            },
            order: 1,
            when: focusWhen,
        };

        registerActionGroup({
            id: groupId,
            label: t("assets.audio.playback"),
            actions: [playAction],
        });

        return () => unregisterActionGroup(groupId);
    }, [registerActionGroup, unregisterActionGroup, tabId, t]);

    const asset = payload?.asset;

    useEffect(() => {
        if (!context || !asset) return;

        const loadAudio = async () => {
            setLoading(true);
            setError(null);
            setIsPlaying(false);
            setCurrentTime(0);
            setDuration(0);
            const existingEl = audioRef.current;
            if (existingEl) {
                existingEl.pause();
            }

            try {
                const assetsService = context.services.get<AssetsService>(Services.Assets);
                const result = await assetsService.fetch(asset);

                if (!result.success) {
                    setError(result.error || t("assets.audio.loadError"));
                    return;
                }

                setAudioData(result.data);

                const blob = new Blob([new Uint8Array(result.data.data)]);
                if (audioUrlRef.current) {
                    URL.revokeObjectURL(audioUrlRef.current);
                }
                audioUrlRef.current = URL.createObjectURL(blob);
                setIsPlaying(false);
            } catch (err) {
                console.error("Failed to load audio:", err);
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                setLoading(false);
            }
        };

        loadAudio();

        return () => {
            if (audioUrlRef.current) {
                URL.revokeObjectURL(audioUrlRef.current);
                audioUrlRef.current = null;
            }
        };
    }, [context, asset]);

    const handlePlayPause = () => {
        const el = audioRef.current;
        if (!el) return;
        if (el.paused) {
            el.play();
            setIsPlaying(true);
        } else {
            el.pause();
            setIsPlaying(false);
        }
    };

    const handleEnded = () => setIsPlaying(false);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleLoadedMetadata = () => {
        const el = audioRef.current;
        if (!el) return;
        setDuration(el.duration || 0);
        setCurrentTime(el.currentTime || 0);
        setIsPlaying(!el.paused);
    };
    const handleTimeUpdate = () => {
        const el = audioRef.current;
        if (!el) return;
        setCurrentTime(el.currentTime);
    };
    const handleSeek = (nextTime: number) => {
        const el = audioRef.current;
        if (!el) return;
        el.currentTime = nextTime;
        setCurrentTime(nextTime);
    };
    const toggleMute = () => setIsMuted((prev) => !prev);

    useEffect(() => {
        const el = audioRef.current;
        if (!el) return;
        el.volume = volume;
        el.muted = isMuted;
    }, [volume, isMuted]);

    useEffect(() => {
        return () => {
            const el = audioRef.current;
            if (el) {
                el.pause();
            }
        };
    }, []);

    // Kept-alive tabs stay mounted while hidden; pause playback when this tab isn't visible, since
    // display:none does not stop an <audio> element.
    useEffect(() => {
        if (!active) {
            audioRef.current?.pause();
            setIsPlaying(false);
        }
    }, [active]);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center bg-surface">
                <div className="flex items-center gap-2 text-fg-muted">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>{t("assets.audio.loading")}</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-full flex items-center justify-center bg-surface p-4">
                <div className="flex items-start gap-2 text-danger bg-danger/10 rounded-md p-4 max-w-md">
                    <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="font-medium">{t("assets.audio.loadError")}</p>
                        <p className="text-sm mt-1 text-danger/80">{error}</p>
                    </div>
                </div>
            </div>
        );
    }

    if (!audioData || !audioUrlRef.current) {
        return null;
    }

    const { metadata } = audioData;

    return (
        <div className="h-full flex flex-col bg-surface">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-edge bg-surface-raised">
                <div className="flex items-center gap-4">
                    <span className="text-sm text-fg-muted">
                        {formatDuration(metadata.duration)}
                    </span>
                    <span className="text-sm text-fg-muted">
                        {metadata.sampleRate} Hz
                    </span>
                    <span className="text-sm text-fg-muted">
                        {tn("assets.audio.channelCount", metadata.channels)}
                    </span>
                    <span className="text-sm text-fg-muted">
                        {metadata.format.toUpperCase()}
                    </span>
                    <span className="text-sm text-fg-muted">
                        {(metadata.size / 1024).toFixed(1)} KB
                    </span>
                </div>

                <button
                    onClick={handlePlayPause}
                    className="p-2 rounded hover:bg-fill text-fg-muted hover:text-fg transition-colors"
                    title={isPlaying ? t("assets.audio.pause") : t("assets.audio.play")}
                >
                    {isPlaying ? (
                        <Pause className="w-5 h-5" />
                    ) : (
                        <Play className="w-5 h-5" />
                    )}
                </button>
            </div>

            {/* Audio player */}
            <div className="flex-1 flex flex-col items-center justify-center p-6">
                <audio
                    ref={audioRef}
                    src={audioUrlRef.current}
                    className="w-full max-w-lg"
                    onEnded={handleEnded}
                    onPlay={handlePlay}
                    onPause={handlePause}
                    onLoadedMetadata={handleLoadedMetadata}
                    onTimeUpdate={handleTimeUpdate}
                />
                <div className="mb-4 w-full max-w-2xl">
                    <AudioWaveform
                        bytes={audioData.data as Uint8Array}
                        cachedPeaks={payload?.asset.extras?.waveformPeaks as number[] | undefined}
                        cuePoints={cuePoints}
                        currentTime={currentTime}
                        duration={duration || metadata.duration}
                        onSeek={handleWaveformSeek}
                        onAddCue={handleAddCue}
                        onRemoveCue={handleRemoveCue}
                        onPeaksComputed={peaks => persistExtras({ waveformPeaks: peaks })}
                    />
                </div>
                <div className="w-full max-w-2xl bg-surface-raised border border-edge rounded-md px-4 py-3">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handlePlayPause}
                            className="p-2 rounded hover:bg-fill text-fg-muted hover:text-fg transition-colors"
                            title={isPlaying ? t("assets.audio.pause") : t("assets.audio.play")}
                        >
                            {isPlaying ? (
                                <Pause className="w-4 h-4" />
                            ) : (
                                <Play className="w-4 h-4" />
                            )}
                        </button>
                        <span className="text-xs text-fg-muted w-12 text-right">
                            {formatDuration(currentTime)}
                        </span>
                        <input
                            type="range"
                            min={0}
                            max={duration || 0}
                            step={0.01}
                            value={Math.min(currentTime, duration || 0)}
                            onChange={(event) => handleSeek(Number(event.target.value))}
                            className="flex-1 h-1 rounded bg-fill accent-fg/70"
                            aria-label={t("assets.audio.seek")}
                        />
                        <span className="text-xs text-fg-muted w-12">
                            {formatDuration(duration)}
                        </span>
                        <button
                            onClick={toggleMute}
                            className="p-2 rounded hover:bg-fill text-fg-muted hover:text-fg transition-colors"
                            title={isMuted ? t("assets.audio.unmute") : t("assets.audio.mute")}
                        >
                            {isMuted || volume === 0 ? (
                                <VolumeX className="w-4 h-4" />
                            ) : (
                                <Volume2 className="w-4 h-4" />
                            )}
                        </button>
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={isMuted ? 0 : volume}
                            onChange={(event) => {
                                const nextVolume = Number(event.target.value);
                                setVolume(nextVolume);
                                if (isMuted && nextVolume > 0) {
                                    setIsMuted(false);
                                }
                            }}
                            className="w-24 h-1 rounded bg-fill accent-fg/70"
                            aria-label={t("assets.audio.volume")}
                        />
                    </div>
                </div>
                <p className="mt-3 text-sm text-fg-subtle">{asset?.name}</p>
            </div>
        </div>
    );
}
