import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AlertCircle,
    ImageDown,
    Pause,
    Play,
    RefreshCw,
    Repeat,
    SkipBack,
    StepBack,
    StepForward,
    Volume2,
    VolumeX,
} from "lucide-react";
import { EditorComponentProps } from "../../types";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { assetLibraryFreezeScope } from "../assetLiveSession";
import { useKeybindings, whenEditorFocused, type KeybindingDefinition } from "@/apps/workspace/hooks";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { TooltipGroup } from "@/lib/tooltip";
import { Select } from "@/lib/components/elements";
import { ASSET_UNDECODABLE } from "@/lib/workspace/services/assets/assetReadFailure";
import { openAssetPreviewTabsInEditor } from "../dnd/openDraggedAssetsInEditor";
import { useAssetBlobUrl } from "./useAssetBlobUrl";
import { useAssetReadNotice, type AssetReadFailure } from "./useAssetReadNotice";
import { fromAudioBuffer, type AudioClip, type SampleRange } from "./audio/audioClip";
import { clampView, ensureVisible, fitAll, scrollByFraction, zoomAt } from "./audio/viewWindow";
import { resolvePlayStart } from "./audio/transport";
import { estimateFrameRate, formatFrameRate, frameCount, frameIndexAt, frameSeekTime, readVideoTiming } from "./video/frameRate";
import { FIT_VIEW, formatZoom, resolveView, zoomTo, ZOOM_PRESETS, type FrameView, type Size } from "./video/frameViewport";
import { FilmstripDecoder } from "./video/filmstrip";
import { captureVideoFrame, frameCaptureName } from "./video/frameCapture";
import { useVideoTransport } from "./video/useVideoTransport";
import { VideoFrameView } from "./video/VideoFrameView";
import { FILMSTRIP_HEIGHT, timelineHeight, VideoTimelineView } from "./video/VideoTimelineView";

interface VideoPreviewPayload {
    asset: Asset<AssetType.Video>;
}

/** The workspace's shared icon-button chrome, so this toolbar matches the audio preview's. */
const ICON_BUTTON_CLASS = controlButtonClass();

/** Shift+arrow jumps this far; the bare arrows step one frame. */
const COARSE_STEP_MS = 1000;
/** Used for stepping until the clip's frame rate is known - read from the file or measured. */
const FALLBACK_FRAME_MS = 1000 / 30;
/** How much of each end the loop-seam preview plays. */
const SEAM_LEAD_MS = 2000;

const SPEEDS = [0.25, 0.5, 1, 1.5, 2] as const;

/**
 * What a blob of this clip's bytes is typed as. A blob with no type is not decoded at all, and the
 * extension is the only name the bytes still have - they are stored under the asset's id.
 */
function videoMimeType(ext: string | undefined): string {
    switch ((ext ?? "").toLowerCase()) {
        case "webm":
            return "video/webm";
        case "ogv":
        case "ogg":
            return "video/ogg";
        default:
            return "video/mp4";
    }
}

