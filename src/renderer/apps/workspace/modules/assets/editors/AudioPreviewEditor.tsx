import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
    AlertCircle,
    ArrowLeftRight,
    Crop,
    Flag,
    Maximize,
    Pause,
    Play,
    Redo2,
    RefreshCw,
    Repeat,
    Scissors,
    Square,
    Undo2,
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
import { UIService } from "@/lib/workspace/services/core/UIService";
import { useTranslation } from "@/lib/i18n";
import { useEditorHistoryProvider } from "../../../components/layout/editorHistoryRegistry";
import { WaveformView, type AudioCuePoint } from "./audio/WaveformView";
import { useClipPlayback } from "./audio/useClipPlayback";
import { clipHistoryReducer, initialClipHistory } from "./audio/clipHistory";
import {
    applyFade,
    applyGain,
    clipDuration,
    clipLength,
    cropTo,
    deleteRange,
    encodeWav,
    fromAudioBuffer,
    normalizeRange,
    resolveRange,
    reverseRange,
    silenceRange,
    type AudioClip,
    type SampleRange,
} from "./audio/audioClip";
import { clampView, ensureVisible, fitAll, scrollByFraction, zoomAt, zoomToRange } from "./audio/viewWindow";

interface AudioPreviewPayload {
    asset: Asset<AssetType.Audio>;
}

/**
 * Longest clip whose editing operations stay enabled (see `editable`). 30 s of 44.1 kHz stereo is
 * ~10 MB per in-memory copy, which the undo stack can hold several of without trouble.
 */
const EDITABLE_DURATION_LIMIT_SECONDS = 30;

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return "0:00.00";
    }
    const minutes = Math.floor(seconds / 60);
    const rest = seconds - minutes * 60;
    return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

/**
 * Audio editor: a waveform workstation over the asset, in the spirit of Audition's waveform view.
 *
 * The decoded samples are the document — every operation produces a new clip, kept in an undo
 * stack and played straight from memory, so what you hear is always the edited version. The
 * original asset file is never touched: edits are written out through "save as a new asset",
 * which keeps an irreversible overwrite off the table for a preview surface.
 */
