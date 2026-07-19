import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
    AlertCircle,
    BetweenVerticalEnd,
    BetweenVerticalStart,
    Crop,
    Maximize,
    Pause,
    Play,
    RefreshCw,
    Repeat,
    SkipBack,
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
import { useKeybindings, whenEditorFocused, type KeybindingDefinition } from "@/apps/workspace/hooks";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { WaveformView, type LoopEnd } from "./audio/WaveformView";
import { useClipPlayback } from "./audio/useClipPlayback";
import { clipDuration, clipLength, fromAudioBuffer, type AudioClip, type SampleRange } from "./audio/audioClip";
import { clampView, ensureVisible, fitAll, scrollByFraction, zoomAt, zoomToRange } from "./audio/viewWindow";
import { resolvePlayStart } from "./audio/transport";
import {
    clearPoint,
    fromAssetExtras,
    loopHistoryReducer,
    markPoint,
    sameLoop,
    toAssetLoop,
    type LoopHistoryState,
    type LoopPoints,
} from "./audio/loopHistory";

interface AudioPreviewPayload {
    asset: Asset<AssetType.Audio>;
}

/**
 * How tall the waveform is allowed to get, per channel lane.
 *
 * Bounded rather than filling the tab: a waveform stretched to the full height of a maximised
 * editor is all amplitude and no information - the shape stops being readable well before it
 * stops growing. Stereo gets more room because it draws a lane per channel.
 */
const MAX_LANE_HEIGHT_PX = 200;

/** The workspace's shared icon-button chrome, so this toolbar matches every other editor's. */
const ICON_BUTTON_CLASS = controlButtonClass();

/** Arrow-key nudge, in seconds; shift takes the coarse step. */
const NUDGE_SECONDS = 0.1;
const NUDGE_SECONDS_COARSE = 1;

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return "0:00.00";
    }
    const minutes = Math.floor(seconds / 60);
    const rest = seconds - minutes * 60;
    return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

/**
 * Audio preview: a read-only waveform over the asset - playback, zoom/scroll, range auditioning,
 * and the clip's in and out points.
 *
 * Deliberately not an editor. Studio's job is to tell you what a clip sounds like and where its
 * interesting moments are, not to be a DAW; trimming and gain belong in the tool the audio came
 * from. What survives is the part that informs authoring: drag a range and loop it to find a BGM's
 * in/out points, then mark them. Those two points are the only thing written back (to the asset
 * record - they are authored data, not a cache); the audio file is never modified.
 *
 * That also makes cue points the only undoable thing here, which is what the history covers.
 */