function formatTime(ms: number): string {
    const seconds = Math.max(0, Number.isFinite(ms) ? ms / 1000 : 0);
    const minutes = Math.floor(seconds / 60);
    const rest = seconds - minutes * 60;
    return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

function formatBytes(size: number): string {
    return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${(size / 1024).toFixed(1)} KB`;
}

/**
 * Video preview: the picture, a timeline of its frames and sound, and the transport to move through
 * it - the audio preview's layout, for a clip that has a picture.
 *
 * An inspector, not an editor. Nothing the game reads about a video is authored here: `/video` and
 * the `nl.video` element play the whole file, so in and out points would be marks that mean nothing
 * downstream. What the author needs from this tab is to see the clip - frame by frame, at actual
 * pixels, across its loop seam - and, for the one thing that is written, to take a frame out of it
 * as an image asset.
 */
export function VideoPreviewEditor({ tabId, payload, active }: EditorComponentProps<VideoPreviewPayload>) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    // Everything here is inspection and stays live while frozen, except saving a frame, which adds
    // an asset to the library.
    const freeze = useFreezeGuard(assetLibraryFreezeScope());
    const asset = payload?.asset;

    const { url, bytes, loading, failure } = useAssetBlobUrl(asset, videoMimeType(asset?.ext));
    const [undecodable, setUndecodable] = useState(false);
    const readFailure = useMemo<AssetReadFailure | null>(
        () => failure ?? (undecodable ? { code: ASSET_UNDECODABLE } : null),
        [failure, undecodable],
    );
    const notice = useAssetReadNotice(asset?.id, readFailure);

    const [video, setVideo] = useState<HTMLVideoElement | null>(null);
    const [frameSize, setFrameSize] = useState<Size | null>(null);
    const [durationMs, setDurationMs] = useState(0);
    const [frameView, setFrameView] = useState<FrameView>(FIT_VIEW);
    const [view, setView] = useState<SampleRange>({ start: 0, end: 1 });
    const [selection, setSelection] = useState<SampleRange | null>(null);
    const [muted, setMuted] = useState(false);
    const [transparent, setTransparent] = useState(false);
    const [audio, setAudio] = useState<AudioClip | null>(null);

    // A different asset, or new bytes under the same one, starts over.
    useEffect(() => {
        setUndecodable(false);
        setFrameSize(null);
        setDurationMs(0);
        setFrameView(FIT_VIEW);
        setSelection(null);
        setTransparent(false);
        setAudio(null);
    }, [asset?.id, asset?.hash]);

    // ---- frame rate ----------------------------------------------------------

    const timing = useMemo(() => (bytes ? readVideoTiming(bytes) : null), [bytes]);
    const statedRate = timing?.rate ?? null;
    const [measuredRate, setMeasuredRate] = useState<number | null>(null);
    const intervalsRef = useRef<number[]>([]);
    useEffect(() => {
        intervalsRef.current = [];
        setMeasuredRate(null);
    }, [bytes]);
    const frameRate = statedRate ?? measuredRate;
    const onFrameInterval = useCallback(
        (seconds: number) => {
            if (statedRate !== null || measuredRate !== null) {
                return;
            }
            intervalsRef.current.push(seconds);
            const estimate = estimateFrameRate(intervalsRef.current.slice(-30));
            if (estimate !== null && intervalsRef.current.length >= 30) {
                setMeasuredRate(estimate);
            }
        },
        [statedRate, measuredRate],
    );

    const transport = useVideoTransport(video, onFrameInterval);
    const { playing, position, currentPosition, finished, loop, setLoop, rate, setRate, play, stop, seek } = transport;

    useEffect(() => {
        if (video) {
            video.muted = muted;
        }
    }, [video, muted]);

    // ---- loading -------------------------------------------------------------

    const handleLoadedMetadata = useCallback((element: HTMLVideoElement) => {
        setFrameSize(element.videoWidth && element.videoHeight ? { width: element.videoWidth, height: element.videoHeight } : null);
        if (Number.isFinite(element.duration) && element.duration > 0) {
            const ms = Math.round(element.duration * 1000);
            setDurationMs(ms);
            setView(fitAll(ms));
            return;
        }
        // A clip written by a live recorder states no duration until the element has read to the end;
        // asking for a time past it makes Chromium find out, and `durationchange` brings the answer.
        const onDuration = () => {
            if (Number.isFinite(element.duration) && element.duration > 0) {
                element.removeEventListener("durationchange", onDuration);
                const ms = Math.round(element.duration * 1000);
                setDurationMs(ms);
                setView(fitAll(ms));
                element.currentTime = 0;
            }
        };
        element.addEventListener("durationchange", onDuration);
        element.currentTime = Number.MAX_SAFE_INTEGER;
    }, []);

    // The clip's sound, for the timeline's lane. Chromium's audio decoder reads the sound track out of
    // a video container just as it reads a sound file; a clip with no sound track simply refuses, and
    // gets no lane.
    useEffect(() => {
        if (!bytes || bytes.byteLength === 0) {
            return;
        }
        let mounted = true;
        const audioContext = new AudioContext();
        void audioContext
            .decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
            .then(decoded => {
                if (mounted && decoded.length > 0) {
                    setAudio(fromAudioBuffer(decoded));
                }
            })
            .catch(() => {
                // No sound track, or one this decoder cannot read: the lane is left out.
            })
            .finally(() => void audioContext.close());
        return () => {
            mounted = false;
        };
    }, [bytes]);

    // The frame viewport, measured once here for both the view and the zoom menu's arithmetic.
    const [frameHost, setFrameHost] = useState<HTMLDivElement | null>(null);
    const frameHostSize = useElementSize(frameHost);

    // The filmstrip decodes on its own hidden element, so building the timeline never moves the picture.
    const [filmstrip, setFilmstrip] = useState<FilmstripDecoder | null>(null);
    const [filmstripRevision, setFilmstripRevision] = useState(0);
    const hasPicture = frameSize !== null;
    useEffect(() => {
        if (!url || !hasPicture) {
            return;
        }
        const host = frameHost?.ownerDocument ?? document;
        const view = host.defaultView ?? window;
        let pending = 0;
        const decoder = new FilmstripDecoder(
            url,
            host,
            FILMSTRIP_HEIGHT * (view.devicePixelRatio || 1),
            () => {
                // Frames land in bursts; one repaint per display frame is plenty.
                if (pending === 0) {
                    pending = view.requestAnimationFrame(() => {
                        pending = 0;
                        setFilmstripRevision(revision => revision + 1);
                    });
                }
            },
            () => setTransparent(true),
        );
        setFilmstrip(decoder);
        return () => {
            if (pending !== 0) {
                view.cancelAnimationFrame(pending);
            }
            decoder.dispose();
            setFilmstrip(null);
        };
    }, [url, hasPicture, frameHost]);

    // ---- transport -----------------------------------------------------------

    const hasSelection = Boolean(selection && selection.end > selection.start);

    const togglePlay = useCallback(() => {
        if (playing) {
            stop();
            return;
        }
        const range = hasSelection ? selection : null;
        play(resolvePlayStart({ position, selection: range, totalSamples: durationMs, finished }), range);
    }, [playing, stop, hasSelection, selection, play, position, durationMs, finished]);

    const seekTo = useCallback(
        (ms: number) => seek(Math.max(0, Math.min(durationMs, ms))),
        [seek, durationMs],
    );

    /** Frames in the picture track: the container's own count, else the duration at the rate. */
    const totalFrames = frameRate && durationMs > 0 ? (timing?.frames ?? frameCount(durationMs / 1000, frameRate)) : null;

    /** Step whole frames, landing mid-frame so the step cannot round back onto the frame it left. */
    const stepFrames = useCallback(
        (count: number) => {
            const from = currentPosition();
            if (!frameRate || !totalFrames) {
                seekTo(from + count * FALLBACK_FRAME_MS);
                return;
            }
            const index = frameIndexAt(from / 1000, frameRate) + count;
            seekTo(frameSeekTime(index, frameRate, totalFrames) * 1000);
        },
        [frameRate, totalFrames, currentPosition, seekTo],
    );

    /**
     * Play across the loop's turnaround and stop: the last seconds, then the first, the way the game
     * loops a clip - by the element's own loop, which is what `nl.video` uses.
     */
    const auditionSeam = useCallback(() => {
        if (durationMs <= 0) {
            return;
        }
        const lead = Math.min(SEAM_LEAD_MS, durationMs / 2);
        play(durationMs - lead, null, { looping: true, stopAfterWrapAt: lead });
    }, [durationMs, play]);

    // Follow the playhead once it leaves the visible window.
    useEffect(() => {
        if (playing && durationMs > 0) {
            setView(current => ensureVisible(current, durationMs, Math.round(position)));
        }
    }, [playing, position, durationMs]);

    // Kept-alive tabs stay mounted while hidden; a hidden tab must not keep playing.
    useEffect(() => {
        if (!active) {
            stop();
        }
    }, [active, stop]);

    // ---- timeline view -------------------------------------------------------

    const timelineRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const element = timelineRef.current;
        if (!element || durationMs <= 0) {
            return;
        }
        // The audio preview's wheel: ⌘/Ctrl zooms the time axis about the pointer, anything else
        // scrolls it sideways.
        const onWheel = (event: WheelEvent) => {
            if (event.ctrlKey || event.metaKey) {
                event.preventDefault();
                const rect = element.getBoundingClientRect();
                setView(current => {
                    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                    const anchor = current.start + ratio * (current.end - current.start);
                    return zoomAt(current, durationMs, event.deltaY < 0 ? 1.2 : 1 / 1.2, anchor);
                });
                return;
            }
            const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            if (delta !== 0) {
                event.preventDefault();
                setView(current => scrollByFraction(current, durationMs, delta / 400));
            }
        };
        element.addEventListener("wheel", onWheel, { passive: false });
        return () => element.removeEventListener("wheel", onWheel);
    }, [durationMs]);

    useEffect(() => {
        if (durationMs > 0) {
            setView(current => clampView(current, durationMs));
        }
    }, [durationMs]);

    const zoomTimeline = useCallback(
        (factor: number) => {
            setView(current => zoomAt(current, durationMs, factor, playing ? position : (current.start + current.end) / 2));
        },
        [durationMs, playing, position],
    );

    const selectAll = useCallback(() => {
        if (durationMs > 0) {
            setSelection({ start: 0, end: durationMs });
        }
    }, [durationMs]);

    // ---- frame capture -------------------------------------------------------

    const [saving, setSaving] = useState(false);
    const saveFrame = useCallback(async () => {
        if (!video || !context || !asset || freeze.frozen || saving) {
            return;
        }
        stop();
        const ui = context.services.get<UIService>(Services.UI);
        setSaving(true);
        try {
            const png = await captureVideoFrame(video);
            if (!png) {
                ui.showNotification(t("assets.video.editor.frameSaveFailed"), "error");
                return;
            }
            const assets = context.services.get<AssetsService>(Services.Assets);
            const result = await assets.createLocalAssetFromBytes(AssetType.Image, frameCaptureName(asset.name, position), png);
            if (!result.success || !result.data) {
                ui.showNotification(t("assets.video.editor.frameSaveFailed"), "error", { detail: result.error });
                return;
            }
            const created = result.data;
            ui.showNotification(t("assets.video.editor.frameSaved", { name: created.name }), "success", {
                actions: [{ label: t("assets.video.editor.open"), onClick: () => openAssetPreviewTabsInEditor(context, [created]) }],
            });
        } catch (error) {
            console.warn(`[assets] could not save a frame of ${asset.id}`, error);
            ui.showNotification(t("assets.video.editor.frameSaveFailed"), "error");
        } finally {
            setSaving(false);
        }
    }, [video, context, asset, freeze.frozen, saving, stop, position, t]);

    // ---- keybindings ---------------------------------------------------------

    const keybindings = useMemo<KeybindingDefinition[]>(
        () => [
            { id: "play-pause", key: "space", description: "Play or pause", handler: togglePlay },
            { id: "audition-seam", key: "shift+space", description: "Preview loop seam", handler: auditionSeam },
            { id: "to-start", key: "home", description: "Go to start", handler: () => seekTo(0) },
            { id: "to-end", key: "end", description: "Go to end", handler: () => seekTo(durationMs) },
            { id: "previous-frame", key: "arrowleft", description: "Previous frame", handler: () => stepFrames(-1) },
            { id: "next-frame", key: "arrowright", description: "Next frame", handler: () => stepFrames(1) },
            { id: "back-second", key: "shift+arrowleft", description: "Back one second", handler: () => seekTo(currentPosition() - COARSE_STEP_MS) },
            { id: "forward-second", key: "shift+arrowright", description: "Forward one second", handler: () => seekTo(currentPosition() + COARSE_STEP_MS) },
            { id: "loop", key: "r", description: "Toggle loop", handler: () => setLoop(value => !value) },
            { id: "select-all", key: "mod+a", description: "Select whole clip", handler: selectAll },
            { id: "clear-selection", key: "escape", description: "Clear selection", handler: () => setSelection(null) },
            { id: "zoom-in", key: "=", description: "Zoom timeline in", handler: () => zoomTimeline(1.4) },
            { id: "zoom-out", key: "-", description: "Zoom timeline out", handler: () => zoomTimeline(1 / 1.4) },
            { id: "zoom-fit", key: "0", description: "Fit whole clip in timeline", handler: () => setView(fitAll(durationMs)) },
        ],
        [togglePlay, auditionSeam, seekTo, durationMs, stepFrames, currentPosition, setLoop, selectAll, zoomTimeline],
    );

    useKeybindings({
        keybindings,
        enabled: durationMs > 0,
        when: whenEditorFocused(tabId),
        idPrefix: `video-preview-${tabId}`,
        catalogPrefix: "assets.video.",
    });

    // ---- zoom menu -----------------------------------------------------------

    const currentZoom = frameSize && frameHostSize ? resolveView(frameView, frameHostSize, frameSize).zoom : 1;
    const zoomOptions = useMemo(() => {
        const options = [
            { value: "fit", label: t("assets.video.editor.zoomFit") },
            ...ZOOM_PRESETS.map(zoom => ({ value: String(zoom), label: formatZoom(zoom) })),
        ];
        if (frameView.mode === "manual" && !ZOOM_PRESETS.some(zoom => Math.abs(zoom - currentZoom) < 1e-6)) {
            // A wheel zoom lands between presets; the menu names it rather than claiming a preset.
            options.push({ value: "custom", label: formatZoom(currentZoom) });
        }
        return options;
    }, [t, frameView.mode, currentZoom]);
    const zoomValue = frameView.mode === "fit"
        ? "fit"
        : ZOOM_PRESETS.find(zoom => Math.abs(zoom - currentZoom) < 1e-6)?.toString() ?? "custom";
    const speedOptions = useMemo(() => SPEEDS.map(speed => ({ value: String(speed), label: `${speed}×` })), []);

    // ---- render --------------------------------------------------------------

    if (!asset) {
        return null;
    }
    if (loading) {
        return (
            <div className="flex h-full items-center justify-center bg-surface">
                <div className="flex items-center gap-2 text-fg-muted">
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    <span>{t("assets.video.loading")}</span>
                </div>
            </div>
        );
    }
    if (notice || !url) {
        return (
            <div className="flex h-full items-center justify-center bg-surface p-4">
                <div className="flex max-w-md items-start gap-2 rounded-md bg-danger/10 p-4 text-danger">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                        <p className="font-medium">{t("assets.video.loadError")}</p>
                        {notice && <p className="mt-1 text-sm text-danger/80">{notice}</p>}
                    </div>
                </div>
            </div>
        );
    }

    const ready = durationMs > 0;
    const separator = <span className="mx-1.5 h-4 w-px shrink-0 bg-edge" />;
    const currentFrame = frameRate ? Math.min((totalFrames ?? 1) - 1, frameIndexAt(position / 1000, frameRate)) : null;

    return (
        <div className="flex h-full flex-col bg-surface" data-help-topic="videoClips">
            {/* Transport and view. Everything else is a gesture or a shortcut. */}
            <TooltipGroup className="flex shrink-0 flex-wrap items-center gap-1 border-b border-edge bg-surface-raised px-2 py-1.5">
                <button
                    type="button"
                    onClick={togglePlay}
                    disabled={!ready}
                    className={ICON_BUTTON_CLASS}
                    data-tip={playing ? t("assets.audio.pause") : t("assets.audio.play")}
                    aria-label={playing ? t("assets.audio.pause") : t("assets.audio.play")}
                >
                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <button
                    type="button"
                    onClick={() => seekTo(hasSelection && selection ? selection.start : 0)}
                    disabled={!ready}
                    className={ICON_BUTTON_CLASS}
                    data-tip={t("assets.audio.editor.toStart")}
                    aria-label={t("assets.audio.editor.toStart")}
                >
                    <SkipBack className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    onClick={() => stepFrames(-1)}
                    disabled={!ready}
                    className={ICON_BUTTON_CLASS}
                    data-tip={t("assets.video.editor.previousFrame")}
                    aria-label={t("assets.video.editor.previousFrame")}
                >
                    <StepBack className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    onClick={() => stepFrames(1)}
                    disabled={!ready}
                    className={ICON_BUTTON_CLASS}
                    data-tip={t("assets.video.editor.nextFrame")}
                    aria-label={t("assets.video.editor.nextFrame")}
                >
                    <StepForward className="h-4 w-4" />
                </button>
                <button
                    type="button"
                    onClick={() => setLoop(value => !value)}
                    className={controlButtonClass(loop)}
                    data-tip={t("assets.audio.editor.loop")}
                    aria-label={t("assets.audio.editor.loop")}
                    aria-pressed={loop}
                >
                    <Repeat className="h-4 w-4" />
                </button>

                {separator}

                <span className="shrink-0 tabular-nums text-xs text-fg-muted">
                    {formatTime(position)} / {formatTime(durationMs)}
                </span>

                {separator}

                <Select
                    size="md"
                    className="w-20"
                    options={speedOptions}
                    value={String(rate)}
                    onChange={value => setRate(Number(value))}
                    ariaLabel={t("assets.video.editor.speed")}
                />
                <Select
                    size="md"
                    className="w-28"
                    options={zoomOptions}
                    value={zoomValue}
                    disabled={!frameSize || !frameHostSize}
                    onChange={value => {
                        if (value === "fit") {
                            setFrameView(FIT_VIEW);
                        } else if (value !== "custom" && frameSize && frameHostSize) {
                            setFrameView(zoomTo(frameView, frameHostSize, frameSize, Number(value)));
                        }
                    }}
                    ariaLabel={t("assets.video.editor.zoom")}
                />

                {separator}

                {/* The one control that writes: it adds an image asset, so a frozen project turns it off. */}
                <button
                    type="button"
                    onClick={() => void saveFrame()}
                    className={`${ICON_BUTTON_CLASS} disabled:cursor-not-allowed disabled:opacity-40`}
                    aria-label={t("assets.video.editor.saveFrame")}
                    {...freeze.writes(!frameSize || saving, t("assets.video.editor.saveFrame"))}
                >
                    <ImageDown className="h-4 w-4" />
                </button>

                <span className="flex-1" />

                {/* Mute only, no level slider: a preview needs "not now" far more than a monitoring level,
                    and the slider's width is what kept this toolbar from fitting a docked tab. */}
                <button
                    type="button"
                    onClick={() => setMuted(value => !value)}
                    className={ICON_BUTTON_CLASS}
                    data-tip={muted ? t("assets.audio.unmute") : t("assets.audio.mute")}
                    aria-label={muted ? t("assets.audio.unmute") : t("assets.audio.mute")}
                    aria-pressed={muted}
                >
                    {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
            </TooltipGroup>

            {/* The picture takes whatever height the timeline leaves. */}
            <div className="flex min-h-0 flex-1 px-3 pt-2">
                <div ref={setFrameHost} className="relative min-h-0 w-full overflow-hidden rounded-md border border-edge bg-surface-sunken">
                    <VideoFrameView
                        src={url}
                        frameSize={frameSize}
                        viewport={frameHostSize ?? { width: 0, height: 0 }}
                        view={frameView}
                        onViewChange={setFrameView}
                        transparency={transparent}
                        videoRef={setVideo}
                        onLoadedMetadata={handleLoadedMetadata}
                        onError={() => setUndecodable(true)}
                    />
                </div>
            </div>

            {/* The timeline: bounded to its lanes, never stretched - a taller filmstrip shows no more. */}
            <div ref={timelineRef} className="shrink-0 px-3 pb-2 pt-2">
                <div
                    className="relative w-full overflow-hidden rounded-md border border-edge bg-surface-sunken"
                    style={{ height: timelineHeight(audio !== null) + 2 }}
                >
                    {ready && (
                        <VideoTimelineView
                            durationMs={durationMs}
                            view={view}
                            selection={selection}
                            playhead={position}
                            frameAspect={frameSize ? frameSize.width / frameSize.height : 16 / 9}
                            filmstrip={filmstrip}
                            filmstripRevision={filmstripRevision}
                            audio={audio}
                            onSelectionChange={setSelection}
                            onSeek={seekTo}
                            onScrub={seekTo}
                            onSelectAll={selectAll}
                        />
                    )}
                </div>
            </div>

            {/* One status bar, values only. */}
            <div className="flex shrink-0 items-center gap-3 border-t border-edge px-3 py-1 text-2xs tabular-nums text-fg-subtle">
                {hasSelection && selection && (
                    <span className="text-fg-muted">
                        {formatTime(selection.start)} – {formatTime(selection.end)}
                        {" ("}
                        {formatTime(selection.end - selection.start)}
                        {")"}
                    </span>
                )}
                <span className="flex-1" />
                {currentFrame !== null && totalFrames !== null && (
                    <span>{t("assets.video.editor.frame", { frame: currentFrame + 1, total: totalFrames })}</span>
                )}
                {frameSize && <span>{frameSize.width}×{frameSize.height}</span>}
                {frameRate && <span>{formatFrameRate(frameRate)} fps</span>}
                {transparent && <span>{t("assets.video.editor.transparent")}</span>}
                {bytes && <span>{formatBytes(bytes.byteLength)}</span>}
                <span className="max-w-[16rem] truncate">{asset.name}</span>
            </div>
        </div>
    );
}

/** An element's content-box size, kept current; null until it has one. */
function useElementSize(element: HTMLElement | null): Size | null {
    const [size, setSize] = useState<Size | null>(null);
    useEffect(() => {
        if (!element) {
            setSize(null);
            return;
        }
        const observer = new ResizeObserver(entries => {
            const rect = entries[0]?.contentRect;
            if (rect && rect.width > 0 && rect.height > 0) {
                setSize(current =>
                    current && Math.round(current.width) === Math.round(rect.width) && Math.round(current.height) === Math.round(rect.height)
                        ? current
                        : { width: rect.width, height: rect.height });
            }
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [element]);
    return size;
}
