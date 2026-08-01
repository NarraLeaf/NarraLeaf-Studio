import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Film, Image as ImageIcon } from "lucide-react";
import type { UIVideoObjectFit, UIVideoPreload, UIVideoWidgetProps } from "@shared/types/ui-editor/video";
import type { ColorValue, CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { useWorkspace } from "@/apps/workspace/context";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services } from "@/lib/workspace/services/services";
import type { AudioTrackService } from "@/lib/workspace/services/audio/AudioTrackService";
import { BUILTIN_AUDIO_TRACKS } from "@shared/types/audioTrack";
import { Select } from "@/lib/components/elements/Select";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import { getRectangleLikeProps } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import type { InspectorContext, UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { i18nStore, useTranslation } from "@/lib/i18n";
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
 * One asset row, used for both the clip and the poster.
 *
 * Single-select only: `AssetSelector`'s multiple mode has never actually worked, and a picker that
 * silently keeps only the first pick is worse than one that never offers the choice.
 */
function AssetRow({
    label,
    emptyLabel,
    chooseLabel,
    icon: Icon,
    assetType,
    assetId,
    onChange,
}: {
    label: string;
    emptyLabel: string;
    chooseLabel: string;
    icon: typeof Film;
    assetType: AssetType;
    assetId: string | null;
    onChange: (next: string | null) => void;
}) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const assetsService = useMemo(
        () => (context ? context.services.get<AssetsService>(Services.Assets) : null),
        [context],
    );
    const [selectorOpen, setSelectorOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);

    const assetName = useMemo(() => {
        if (!assetId || !assetsService) {
            return null;
        }
        return assetsService.getAssets()[assetType]?.[assetId]?.name ?? null;
    }, [assetId, assetsService, assetType]);

    /**
     * An id with no library record is a broken reference, not an empty slot - saying "None" there
     * would hide the very thing `resourceDiagnostics` is warning about.
     */
    const valueLabel = assetId
        ? assetName ?? t("widgets.video.assetMissing", { id: assetId })
        : emptyLabel;

    const handleConfirm = useCallback((assets: Asset[]) => {
        const selected = assets[0];
        if (!selected) {
            return;
        }
        onChange(selected.id);
        setSelectorOpen(false);
    }, [onChange]);

    const handleClear = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onChange(null);
    }, [onChange]);

    return (
        <>
            <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-fg-muted">{label}</span>
                <button
                    type="button"
                    ref={triggerRef}
                    onClick={() => setSelectorOpen(true)}
                    className="flex w-full items-center gap-2 rounded-md border border-edge bg-surface px-2 py-1.5 text-left text-xs text-fg focus:outline-none focus:ring-1 focus:ring-primary/40"
                >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                    <span className="min-w-0 flex-1 truncate">{valueLabel}</span>
                    {assetId ? (
                        <span
                            role="button"
                            tabIndex={-1}
                            onClick={handleClear as unknown as (event: MouseEvent<HTMLSpanElement>) => void}
                            className="shrink-0 rounded px-1.5 py-0.5 text-2xs tracking-wider text-fg-subtle hover:bg-fill hover:text-fg-muted"
                        >
                            {t("common.clear")}
                        </span>
                    ) : (
                        <span className="shrink-0 text-2xs tracking-wider text-fg-subtle">{chooseLabel}</span>
                    )}
                </button>
            </div>

            <AssetSelector
                visible={selectorOpen}
                assetType={assetType}
                multiple={false}
                selectedIds={assetId ? [assetId] : []}
                anchorRef={triggerRef}
                title={chooseLabel}
                onClose={() => setSelectorOpen(false)}
                onConfirm={handleConfirm}
            />
        </>
    );
}

/**
 * Which project audio track the clip's sound lands on.
 *
 * A custom field rather than a `select` with static options because the list is project data an
 * author can add to: an "Ambience" track created on the project Audio surface has to appear here
 * without the schema being rebuilt. Falls back to the built-in ids when there is no service to ask
 * (a component canvas outside a workspace), so the control is never empty and never dead.
 */
function VideoAudioTrackField(props: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const [revision, setRevision] = useState(0);
    const trackService = useMemo(
        () => (context ? context.services.get<AudioTrackService>(Services.AudioTracks) : null),
        [context],
    );

    useEffect(() => trackService?.onTracksChanged(() => setRevision(value => value + 1)), [trackService]);

    const tracks = useMemo(
        () => trackService?.listTracks() ?? [...BUILTIN_AUDIO_TRACKS],
        // `revision` is the subscription's only job: the service mutates its list in place.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [trackService, revision],
    );

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
            <AssetRow
                label={t("widgets.video.asset")}
                emptyLabel={t("widgets.video.assetNone")}
                chooseLabel={t("widgets.video.assetChoose")}
                icon={Film}
                assetType={AssetType.Video}
                assetId={current.assetId}
                onChange={next => patchVideo(props.data, { assetId: next })}
            />
            <AssetRow
                label={t("widgets.video.poster")}
                emptyLabel={t("widgets.video.posterNone")}
                chooseLabel={t("widgets.video.posterChoose")}
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
                                type: "checkbox",
                                label: t("widgets.video.autoplay"),
                                helpText: t("widgets.video.autoplayHint"),
                                getValue: (d: D) => getLiveVideoProps(d).autoplay,
                                setValue: (d: D, value: boolean) => patchVideo(d, { autoplay: value }),
                            }),
                            defineField<D, any>({
                                id: "video.loop",
                                type: "checkbox",
                                label: t("widgets.video.loop"),
                                getValue: (d: D) => getLiveVideoProps(d).loop,
                                setValue: (d: D, value: boolean) => patchVideo(d, { loop: value }),
                            }),
                            defineField<D, any>({
                                id: "video.muted",
                                type: "checkbox",
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
                                type: "checkbox",
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
                     * this widget yet (see the plan's phase 2).
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
                                getValue: (d: D) => ({ hex: getLiveChromeProps(d).backgroundColor }),
                                setValue: (d: D, value: ColorValue) =>
                                    patchChrome(d, {
                                        backgroundColor: value.hex,
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
                                getValue: (d: D) => ({ hex: getLiveChromeProps(d).borderColor }),
                                setValue: (d: D, value: ColorValue) =>
                                    patchChrome(d, { borderColor: value.hex, strokeVisible: true }),
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
