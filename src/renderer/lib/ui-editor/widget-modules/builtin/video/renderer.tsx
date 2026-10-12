import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type SyntheticEvent } from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { useWidgetEventDispatch } from "@/lib/ui-editor/widget-modules/shared/useWidgetEventDispatch";
import {
    useWidgetRuntimeElementKey,
    useWidgetRuntimeStateStore,
    useWidgetRuntimeStoreValue,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import {
    UI_VIDEO_PLAYBACK_AT_REST,
    type UIVideoPlaybackReading,
    type UIVideoRuntimePlayback,
    type UIVideoRuntimePlaybackChange,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { clampVideoSeekSeconds } from "@shared/types/ui-editor/video";
import { translate } from "@/lib/i18n";
import { RectangleChromeRenderer } from "@/lib/ui-editor/widget-modules/shared/chrome/RectangleChromeRenderer";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { useLocalizedAssetId } from "@/lib/ui-editor/runtime/localization/GameLocalizationContext";
import type { AssetResolutionSite, AssetSlot } from "@/lib/ui-editor/runtime/assetResolution";
import { useAssetResolutionReport } from "@/lib/ui-editor/runtime/useAssetResolutionReport";
import {
    getVideoPreviewRestartGeneration,
    isVideoPreviewPlaying,
    releaseVideoPreviewPlayback,
    setVideoPreviewPlaying,
    subscribeVideoPreviewPlayback,
} from "@/lib/ui-editor/interaction/videoPreviewPlayback";
import { getVideoProps } from "./helpers";
import { resolveVideoMixerHost, useVideoElementVolume } from "./videoMixer";

/**
 * The `<video>` fills the chrome box rather than replacing it: corner radius, border, fill,
 * opacity and the chrome's appearance transitions all come from `RectangleChromeRenderer`, which
 * renders whatever it is handed as `children` inside its clipped box. A second box built here would
 * have to re-derive all of that and would drift from the rest of the Surface.
 */
const VIDEO_STYLE_BASE: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    // Corner radius lives on the chrome root; `inherit` follows it without reading the props again.
    borderRadius: "inherit",
};

/** What a drawn `<video>` says about its playback when a graph asks (`Get Video Time` and the rest). */
function readVideoElement(node: HTMLVideoElement): UIVideoPlaybackReading {
    const duration = node.duration;
    return {
        currentTime: Number.isFinite(node.currentTime) ? node.currentTime : 0,
        // NaN until the clip's metadata has loaded, and Infinity for a stream with no end.
        duration: Number.isFinite(duration) ? duration : 0,
        playing: !node.paused && !node.ended,
        ended: node.ended,
    };
}

/**
 * What came of one `play()`: it played; it was overtaken by a pause or a new clip before it could
 * (`AbortError` - nothing went wrong); the browser refused it (`NotAllowedError`, its autoplay
 * policy: sound before the player has interacted with the page); or the clip cannot be played
 * (`NotSupportedError`, or anything else), which the clip's own load failure already reports.
 */
type VideoPlayOutcome = "playing" | "superseded" | "refused" | "unplayable";

async function playVideoElement(node: HTMLVideoElement): Promise<VideoPlayOutcome> {
    try {
        await node.play();
        return "playing";
    } catch (error) {
        const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
        if (name === "AbortError") {
            return "superseded";
        }
        return name === "NotAllowedError" ? "refused" : "unplayable";
    }
}

/** Editor-canvas preview state, subscribed without pulling in a workspace service. */
function useVideoPreviewState(elementId: string, enabled: boolean): { playing: boolean; restartGeneration: number } {
    const [state, setState] = useState(() => ({
        playing: enabled && isVideoPreviewPlaying(elementId),
        restartGeneration: getVideoPreviewRestartGeneration(elementId),
    }));

    useEffect(() => {
        if (!enabled) {
            setState({ playing: false, restartGeneration: getVideoPreviewRestartGeneration(elementId) });
            return;
        }
        const read = () => {
            setState(previous => {
                const playing = isVideoPreviewPlaying(elementId);
                const restartGeneration = getVideoPreviewRestartGeneration(elementId);
                return previous.playing === playing && previous.restartGeneration === restartGeneration
                    ? previous
                    : { playing, restartGeneration };
            });
        };
        read();
        return subscribeVideoPreviewPlayback(read);
    }, [elementId, enabled]);

    return state;
}

export function VideoRenderer(props: WidgetRendererProps) {
    const { element, hostAdapter, surface, instanceKey } = props;
    const videoProps = getVideoProps(element);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const dispatchEvent = useWidgetEventDispatch(props.dispatchEvent);

    /**
     * `blueprintRuntime` is what tells the two hosts apart: the packaged game and Dev Mode install
     * one, the editor canvas never does. This is the same signal `slider/renderer.tsx` uses to
     * decide whether dragging the handle may run an author's graph.
     */
    const isLiveHost = Boolean(hostAdapter.blueprintRuntime);

    /**
     * The element is outside the engine's audio graph, so the mixer has to be applied by hand -
     * otherwise the clip ignores mute, the master slider and its channel's slider entirely. See
     * `videoMixer.ts` for why this multiplies rather than routing into a gain node.
     */
    const mixerHost = useMemo(() => resolveVideoMixerHost(hostAdapter), [hostAdapter]);
    const elementVolume = useVideoElementVolume(mixerHost, videoProps.audioTrackId, videoProps.volume);

    // Pool names as bare strings, not `AssetType.*`: the enum lives in a workspace service module
    // the game-runtime bundle is not allowed to import (see `build-runtime.js`).
    // The element is the reference point for both slots: either may name an asset set, and the
    // answer the build wrote is on this element and nowhere else.
    const sourceAssetId = useLocalizedAssetId(element, videoProps.assetId);
    const posterAssetId = useLocalizedAssetId(element, videoProps.posterAssetId);
    const sourceAnswer = useAssetObjectUrl(sourceAssetId, "video");
    const posterAnswer = useAssetObjectUrl(posterAssetId, "image");
    const sourceUrl = sourceAnswer.url;
    const posterUrl = posterAnswer.url;

    /**
     * Say what became of the clip and the poster, in a running game (the canvas mounts no reporter).
     *
     * The clip is also watched at the element: a grant can resolve for a file that is gone, and a
     * clip the browser cannot decode fails there too, and in both cases the box is left empty. The
     * poster has no load event of its own to watch - the element loads it silently - so only its
     * lookup is reported.
     */
    const [sourceLoadFailedUrl, setSourceLoadFailedUrl] = useState<string | null>(null);
    const slotSite = (slot: AssetSlot): AssetResolutionSite | null => (
        surface
            ? {
                  surfaceId: surface.id,
                  elementId: element.id,
                  ownerName: element.name?.trim() || element.type,
                  slot,
                  instanceKey: instanceKey ?? "",
              }
            : null
    );
    useAssetResolutionReport(slotSite("videoClip"), {
        requested: sourceAssetId ?? null,
        wanted: true,
        answer: sourceAnswer,
        loadFailedUrl: sourceLoadFailedUrl,
    });
    useAssetResolutionReport(slotSite("videoPoster"), {
        requested: posterAssetId ?? null,
        wanted: true,
        answer: posterAnswer,
    });

    const preview = useVideoPreviewState(element.id, !isLiveHost);

    /**
     * What a graph asked of this video - Play, Pause, Stop, Seek - in a running game. A request is
     * kept until there is an element to carry it out on, so a Play sent before the clip has loaded
     * starts it once it has. See `UIVideoRuntimePlayback`.
     */
    const runtimeStore = useWidgetRuntimeStateStore();
    const runtimeKey = useWidgetRuntimeElementKey(element.id);
    const requested = useWidgetRuntimeStoreValue(store => (isLiveHost ? store.getVideoPlayback(runtimeKey) : undefined));
    // Until a graph has said otherwise, Autoplay is the answer - and Play is the same playback as
    // Autoplay, carried out by the same effect below at the same volume.
    const shouldPlay = isLiveHost ? (requested?.playing ?? videoProps.autoplay) : preview.playing;
    const playVersion = requested?.playVersion ?? 0;
    const seekRequest = requested?.seek ?? null;

    /**
     * Whether this drawing is still on screen. An `ended` the element queued just before the page
     * closed would otherwise reach the graph after the widget is gone - a page change wired to it
     * would then leave whatever page the player had moved to.
     */
    const mountedRef = useRef(false);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    /**
     * The clip played to its end: the widget's Playback Ended, once per time it gets there.
     *
     * Raised from the element's own `ended`, which a looping clip never fires. Read again at the
     * moment it arrives rather than trusted: an `ended` queued just before the source changed lands
     * on an element that has already started loading the next clip and no longer reports `ended`,
     * and it does not belong to that clip.
     */
    const handleLiveEnded = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
        const node = event.currentTarget;
        if (!mountedRef.current || !node.ended || node.loop) {
            return;
        }
        void dispatchEvent("ended", {});
    }, [dispatchEvent]);

    /**
     * Start the element playing. A refusal is said once per request, in the game's log; the graph
     * that asked is not held up or failed by it - Play does not wait for playback - and the clip
     * stays on the frame it shows.
     */
    const sourceUrlRef = useRef(sourceUrl);
    sourceUrlRef.current = sourceUrl;
    const refusalReportedForRef = useRef<string | null>(null);
    const playNodeRef = useRef<(node: HTMLVideoElement, version: number) => void>(() => undefined);
    playNodeRef.current = (node, version) => {
        void playVideoElement(node).then(outcome => {
            const occasion = `${version}\u0000${sourceUrlRef.current ?? ""}`;
            if (outcome !== "refused" || !isLiveHost || !mountedRef.current || refusalReportedForRef.current === occasion) {
                return;
            }
            refusalReportedForRef.current = occasion;
            hostAdapter.blueprintRuntime?.emitDebug({
                type: "devtools.log",
                level: "warning",
                message: translate("widgets.video.playRefused", {
                    name: element.name?.trim() || translate("widgets.video.title"),
                }),
            });
        });
    };

    /**
     * Move the play head where a Seek or Stop asked, once per request, if the element knows how long
     * its clip is - before that there is no end to keep the time inside. Says whether it is done.
     */
    const appliedSeekVersionRef = useRef(0);
    const seekNode = (node: HTMLVideoElement, seek: { seconds: number; version: number }): boolean => {
        if (seek.version === appliedSeekVersionRef.current) {
            return true;
        }
        if (node.readyState < HTMLMediaElement.HAVE_METADATA) {
            return false;
        }
        appliedSeekVersionRef.current = seek.version;
        node.currentTime = clampVideoSeekSeconds(seek.seconds, node.duration);
        return true;
    };

    /**
     * A graph's request, carried out on the element the moment it is made, when there is one: a
     * graph that seeks and then reads the time, or plays and then asks whether the video is playing,
     * reads the answer to its own request. The effects below carry a request out once there is an
     * element or a new clip to carry it out on, and leave one already carried out on this clip alone.
     */
    const carriedPlayRef = useRef<{ version: number; sourceUrl: string | null } | null>(null);
    const carryOutRef = useRef<(playback: UIVideoRuntimePlayback, change: UIVideoRuntimePlaybackChange) => void>(() => undefined);
    carryOutRef.current = (playback, change) => {
        const node = videoRef.current;
        if (!node) {
            return;
        }
        if (change.play) {
            carriedPlayRef.current = { version: playback.playVersion, sourceUrl: sourceUrlRef.current };
            if (playback.playing) {
                playNodeRef.current(node, playback.playVersion);
            } else {
                node.pause();
            }
        }
        if (change.seek && playback.seek) {
            seekNode(node, playback.seek);
        }
    };

    // Where the element is, for the graphs that ask, and requests as they are made.
    useEffect(() => {
        if (!isLiveHost || !runtimeStore) {
            return;
        }
        return runtimeStore.registerVideoPlayer(runtimeKey, {
            read: () => {
                const node = videoRef.current;
                return node ? readVideoElement(node) : UI_VIDEO_PLAYBACK_AT_REST;
            },
            carryOut: (playback, change) => carryOutRef.current(playback, change),
        });
    }, [isLiveHost, runtimeKey, runtimeStore]);

    // Nothing else gives the preview store a lifetime - see `releaseVideoPreviewPlayback`.
    useEffect(() => {
        if (isLiveHost) {
            return;
        }
        return () => releaseVideoPreviewPlayback(element.id);
    }, [element.id, isLiveHost]);

    // A paused canvas still has to show something, so metadata is fetched even when the author asked
    // for `preload="none"` - otherwise the widget is an empty box until the game runs.
    const preload = isLiveHost ? videoProps.preload : "metadata";

    useEffect(() => {
        const node = videoRef.current;
        if (!node) {
            return;
        }
        node.volume = elementVolume;
        node.playbackRate = videoProps.playbackRate;
    }, [elementVolume, videoProps.playbackRate, sourceUrl]);

    useEffect(() => {
        const node = videoRef.current;
        if (!node || isLiveHost) {
            return;
        }
        node.currentTime = 0;
        // Only the generation change is meaningful; the first render must not rewind a live preview.
        // `sourceUrl` is a dependency because there is no `<video>` to rewind until it resolves: a
        // restart clicked while the blob URL was still loading used to be dropped on the floor.
    }, [preview.restartGeneration, isLiveHost, sourceUrl]);

    useEffect(() => {
        const node = videoRef.current;
        if (!node) {
            return;
        }
        const carried = carriedPlayRef.current;
        if (playVersion > 0 && carried && carried.version === playVersion && carried.sourceUrl === sourceUrl) {
            return;
        }
        if (!shouldPlay) {
            node.pause();
            return;
        }
        // Playback can be refused (an unmuted clip with no user gesture). The refusal never reaches
        // the host as an unhandled rejection: the box stays on its frame, and a running game says so
        // in its log. `playVersion` is a dependency so that a second Play is carried out too - after
        // the clip has ended it starts again from the beginning.
        playNodeRef.current(node, playVersion);
    }, [shouldPlay, sourceUrl, playVersion]);

    // A Seek or Stop that arrived before the element knew its clip's length lands once it does.
    useEffect(() => {
        const node = videoRef.current;
        if (!node || !seekRequest || seekNode(node, seekRequest)) {
            return;
        }
        const apply = () => {
            seekNode(node, seekRequest);
        };
        node.addEventListener("loadedmetadata", apply, { once: true });
        return () => node.removeEventListener("loadedmetadata", apply);
        // `seekNode` reads only refs and its arguments.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seekRequest, sourceUrl]);

    return (
        <RectangleChromeRenderer {...props}>
            {/* A poster alone still draws: a clip that has not resolved (or is not set yet) shows
                its still rather than an empty box. */}
            {sourceUrl || posterUrl ? (
                <video
                    ref={videoRef}
                    data-ui-video="true"
                    data-ui-video-asset-id={videoProps.assetId ?? ""}
                    src={sourceUrl ?? undefined}
                    poster={posterUrl ?? undefined}
                    style={{ ...VIDEO_STYLE_BASE, objectFit: videoProps.objectFit }}
                    preload={preload}
                    loop={videoProps.loop}
                    muted={videoProps.muted}
                    controls={videoProps.controls}
                    playsInline
                    // Never `autoPlay`: on the canvas playback is driven by the docker bar, and in a
                    // live host by the effect above, which can also react to a later prop change.
                    autoPlay={false}
                    // The clip can stop without the store being told - it reaches its end with
                    // `loop` off, or the author pauses it with the native control strip - and then
                    // the docker bar offers Pause over a stopped video and replaying takes two
                    // clicks. Reporting back is what keeps the button honest.
                    onEnded={isLiveHost ? handleLiveEnded : () => setVideoPreviewPlaying(element.id, false)}
                    onPause={isLiveHost ? undefined : () => setVideoPreviewPlaying(element.id, false)}
                    onPlay={isLiveHost ? undefined : () => setVideoPreviewPlaying(element.id, true)}
                    onError={() => {
                        if (sourceUrl) {
                            setSourceLoadFailedUrl(sourceUrl);
                        }
                    }}
                />
            ) : null}
        </RectangleChromeRenderer>
    );
}
