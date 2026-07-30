import { Pause, Play, SkipBack } from "lucide-react";
import type { UIVideoObjectFit } from "@shared/types/ui-editor/video";
import { translate } from "@/lib/i18n";
import type { DockerBarContext, DockerBarItem } from "@/lib/ui-editor/widget-modules/types";
import { createRectangleDockerBarItems } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleDockerBar";
import {
    isVideoPreviewPlaying,
    requestVideoPreviewRestart,
    toggleVideoPreviewPlaying,
} from "@/lib/ui-editor/interaction/videoPreviewPlayback";
import { getVideoProps, patchVideoProps } from "./helpers";

const FIT_OPTION_VALUES: readonly UIVideoObjectFit[] = ["contain", "cover", "fill", "none"];

const FIT_OPTION_LABEL_KEYS = {
    contain: "widgetChrome.dockerItems.contain",
    cover: "widgetChrome.dockerItems.cover",
    fill: "widgetChrome.dockerItems.stretch",
    none: "widgets.video.fitNone",
} as const;

/**
 * Fit + a preview transport, then the shared chrome items (radius / border).
 *
 * The transport is editor-only and writes no document data, so it is absent from the multi-select
 * bar: "play these four videos" is not a thing the canvas should offer, and the toggle's icon could
 * not honestly represent four independent states anyway.
 *
 * Asset selection is not here. `DockerBarItem` has no popup-capable kind and `DockerBarContext`
 * carries no assets service, so a picker cannot be expressed as a docker item - `nl.image` puts its
 * asset in the inspector for the same reason, and `nl.video` follows it.
 */
export function createVideoDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
    const { element, documentService } = ctx;
    const props = getVideoProps(element);
    const playing = isVideoPreviewPlaying(element.id);

    return [
        {
            kind: "select",
            id: "docker-video-object-fit",
            label: translate("widgetChrome.dockerItems.fit"),
            tooltip: translate("widgets.video.fitHint"),
            value: props.objectFit,
            options: FIT_OPTION_VALUES.map(value => ({
                value,
                label: translate(FIT_OPTION_LABEL_KEYS[value]),
            })),
            onChange: (value: string | number) => {
                const objectFit = FIT_OPTION_VALUES.find(option => option === value);
                if (!objectFit) {
                    return;
                }
                const live = documentService.getDocument().elements[element.id] ?? element;
                documentService.updateElementProps(live.id, patchVideoProps(live, { objectFit }));
            },
        },
        {
            kind: "separator",
            id: "docker-video-sep-fit",
        },
        {
            kind: "button",
            id: "docker-video-preview-toggle",
            icon: playing ? Pause : Play,
            tooltip: playing
                ? translate("widgets.video.previewPause")
                : translate("widgets.video.previewPlay"),
            active: playing,
            // Nothing to preview without a source; a toggle that flips to "playing" over an empty
            // box would just be lying about what the canvas is doing.
            disabled: !props.assetId,
            onClick: () => {
                toggleVideoPreviewPlaying(element.id);
            },
        },
        {
            kind: "button",
            id: "docker-video-preview-restart",
            icon: SkipBack,
            tooltip: translate("widgets.video.previewRestart"),
            disabled: !props.assetId,
            onClick: () => {
                requestVideoPreviewRestart(element.id);
            },
        },
        {
            kind: "separator",
            id: "docker-video-sep-preview",
        },
        ...createRectangleDockerBarItems(ctx),
    ];
}

/** Multi-select keeps only what is document data: fit and the shared chrome items. */
export function createVideoMultiSelectDockerBarItems(ctx: DockerBarContext): DockerBarItem[] {
    return createVideoDockerBarItems(ctx).filter(
        item => !item.id.startsWith("docker-video-preview"),
    );
}