export function AudioPreviewEditor({ tabId, payload, active }: EditorComponentProps<AudioPreviewPayload>) {
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
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);

    const [loopHistory, dispatchLoop] = useReducer(
        loopHistoryReducer,
        payload?.asset.extras,
        (stored): LoopHistoryState => ({ past: [], present: fromAssetExtras(stored), future: [] }),
    );
    /**
     * The region mid-drag. A drag emits a position on every pointer move; routing those through
     * the history would bury the previous state under a hundred one-pixel steps, so the drag
     * renders from here and commits a single step when the pointer comes up.
     */
    const [draftLoop, setDraftLoop] = useState<LoopPoints | null>(null);
    const loopPoints = draftLoop ?? loopHistory.present;

    const playback = useClipPlayback(clip);
    const { playing, position, setPosition, finished, loop, setLoop, play, stop, setGain } = playback;
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

    // ---- in and out points -------------------------------------------------

    // The region rides with the asset record, so it survives closing the tab and is visible to
    // anything else reading the asset.
    const persistLoop = useCallback(
        (next: LoopPoints) => {
            if (context && asset) {
                void context.services.get<AssetsService>(Services.Assets).patchAssetExtras(asset, {
                    audioLoop: toAssetLoop(next),
                    // Drop the superseded list, so a record never carries both shapes.
                    cuePoints: undefined,
                });
            }
        },
        [context, asset],
    );

    /**
     * The region last written to the asset. Persisting from here rather than from each command
     * means undo and redo save their result too - they are edits like any other, and a region
     * that reverts on screen but not on disk is the bug this avoids.
     */
    const persistedRef = useRef<LoopPoints | null>(null);
    const loadedAssetRef = useRef(asset?.id);

    useEffect(() => {
        if (loadedAssetRef.current === asset?.id) {
            return;
        }
        loadedAssetRef.current = asset?.id;
        persistedRef.current = null;
        dispatchLoop({ type: "load", loop: fromAssetExtras(asset?.extras) });
    }, [asset?.id]);

    useEffect(() => {
        const committed = loopHistory.present;
        if (persistedRef.current === null) {
            // First pass for this asset: adopt what is already stored as the baseline.
            persistedRef.current = committed;
            return;
        }
        if (sameLoop(persistedRef.current, committed)) {
            return;
        }
        persistedRef.current = committed;
        persistLoop(committed);
    }, [loopHistory.present, persistLoop]);

    const commitLoop = useCallback((next: LoopPoints) => {
        setDraftLoop(null);
        dispatchLoop({ type: "set", loop: next });
    }, []);

    const sampleToMs = useCallback(
        (sample: number) => (clip ? Math.max(0, Math.round((sample / clip.sampleRate) * 1000)) : 0),
        [clip],
    );

    /** Mark one end at the playhead - the two toolbar buttons and their I/O shortcuts. */
    const markLoopPoint = useCallback(
        (end: LoopEnd) => {
            if (clip) {
                commitLoop(markPoint(loopHistory.present, end, sampleToMs(position)));
            }
        },
        [clip, commitLoop, loopHistory.present, position, sampleToMs],
    );

    const clearLoopPoint = useCallback(
        (end: LoopEnd) => {
            commitLoop(clearPoint(loopHistory.present, end));
        },
        [commitLoop, loopHistory.present],
    );

    const dragLoopPoint = useCallback(
        (end: LoopEnd, sample: number) => {
            if (clip) {
                // markPoint, not a raw assignment: dragging one end past the other has to resolve
                // the same way as marking it there, or the drag could build an inverted region.
                setDraftLoop(markPoint(draftLoop ?? loopHistory.present, end, sampleToMs(sample)));
            }
        },
        [clip, draftLoop, loopHistory.present, sampleToMs],
    );

    const endLoopDrag = useCallback(() => {
        if (draftLoop) {
            commitLoop(draftLoop);
        }
    }, [draftLoop, commitLoop]);


    // ---- transport ---------------------------------------------------------

    const playhead = position;
    const togglePlay = useCallback(() => {
        if (playing) {
            stop();
            return;
        }
        play(resolvePlayStart({ position, selection, totalSamples, finished }), selection);
    }, [playing, stop, play, position, selection, totalSamples, finished]);

    const seekTo = useCallback(
        (sample: number) => {
            stop();
            setPosition(Math.max(0, Math.min(Math.max(0, totalSamples - 1), Math.round(sample))));
        },
        [stop, setPosition, totalSamples],
    );

    const nudge = useCallback(
        (seconds: number) => {
            if (clip) {
                seekTo(position + seconds * clip.sampleRate);
            }
        },
        [clip, position, seekTo],
    );

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
                return;
            }
            // A waveform scrolls sideways: take whichever axis the wheel or trackpad reports,
            // rather than leaving a plain vertical wheel doing nothing over a zoomed-in clip.
            const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            if (delta !== 0) {
                event.preventDefault();
                setView(current => scrollByFraction(current, clipLength(clip), delta / 400));
            }
        };
        element.addEventListener("wheel", onWheel, { passive: false });
        return () => element.removeEventListener("wheel", onWheel);
    }, [clip]);

    // ---- keybindings -------------------------------------------------------

    const zoomBy = useCallback(
        (factor: number) => {
            setView(current => zoomAt(current, totalSamples, factor, playing ? position : (current.start + current.end) / 2));
        },
        [totalSamples, playing, position],
    );

    const selectAll = useCallback(() => {
        if (totalSamples > 0) {
            setSelection({ start: 0, end: totalSamples });
        }
    }, [totalSamples]);

    /** Jump to a marked end, so a long clip is navigable by the points on it. */
    const goToLoopPoint = useCallback(
        (end: LoopEnd) => {
            const ms = end === "in" ? loopPoints.inMs : loopPoints.outMs;
            if (!clip || ms === null) {
                return;
            }
            const target = Math.round((ms / 1000) * clip.sampleRate);
            seekTo(target);
            setView(current => ensureVisible(current, clipLength(clip), target));
        },
        [clip, loopPoints, seekTo],
    );

    const keybindings = useMemo<KeybindingDefinition[]>(
        () => [
            { id: "play-pause", key: "space", description: "Play or pause", handler: togglePlay },
            { id: "to-start", key: "home", description: "Go to start", handler: () => seekTo(0) },
            { id: "to-end", key: "end", description: "Go to end", handler: () => seekTo(totalSamples) },
            { id: "nudge-back", key: "arrowleft", description: "Nudge back", handler: () => nudge(-NUDGE_SECONDS) },
            { id: "nudge-forward", key: "arrowright", description: "Nudge forward", handler: () => nudge(NUDGE_SECONDS) },
            {
                id: "nudge-back-coarse",
                key: "shift+arrowleft",
                description: "Nudge back a second",
                handler: () => nudge(-NUDGE_SECONDS_COARSE),
            },
            {
                id: "nudge-forward-coarse",
                key: "shift+arrowright",
                description: "Nudge forward a second",
                handler: () => nudge(NUDGE_SECONDS_COARSE),
            },
            { id: "loop", key: "l", description: "Toggle loop", handler: () => setLoop(value => !value) },
            { id: "mark-in", key: "i", description: "Set in point", handler: () => markLoopPoint("in") },
            { id: "mark-out", key: "o", description: "Set out point", handler: () => markLoopPoint("out") },
            { id: "go-to-in", key: "shift+i", description: "Go to in point", handler: () => goToLoopPoint("in") },
            { id: "go-to-out", key: "shift+o", description: "Go to out point", handler: () => goToLoopPoint("out") },
            { id: "clear-in", key: "mod+shift+i", description: "Clear in point", handler: () => clearLoopPoint("in") },
            { id: "clear-out", key: "mod+shift+o", description: "Clear out point", handler: () => clearLoopPoint("out") },
            { id: "undo", key: "mod+z", description: "Undo point change", handler: () => dispatchLoop({ type: "undo" }) },
            { id: "redo", key: "mod+shift+z", description: "Redo point change", handler: () => dispatchLoop({ type: "redo" }) },
            { id: "select-all", key: "mod+a", description: "Select whole clip", handler: selectAll },
            { id: "clear-selection", key: "escape", description: "Clear selection", handler: () => setSelection(null) },
            { id: "zoom-in", key: "=", description: "Zoom in", handler: () => zoomBy(1.4) },
            { id: "zoom-out", key: "-", description: "Zoom out", handler: () => zoomBy(1 / 1.4) },
            { id: "zoom-fit", key: "0", description: "Fit whole clip", handler: () => setView(fitAll(totalSamples)) },
        ],
        [togglePlay, seekTo, totalSamples, nudge, setLoop, markLoopPoint, goToLoopPoint, clearLoopPoint, selectAll, zoomBy],
    );

    useKeybindings({
        keybindings,
        enabled: Boolean(clip),
        when: whenEditorFocused(tabId),
        idPrefix: `audio-preview-${tabId}`,
        catalogPrefix: "assets.audio.",
    });

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
    const waveformMaxHeight = MAX_LANE_HEIGHT_PX * Math.min(2, Math.max(1, clip.channels.length));
    const separator = <span className="mx-1.5 h-4 w-px shrink-0 bg-edge" />;

    return (
        <div className="flex h-full flex-col bg-surface">
            {/* Transport, view and marker controls. Everything else is a gesture or a shortcut. */}
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-edge bg-surface-raised px-2 py-1.5">
                <button
                    type="button"
                    onClick={togglePlay}
                    className={ICON_BUTTON_CLASS}
                    title={playing ? t("assets.audio.pause") : t("assets.audio.play")}
                >
                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <button
                    type="button"
                    onClick={() => seekTo(hasSelection && selection ? selection.start : 0)}
                    className={ICON_BUTTON_CLASS}
                    title={t("assets.audio.editor.toStart")}
                >
                    <SkipBack className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    onClick={() => setLoop(value => !value)}
                    className={controlButtonClass(loop)}
                    title={t("assets.audio.editor.loop")}
                >
                    <Repeat className="h-4 w-4" />
                </button>

                {separator}

                <span className="shrink-0 tabular-nums text-xs text-fg-muted">
                    {formatTime(position / clip.sampleRate)} / {formatTime(duration)}
                </span>

                {separator}

                <button type="button" onClick={() => zoomBy(1 / 1.4)} className={ICON_BUTTON_CLASS} title={t("assets.audio.editor.zoomOut")}>
                    <ZoomOut className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => zoomBy(1.4)} className={ICON_BUTTON_CLASS} title={t("assets.audio.editor.zoomIn")}>
                    <ZoomIn className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    onClick={() => setView(fitAll(totalSamples))}
                    className={ICON_BUTTON_CLASS}
                    title={t("assets.audio.editor.zoomFit")}
                >
                    <Maximize className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    disabled={!hasSelection}
                    onClick={() => selection && setView(zoomToRange(selection, totalSamples))}
                    className={ICON_BUTTON_CLASS}
                    title={t("assets.audio.editor.zoomSelection")}
                >
                    <Crop className="h-4 w-4" />
                </button>

                {separator}

                <button
                    type="button"
                    onClick={() => markLoopPoint("in")}
                    className={controlButtonClass(loopPoints.inMs !== null)}
                    title={t("assets.audio.editor.markIn")}
                >
                    <BetweenVerticalStart className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    onClick={() => markLoopPoint("out")}
                    className={controlButtonClass(loopPoints.outMs !== null)}
                    title={t("assets.audio.editor.markOut")}
                >
                    <BetweenVerticalEnd className="h-4 w-4" />
                </button>

                <span className="flex-1" />

                <button
                    type="button"
                    onClick={() => setMuted(value => !value)}
                    className={ICON_BUTTON_CLASS}
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
                    className="h-1 w-20 shrink-0 rounded bg-fill accent-fg/70"
                    aria-label={t("assets.audio.volume")}
                />
            </div>

            {/* Waveform: bounded, and anchored under the toolbar rather than centred - centring it
                leaves the clip floating in the middle of a tall tab with dead space above and
                below. No title attribute either: a native tooltip over the editing surface covers
                the very samples being aimed at. */}
            <div ref={wheelRef} className="flex min-h-0 flex-1 items-start px-3 py-2">
                <div
                    className="relative h-full w-full overflow-hidden rounded border border-edge bg-surface-sunken"
                    style={{ maxHeight: waveformMaxHeight }}
                >
                    <WaveformView
                        clip={clip}
                        view={view}
                        selection={selection}
                        loop={loopPoints}
                        playhead={playhead}
                        onSelectionChange={setSelection}
                        onSeek={seekTo}
                        onLoopDrag={dragLoopPoint}
                        onLoopDragEnd={endLoopDrag}
                        onClearLoopPoint={clearLoopPoint}
                        onSelectAll={selectAll}
                    />
                </div>
            </div>

            {/* One status bar. Values only - the selection and the region read as ranges, the
                rest as facts. */}
            <div className="flex shrink-0 items-center gap-3 border-t border-edge px-3 py-1 text-2xs tabular-nums text-fg-subtle">
                {hasSelection && selection && (
                    <span className="text-fg-muted">
                        {formatTime(selection.start / clip.sampleRate)} – {formatTime(selection.end / clip.sampleRate)}
                        {" ("}
                        {formatTime(selectionSeconds)}
                        {")"}
                    </span>
                )}
                {(loopPoints.inMs !== null || loopPoints.outMs !== null) && (
                    <span className="flex items-center gap-1 text-primary">
                        <BetweenVerticalStart className="h-3 w-3" />
                        {loopPoints.inMs === null ? "--:--" : formatTime(loopPoints.inMs / 1000)}
                        {" – "}
                        {loopPoints.outMs === null ? "--:--" : formatTime(loopPoints.outMs / 1000)}
                    </span>
                )}
                <span className="flex-1" />
                <span>{clip.sampleRate} Hz</span>
                <span>{t("assets.audio.editor.channels", { count: clip.channels.length })}</span>
                {metadata && <span>{(metadata.size / 1024).toFixed(1)} KB</span>}
                <span className="max-w-[16rem] truncate">{asset?.name}</span>
            </div>
        </div>
    );
}