export function AudioPreviewEditor({ tabId, payload, active }: EditorComponentProps<AudioPreviewPayload>) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const asset = payload?.asset;

    const [metadata, setMetadata] = useState<AssetData<AssetType.Audio>["metadata"] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Undo/redo is a stack of whole clips (the edit operations are pure, so there is nothing
    // cheaper to snapshot) behind one reducer — see clipHistory for why the stacks cannot live in
    // separate useStates.
    const [history, dispatchHistory] = useReducer(clipHistoryReducer, initialClipHistory);
    const { past, present: clip, future, dirty } = history;

    const [view, setView] = useState<SampleRange>({ start: 0, end: 1 });
    const [selection, setSelection] = useState<SampleRange | null>(null);
    const [cuePoints, setCuePoints] = useState<AudioCuePoint[]>(
        () => (payload?.asset.extras?.cuePoints as AudioCuePoint[] | undefined) ?? [],
    );
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
                    dispatchHistory({ type: "load", clip: loaded });
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

    // ---- history -----------------------------------------------------------

    const commit = useCallback((next: AudioClip) => dispatchHistory({ type: "edit", clip: next }), []);
    const undo = useCallback(() => dispatchHistory({ type: "undo" }), []);
    const redo = useCallback(() => dispatchHistory({ type: "redo" }), []);

    // Feeds the shared toolbar controls and the History panel.
    useEditorHistoryProvider(tabId, { canUndo: past.length > 0, canRedo: future.length > 0, undo, redo });

    // Editing changes the clip length; keep the view and selection inside it.
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

    // ---- operations --------------------------------------------------------

    const range = useMemo(() => (clip ? resolveRange(clip, selection) : null), [clip, selection]);
    const hasSelection = Boolean(selection && selection.end > selection.start);

    /**
     * Editing keeps whole decoded copies in memory (the clip itself plus each undo snapshot), so
     * it is offered only for clips short enough that those copies are cheap — game audio that
     * wants editing is SFX and loops, while a full music track in a preview pane is something you
     * listen to and cue, not something you crop. Longer clips still get the waveform, playback,
     * zoom and cue points; only the operations are withheld.
     */
    const editable = clip !== null && clipDuration(clip) <= EDITABLE_DURATION_LIMIT_SECONDS;

    const runEdit = useCallback(
        (operation: (target: AudioClip, target_range: SampleRange) => AudioClip) => {
            if (!clip || !range || !editable) {
                return;
            }
            stop();
            commit(operation(clip, range));
        },
        [clip, range, commit, stop, editable],
    );

    const addCue = useCallback(
        (sample: number) => {
            if (!clip) {
                return;
            }
            const timeMs = Math.round((sample / clip.sampleRate) * 1000);
            setCuePoints(previous => {
                const next = [...previous, { timeMs }].sort((a, b) => a.timeMs - b.timeMs);
                if (context && asset) {
                    void context.services.get<AssetsService>(Services.Assets).patchAssetExtras(asset, {
                        cuePoints: next,
                    });
                }
                return next;
            });
        },
        [clip, context, asset],
    );

    const removeCue = useCallback(
        (index: number) => {
            setCuePoints(previous => {
                const next = previous.filter((_, i) => i !== index);
                if (context && asset) {
                    void context.services.get<AssetsService>(Services.Assets).patchAssetExtras(asset, {
                        cuePoints: next.length > 0 ? next : undefined,
                    });
                }
                return next;
            });
        },
        [context, asset],
    );

    const [saving, setSaving] = useState(false);
    const saveAsNewAsset = useCallback(async () => {
        if (!clip || !context || !asset) {
            return;
        }
        const uiService = context.services.get<UIService>(Services.UI);
        setSaving(true);
        try {
            const assetsService = context.services.get<AssetsService>(Services.Assets);
            const baseName = asset.name.replace(/\.[^.]+$/, "");
            const result = await assetsService.importFromBytes(
                AssetType.Audio,
                `${baseName}-edited.wav`,
                encodeWav(clip),
            );
            if (!result.success) {
                uiService.showError(result.error ?? t("assets.audio.editor.saveFailed"));
                return;
            }
            dispatchHistory({ type: "saved" });
            uiService.showNotification(t("assets.audio.editor.saved", { name: result.data.name }), "success");
        } finally {
            setSaving(false);
        }
    }, [clip, context, asset, t]);

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
    const selectionSeconds = hasSelection && selection ? (selection.end - selection.start) / clip.sampleRate : 0;
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

                <span className="flex-1" />

                <button type="button" onClick={undo} disabled={past.length === 0} className={toolButton} title={t("workspace.shell.history.undo")}>
                    <Undo2 className="h-4 w-4" />
                </button>
                <button type="button" onClick={redo} disabled={future.length === 0} className={toolButton} title={t("workspace.shell.history.redo")}>
                    <Redo2 className="h-4 w-4" />
                </button>
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

            {/* Editing operations */}
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-edge bg-surface-raised px-3 py-1.5">
                <span className="mr-1 text-xs text-fg-subtle">
                    {!editable
                        ? t("assets.audio.editor.tooLongToEdit", { limit: EDITABLE_DURATION_LIMIT_SECONDS })
                        : hasSelection
                            ? t("assets.audio.editor.selectionLabel", { duration: formatTime(selectionSeconds) })
                            : t("assets.audio.editor.wholeClipLabel")}
                </span>
                <div
                    className={`flex flex-wrap items-center gap-1.5 ${editable ? "" : "pointer-events-none opacity-40"}`}
                >
                <button type="button" className={textButton} onClick={() => runEdit(cropTo)}>
                    <Crop className="mr-1 inline h-3 w-3" />
                    {t("assets.audio.editor.crop")}
                </button>
                <button type="button" className={textButton} disabled={!hasSelection} onClick={() => runEdit(deleteRange)}>
                    <Scissors className="mr-1 inline h-3 w-3" />
                    {t("assets.audio.editor.delete")}
                </button>
                <button type="button" className={textButton} onClick={() => runEdit(silenceRange)}>
                    {t("assets.audio.editor.silence")}
                </button>
                <button type="button" className={textButton} onClick={() => runEdit((c, r) => applyFade(c, r, "in"))}>
                    {t("assets.audio.editor.fadeIn")}
                </button>
                <button type="button" className={textButton} onClick={() => runEdit((c, r) => applyFade(c, r, "out"))}>
                    {t("assets.audio.editor.fadeOut")}
                </button>
                <button type="button" className={textButton} onClick={() => runEdit((c, r) => applyGain(c, r, 1.25))}>
                    {t("assets.audio.editor.gainUp")}
                </button>
                <button type="button" className={textButton} onClick={() => runEdit((c, r) => applyGain(c, r, 0.8))}>
                    {t("assets.audio.editor.gainDown")}
                </button>
                <button type="button" className={textButton} onClick={() => runEdit((c, r) => normalizeRange(c, r))}>
                    {t("assets.audio.editor.normalize")}
                </button>
                <button type="button" className={textButton} onClick={() => runEdit(reverseRange)}>
                    <ArrowLeftRight className="mr-1 inline h-3 w-3" />
                    {t("assets.audio.editor.reverse")}
                </button>
                </div>

                {/* Cue marking stays available at any length — it does not copy the samples. */}
                <button type="button" className={textButton} onClick={() => addCue(position)}>
                    <Flag className="mr-1 inline h-3 w-3" />
                    {t("assets.audio.editor.addCue")}
                </button>

                <span className="flex-1" />

                {dirty && <span className="text-xs text-warning">{t("assets.audio.editor.unsaved")}</span>}
                <button
                    type="button"
                    className={textButton}
                    disabled={!dirty || saving}
                    onClick={() => void saveAsNewAsset()}
                >
                    {t("assets.audio.editor.saveAsNew")}
                </button>
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
