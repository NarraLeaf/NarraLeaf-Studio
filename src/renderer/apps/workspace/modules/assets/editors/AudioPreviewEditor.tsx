import { useState, useEffect, useRef } from "react";
import { RefreshCw, AlertCircle, Play, Pause, Volume2, VolumeX } from "lucide-react";
import { EditorComponentProps } from "../../types";
import { Asset } from "@/lib/workspace/services/assets/types";
import { AssetType, AssetData } from "@/lib/workspace/services/assets/assetTypes";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { ActionDefinition, useRegistry } from "../../../registry";
import { FocusArea } from "@/lib/workspace/services/ui/types";

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
export function AudioPreviewEditor({ tabId, payload }: EditorComponentProps<AudioPreviewPayload>) {
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

    const { registerActionGroup, unregisterActionGroup } = useRegistry();

    useEffect(() => {
        const groupId = `${tabId}-audio-preview-actions`;
        const focusWhen = (ctx: any) => ctx?.area === FocusArea.Editor && ctx?.targetId === tabId;
        const namespace = "narraleaf-studio:audio-preview";

        const playAction: ActionDefinition = {
            id: `${namespace}:${groupId}-play`,
            icon: <Play className="w-4 h-4" />,
            label: "Play",
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
            label: "Playback",
            actions: [playAction],
        });

        return () => unregisterActionGroup(groupId);
    }, [registerActionGroup, unregisterActionGroup, tabId]);

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
                    setError(result.error || "Failed to load audio");
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

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center bg-[#0f1115]">
                <div className="flex items-center gap-2 text-gray-400">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>Loading audio...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-full flex items-center justify-center bg-[#0f1115] p-4">
                <div className="flex items-start gap-2 text-red-400 bg-red-500/10 rounded-md p-4 max-w-md">
                    <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="font-medium">Failed to load audio</p>
                        <p className="text-sm mt-1 text-red-300">{error}</p>
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
        <div className="h-full flex flex-col bg-[#0f1115]">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#1e1f22]">
                <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-300">
                        {formatDuration(metadata.duration)}
                    </span>
                    <span className="text-sm text-gray-400">
                        {metadata.sampleRate} Hz
                    </span>
                    <span className="text-sm text-gray-400">
                        {metadata.channels} channel{metadata.channels > 1 ? "s" : ""}
                    </span>
                    <span className="text-sm text-gray-400">
                        {metadata.format.toUpperCase()}
                    </span>
                    <span className="text-sm text-gray-400">
                        {(metadata.size / 1024).toFixed(1)} KB
                    </span>
                </div>

                <button
                    onClick={handlePlayPause}
                    className="p-2 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                    title={isPlaying ? "Pause" : "Play"}
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
                <div className="w-full max-w-2xl bg-[#15171c] border border-white/10 rounded-md px-4 py-3">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handlePlayPause}
                            className="p-2 rounded hover:bg-white/10 text-gray-300 hover:text-white transition-colors"
                            title={isPlaying ? "Pause" : "Play"}
                        >
                            {isPlaying ? (
                                <Pause className="w-4 h-4" />
                            ) : (
                                <Play className="w-4 h-4" />
                            )}
                        </button>
                        <span className="text-xs text-gray-400 w-12 text-right">
                            {formatDuration(currentTime)}
                        </span>
                        <input
                            type="range"
                            min={0}
                            max={duration || 0}
                            step={0.01}
                            value={Math.min(currentTime, duration || 0)}
                            onChange={(event) => handleSeek(Number(event.target.value))}
                            className="flex-1 h-1 rounded bg-white/10 accent-white/70"
                            aria-label="Seek"
                        />
                        <span className="text-xs text-gray-400 w-12">
                            {formatDuration(duration)}
                        </span>
                        <button
                            onClick={toggleMute}
                            className="p-2 rounded hover:bg-white/10 text-gray-300 hover:text-white transition-colors"
                            title={isMuted ? "Unmute" : "Mute"}
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
                            className="w-24 h-1 rounded bg-white/10 accent-white/70"
                            aria-label="Volume"
                        />
                    </div>
                </div>
                <p className="mt-3 text-sm text-gray-500">{asset?.name}</p>
            </div>
        </div>
    );
}
