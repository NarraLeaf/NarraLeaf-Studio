import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { RectangleChromeRenderer } from "@/lib/ui-editor/widget-modules/shared/chrome/RectangleChromeRenderer";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import {
    getVideoPreviewRestartGeneration,
    isVideoPreviewPlaying,
    subscribeVideoPreviewPlayback,
} from "@/lib/ui-editor/interaction/videoPreviewPlayback";
import { getVideoProps } from "./helpers";

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
    const { element, hostAdapter } = props;
    const videoProps = getVideoProps(element);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    /**
     * `blueprintRuntime` is what tells the two hosts apart: the packaged game and Dev Mode install
     * one, the editor canvas never does. This is the same signal `slider/renderer.tsx` uses to
     * decide whether dragging the handle may run an author's graph.
     */
    const isLiveHost = Boolean(hostAdapter.blueprintRuntime);

    // Pool names as bare strings, not `AssetType.*`: the enum lives in a workspace service module
    // the game-runtime bundle is not allowed to import (see `build-runtime.js`).
    const { url: sourceUrl } = useAssetObjectUrl(videoProps.assetId, "video");
    const { url: posterUrl } = useAssetObjectUrl(videoProps.posterAssetId, "image");

    const preview = useVideoPreviewState(element.id, !isLiveHost);
    const shouldPlay = isLiveHost ? videoProps.autoplay : preview.playing;

    // A paused canvas still has to show something, so metadata is fetched even when the author asked
    // for `preload="none"` - otherwise the widget is an empty box until the game runs.
    const preload = isLiveHost ? videoProps.preload : "metadata";

    useEffect(() => {
        const node = videoRef.current;
        if (!node) {
            return;
        }
        node.volume = videoProps.volume;
        node.playbackRate = videoProps.playbackRate;
    }, [videoProps.volume, videoProps.playbackRate, sourceUrl]);

    useEffect(() => {
        const node = videoRef.current;
        if (!node || isLiveHost) {
            return;
        }
        node.currentTime = 0;
        // Only the generation change is meaningful; the first render must not rewind a live preview.
    }, [preview.restartGeneration, isLiveHost]);

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
                />
            ) : null}
        </RectangleChromeRenderer>
    );
}
