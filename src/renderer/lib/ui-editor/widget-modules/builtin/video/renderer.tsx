import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
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
    const shouldPlay = isLiveHost ? videoProps.autoplay : preview.playing;

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
        if (!shouldPlay) {
            node.pause();
            return;
        }
        // Autoplay can be refused (an unmuted clip with no user gesture). Swallowing the rejection
        // keeps the box on its first frame instead of throwing an unhandled rejection into the host.
        void node.play().catch(() => undefined);
    }, [shouldPlay, sourceUrl]);

    return (
        <RectangleChromeRenderer {...props}>
            {sourceUrl ? (
                <video
                    ref={videoRef}
                    data-ui-video="true"
                    data-ui-video-asset-id={videoProps.assetId ?? ""}
                    src={sourceUrl}
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
                    onEnded={isLiveHost ? undefined : () => setVideoPreviewPlaying(element.id, false)}
                    onPause={isLiveHost ? undefined : () => setVideoPreviewPlaying(element.id, false)}
                    onPlay={isLiveHost ? undefined : () => setVideoPreviewPlaying(element.id, true)}
                    onError={() => setSourceLoadFailedUrl(sourceUrl)}
                />
            ) : null}
        </RectangleChromeRenderer>
    );
}
