import { Film, Image as ImageIcon } from "lucide-react";
import type { UIVideoObjectFit, UIVideoPreload, UIVideoWidgetProps } from "@shared/types/ui-editor/video";
import type { ColorValue, CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import { parseColorValue, serializeColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Select } from "@/lib/components/elements/Select";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import { getRectangleLikeProps } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import type { InspectorContext, UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { i18nStore, useTranslation } from "@/lib/i18n";
import { AssetPickerRow } from "@/lib/ui-editor/widget-modules/shared/assets/AssetPickerRow";
import { useProjectAudioTracks } from "@/lib/ui-editor/widget-modules/shared/sound/useProjectAudioTracks";
import { getVideoProps, patchVideoProps } from "./helpers";

/** Always read through the live document: a schema closure can outlive the props it captured. */
function liveElement(data: UIInspectorData) {
    return data.documentService.getDocument().elements[data.element.id] ?? data.element;
}

function getLiveVideoProps(data: UIInspectorData): UIVideoWidgetProps {
    return getVideoProps(liveElement(data));
}

function patchVideo(data: UIInspectorData, partial: Partial<UIVideoWidgetProps>): void {
    const live = liveElement(data);
    data.documentService.updateElementProps(live.id, patchVideoProps(live, partial));
}

function getLiveChromeProps(data: UIInspectorData): RectangleLikeProps {
    return getRectangleLikeProps(liveElement(data));
}

function patchChrome(data: UIInspectorData, partial: Partial<RectangleLikeProps>): void {
    const live = liveElement(data);
    data.documentService.updateElementProps(live.id, {
        ...(live.props ?? {}),
        ...partial,
    });
}

/**
 * Which project audio track the clip's sound lands on.
 *
 * A custom field rather than a `select` with static options because the list is project data an
 * author can add to (`useProjectAudioTracks`), and has to stay current without the schema being
 * rebuilt.
 */
function VideoAudioTrackField(props: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const tracks = useProjectAudioTracks();
    const current = getLiveVideoProps(props.data);
    return (
        <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-muted">{t("widgets.video.audioTrack")}</span>
            <Select
                size="sm"
                fullWidth
                value={current.audioTrackId ?? ""}
                options={tracks.map(track => ({ value: track.id, label: track.name }))}
                placeholder={t("widgets.video.audioTrackDefault")}
                onChange={value => patchVideo(props.data, { audioTrackId: value ? String(value) : null })}
            />
        </div>
    );
}

function VideoSourceField(props: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const current = getLiveVideoProps(props.data);
    return (
        <div className="flex flex-col gap-2">
            <AssetPickerRow
                label={t("widgets.video.asset")}
                emptyLabel={t("widgets.video.assetNone")}
                chooseLabel={t("widgets.video.assetChoose")}
                missingLabel={t("widgets.video.assetMissing")}
                icon={Film}
                assetType={AssetType.Video}
                assetId={current.assetId}
                onChange={next => patchVideo(props.data, { assetId: next })}
            />
            <AssetPickerRow
                label={t("widgets.video.poster")}
                emptyLabel={t("widgets.video.posterNone")}
                chooseLabel={t("widgets.video.posterChoose")}
                missingLabel={t("widgets.video.assetMissing")}
                icon={ImageIcon}
                assetType={AssetType.Image}
                assetId={current.posterAssetId}
                onChange={next => patchVideo(props.data, { posterAssetId: next })}
            />
        </div>
    );
}

export function createVideoInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { t } = i18nStore.getTranslator();
    const { element } = ctx;

    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.video:${element.id}`,
        title: element.name ?? t("widgets.video.title"),
        fields: [],
        tabs: [
            {
                id: "properties",
                title: t("widgets.tabs.properties"),
                fields: [
                    defineField<D, any>({
                        id: "section.videoSource",
                        type: "section",
                        title: t("widgets.video.sectionSource"),
                        fields: [
                            defineField<D, any>({
                                id: "video.source",
                                type: "custom",
                                component: VideoSourceField,
                            }),
                            defineField<D, any>({
                                id: "video.objectFit",
                                type: "select",
                                label: t("widgets.video.fit"),
                                helpText: t("widgets.video.fitHint"),
                                options: [
                                    { value: "contain", label: t("widgetChrome.dockerItems.contain") },
                                    { value: "cover", label: t("widgetChrome.dockerItems.cover") },
                                    { value: "fill", label: t("widgetChrome.dockerItems.stretch") },
                                    { value: "none", label: t("widgets.video.fitNone") },
                                ],
                                getValue: (d: D) => getLiveVideoProps(d).objectFit,
                                setValue: (d: D, value: string | number) =>
                                    patchVideo(d, { objectFit: String(value) as UIVideoObjectFit }),
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.videoPlayback",
                        type: "section",
                        title: t("widgets.video.sectionPlayback"),
                        fields: [
                            defineField<D, any>({
                                id: "video.autoplay",
                                type: "toggle",
                                label: t("widgets.video.autoplay"),
                                helpText: t("widgets.video.autoplayHint"),
                                getValue: (d: D) => getLiveVideoProps(d).autoplay,
                                setValue: (d: D, value: boolean) => patchVideo(d, { autoplay: value }),
                            }),
                            defineField<D, any>({
                                id: "video.loop",
                                type: "toggle",
                                label: t("widgets.video.loop"),
                                getValue: (d: D) => getLiveVideoProps(d).loop,
                                setValue: (d: D, value: boolean) => patchVideo(d, { loop: value }),
                            }),
                            defineField<D, any>({
                                id: "video.muted",
                                type: "toggle",
                                label: t("widgets.video.muted"),
                                getValue: (d: D) => getLiveVideoProps(d).muted,
                                setValue: (d: D, value: boolean) => patchVideo(d, { muted: value }),
                            }),
                            defineField<D, any>({
                                id: "video.volume",
                                type: "number",
                                label: t("widgets.video.volume"),
                                helpText: t("widgets.video.volumeHint"),
                                min: 0,
                                max: 1,
                                step: 0.05,
                                decimalPlaces: 2,
                                getValue: (d: D) => getLiveVideoProps(d).volume,
                                setValue: (d: D, value: number) => patchVideo(d, { volume: value }),
                            }),
                            defineField<D, any>({
                                id: "video.audioTrack",
                                type: "custom",
                                component: VideoAudioTrackField,
                            }),
                            defineField<D, any>({
                                id: "video.playbackRate",
                                type: "number",
                                label: t("widgets.video.playbackRate"),
                                min: 0.0625,
                                max: 16,
                                step: 0.25,
                                decimalPlaces: 2,
                                getValue: (d: D) => getLiveVideoProps(d).playbackRate,
                                setValue: (d: D, value: number) => patchVideo(d, { playbackRate: value }),
                            }),
                            defineField<D, any>({
                                id: "video.controls",
                                type: "toggle",
                                label: t("widgets.video.controls"),
                                helpText: t("widgets.video.controlsHint"),
                                getValue: (d: D) => getLiveVideoProps(d).controls,
                                setValue: (d: D, value: boolean) => patchVideo(d, { controls: value }),
                            }),
                            defineField<D, any>({
                                id: "video.preload",
                                type: "select",
                                label: t("widgets.video.preload"),
                                helpText: t("widgets.video.preloadHint"),
                                options: [
                                    { value: "none", label: t("widgets.video.preloadNone") },
                                    { value: "metadata", label: t("widgets.video.preloadMetadata") },
                                    { value: "auto", label: t("widgets.video.preloadAuto") },
                                ],
                                getValue: (d: D) => getLiveVideoProps(d).preload,
                                setValue: (d: D, value: string | number) =>
                                    patchVideo(d, { preload: String(value) as UIVideoPreload }),
                            }),
                        ],
                    }),
                    /**
                     * The widget paints through `RectangleChromeRenderer`, so these are the same flat
                     * chrome props every other rectangle-like widget stores. Kept to the four the
                     * chrome actually reads for a video box - there is no appearance-variant model on
                     * this widget yet.
                     */
                    defineField<D, any>({
                        id: "section.videoBox",
                        type: "section",
                        title: t("widgets.video.sectionBox"),
                        collapsible: true,
                        defaultCollapsed: true,
                        fields: [
                            defineField<D, any>({
                                id: "video.backgroundColor",
                                type: "colorPicker",
                                label: t("widgets.video.backdrop"),
                                helpText: t("widgets.video.backdropHint"),
                                displayMode: "icon-hex",
                                allowOpacity: false,
                                brandPalette: true,
                                getValue: (d: D) => parseColorValue(getLiveChromeProps(d).backgroundColor, { hex: "#FFFFFF", alpha: 1 }),
                                setValue: (d: D, value: ColorValue) =>
                                    patchChrome(d, {
                                        backgroundColor: serializeColorValue(value),
                                        fillType: "color",
                                        fillVisible: true,
                                    }),
                            }),
                            defineField<D, any>({
                                id: "video.borderRadius",
                                type: "number",
                                label: t("widgets.rectangleInspector.cornerRadius"),
                                min: 0,
                                step: 1,
                                getValue: (d: D) => getLiveChromeProps(d).borderRadius,
                                setValue: (d: D, value: number) => {
                                    const current = getLiveChromeProps(d);
                                    const radius = Math.max(0, value);
                                    patchChrome(d, current.borderRadiusLinked
                                        ? {
                                            borderRadius: radius,
                                            borderRadiusTL: radius,
                                            borderRadiusTR: radius,
                                            borderRadiusBL: radius,
                                            borderRadiusBR: radius,
                                        }
                                        : { borderRadius: radius });
                                },
                            }),
                            defineField<D, any>({
                                id: "video.borderWidth",
                                type: "number",
                                label: t("widgets.rectangleInspector.border"),
                                min: 0,
                                step: 1,
                                getValue: (d: D) => getLiveChromeProps(d).borderWidth,
                                setValue: (d: D, value: number) =>
                                    patchChrome(d, { borderWidth: Math.max(0, value) }),
                            }),
                            defineField<D, any>({
                                id: "video.borderColor",
                                type: "colorPicker",
                                label: t("widgets.rectangleInspector.borderStyle"),
                                displayMode: "icon-hex",
                                allowOpacity: false,
                                brandPalette: true,
                                getValue: (d: D) => parseColorValue(getLiveChromeProps(d).borderColor, { hex: "#FFFFFF", alpha: 1 }),
                                setValue: (d: D, value: ColorValue) =>
                                    patchChrome(d, { borderColor: serializeColorValue(value), strokeVisible: true }),
                            }),
                        ],
                    }),
                ],
            },
            {
                id: "interaction",
                title: t("widgets.tabs.interaction"),
                fields: [
                    defineField<D, any>({
                        id: "interaction.blueprint.readonly",
                        type: "custom",
                        label: t("widgets.blueprint.controlLabel"),
                        component: ReadonlyBlueprintSection,
                    }),
                ],
            },
        ],
    });
}
