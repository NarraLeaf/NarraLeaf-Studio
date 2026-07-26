import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { useTranslation } from "@/lib/i18n";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset } from "@/lib/workspace/services/assets/types";
import { Character } from "@/lib/workspace/services/character/Character";
import { ImagePlus, Layers, Plus, Trash2 } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorComponentProps } from "../../types";
import { LayerStackPreview } from "./components/LayerStackPreview";

type CharacterEditorPayload = { character: Character };

/** Which image slot the asset picker is filling. */
type SlotRef =
    | { kind: "pose"; poseId: string }
    | { kind: "layer"; layerId: string }
    | { kind: "option"; layerId: string; tagId: string };

const ROW = "flex items-center gap-2 rounded-md border border-edge bg-fill-subtle px-2 py-1.5 text-xs";
const ICON_BTN = "p-1 rounded-md text-fg-muted hover:text-fg hover:bg-fill transition-colors";

function Section(props: { title: string; onAdd: () => void; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
                <span className="text-2xs tracking-wide text-fg-muted">{props.title}</span>
                <button className={ICON_BTN} onClick={props.onAdd} title={props.title}>
                    <Plus className="w-4 h-4" />
                </button>
            </div>
            {props.children}
        </div>
    );
}

/**
 * The character appearance editor.
 *
 * One surface, two shapes, because the kind is fixed when the character is created and the two share
 * no data: a preset character is a flat list of finished sprites, a layered one is a stack of layers
 * driven by axes. What both need is the same - name a slot, give it an image - so the row vocabulary
 * is shared and only the tree above it differs.
 *
 * The layered side is deliberately the minimum that lets a stack be built and looked at. The real
 * layer-stack editor (drag reordering, onion skin, canvas and coverage diagnostics) is its own card.
 */
export function CharacterEditor({ payload }: EditorComponentProps<CharacterEditorPayload>) {
    const { t } = useTranslation();
    const character = payload?.character;
    const appearance = character?.profile.appearance;

    // The appearance mutates in place, so a version counter is what re-renders this tree.
    const [version, setVersion] = useState(0);
    useEffect(() => character?.subscribe(() => setVersion(current => current + 1)), [character]);

    const [slot, setSlot] = useState<SlotRef | null>(null);
    const [previewTags, setPreviewTags] = useState<Record<string, string>>({});
    const anchorRef = useRef<HTMLElement | null>(null);
    const anchorMemo = useMemo(() => ({ current: anchorRef.current }), [slot]);

    const kind = appearance?.getKind() ?? "preset";
    const poses = useMemo(() => appearance?.getPoses() ?? [], [appearance, version]);
    const axes = useMemo(() => appearance?.getAxes() ?? [], [appearance, version]);
    const layers = useMemo(() => appearance?.getLayers() ?? [], [appearance, version]);
    // Editor-only: which tag each axis is previewing. Never stored on the character.
    const tags = useMemo(() => appearance?.resolveTagSelection(previewTags) ?? {}, [appearance, previewTags, version]);

    const confirmAsset = useCallback((assets: Asset[]) => {
        const assetId = assets[0]?.id ?? null;
        if (!appearance || !slot) {
            setSlot(null);
            return;
        }
        if (slot.kind === "pose") {
            appearance.setPoseAsset(slot.poseId, assetId);
        } else if (slot.kind === "layer") {
            appearance.setLayerAsset(slot.layerId, assetId);
        } else {
            appearance.setLayerOption(slot.layerId, slot.tagId, assetId);
        }
        setSlot(null);
    }, [appearance, slot]);

    const openSlot = (next: SlotRef, element: HTMLElement | null) => {
        anchorRef.current = element;
        setSlot(next);
    };

    if (!character || !appearance) {
        return null;
    }

    const previewAssetIds = kind === "preset"
        ? [poses.find(pose => pose.id === appearance.getDefaultPoseId())?.assetId ?? null]
        : layers
            .filter(layer => !layer.hidden)
            .map(layer => (layer.axisId ? layer.options?.[tags[layer.axisId] ?? ""] : layer.assetId) ?? null);

    return (
        <div className="h-full bg-surface text-fg flex flex-col">
            <div className="px-4 py-2 border-b border-edge flex items-center gap-2">
                <span className="text-sm font-semibold truncate">
                    {character.profile.getProfile().name || t("characters.editor.header.fallbackName")}
                </span>
                <span className="text-xs text-fg-subtle">
                    {t(kind === "layered" ? "characters.editor.kind.layered" : "characters.editor.kind.preset")}
                </span>
            </div>

            <div className="flex-1 grid grid-cols-[minmax(0,1fr)_360px] overflow-hidden">
                <LayerStackPreview assetIds={previewAssetIds} canvas={appearance.getCanvas()} />

                <div className="border-l border-edge overflow-y-auto p-3 space-y-4">
                    {kind === "preset" ? (
                        <Section
                            title={t("characters.editor.poses")}
                            onAdd={() => appearance.createPose(t("characters.editor.newPose"))}
                        >
                            {poses.map(pose => (
                                <div key={pose.id} className={ROW}>
                                    <span className="min-w-0 flex-1 truncate">{pose.name}</span>
                                    {appearance.getDefaultPoseId() === pose.id && (
                                        <span className="text-2xs text-primary">{t("characters.variantsPanel.default")}</span>
                                    )}
                                    <button
                                        className={ICON_BTN}
                                        title={t("characters.variantsPanel.changeImage")}
                                        onClick={event => openSlot({ kind: "pose", poseId: pose.id }, event.currentTarget)}
                                    >
                                        <ImagePlus className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        className={ICON_BTN}
                                        title={t("characters.editor.removePose")}
                                        onClick={() => appearance.removePose(pose.id)}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                        </Section>
                    ) : (
                        <>
                            <Section
                                title={t("characters.editor.axes")}
                                onAdd={() => appearance.createAxis(t("characters.editor.newAxis"))}
                            >
                                {axes.map(axis => (
                                    <div key={axis.id} className="rounded-md border border-edge bg-fill-subtle p-2 space-y-1.5">
                                        <div className="flex items-center gap-2">
                                            <span className="min-w-0 flex-1 truncate text-xs">{axis.name}</span>
                                            <button
                                                className={ICON_BTN}
                                                title={t("characters.editor.newTag")}
                                                onClick={() => appearance.createTag(axis.id, t("characters.editor.newTag"))}
                                            >
                                                <Plus className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                className={ICON_BTN}
                                                title={t("characters.editor.removeAxis")}
                                                onClick={() => appearance.removeAxis(axis.id)}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            {axis.tags.map(tag => (
                                                <button
                                                    key={tag.id}
                                                    className={[
                                                        "rounded-md border px-2 py-0.5 text-2xs transition-colors",
                                                        tags[axis.id] === tag.id
                                                            ? "border-primary/60 bg-primary/15"
                                                            : "border-edge hover:bg-fill",
                                                    ].join(" ")}
                                                    onClick={() => setPreviewTags(current => ({ ...current, [axis.id]: tag.id }))}
                                                >
                                                    {tag.name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </Section>

                            <Section
                                title={t("characters.editor.layers")}
                                onAdd={() => appearance.createLayer(t("characters.editor.newLayer"))}
                            >
                                {/* Reversed: the top of the stack reads at the top of the list, the way
                                    the art does, while the stored order stays bottom-first. */}
                                {[...layers].reverse().map(layer => (
                                    <div key={layer.id} className="rounded-md border border-edge bg-fill-subtle p-2 space-y-1.5">
                                        <div className="flex items-center gap-2">
                                            <Layers className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
                                            <span className="min-w-0 flex-1 truncate text-xs">{layer.name}</span>
                                            <select
                                                className="bg-surface border border-edge rounded-md text-2xs px-1 py-0.5"
                                                value={layer.axisId ?? ""}
                                                onChange={event => appearance.setLayerAxis(layer.id, event.target.value || null)}
                                            >
                                                <option value="">{t("characters.editor.constantLayer")}</option>
                                                {axes.map(axis => (
                                                    <option key={axis.id} value={axis.id}>{axis.name}</option>
                                                ))}
                                            </select>
                                            <button
                                                className={ICON_BTN}
                                                title={t("characters.editor.removeLayer")}
                                                onClick={() => appearance.removeLayer(layer.id)}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                        {layer.axisId ? (
                                            <div className="space-y-1 pl-5">
                                                {(appearance.getAxis(layer.axisId)?.tags ?? []).map(tag => (
                                                    <div key={tag.id} className="flex items-center gap-2 text-2xs">
                                                        <span className="min-w-0 flex-1 truncate text-fg-muted">{tag.name}</span>
                                                        <span className="text-fg-subtle">
                                                            {layer.options?.[tag.id]
                                                                ? t("characters.editor.hasImage")
                                                                : t("characters.editor.drawsNothing")}
                                                        </span>
                                                        <button
                                                            className={ICON_BTN}
                                                            title={t("characters.variantsPanel.changeImage")}
                                                            onClick={event => openSlot({ kind: "option", layerId: layer.id, tagId: tag.id }, event.currentTarget)}
                                                        >
                                                            <ImagePlus className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2 pl-5 text-2xs">
                                                <span className="min-w-0 flex-1 truncate text-fg-subtle">
                                                    {layer.assetId ? t("characters.editor.hasImage") : t("characters.editor.noImage")}
                                                </span>
                                                <button
                                                    className={ICON_BTN}
                                                    title={t("characters.variantsPanel.changeImage")}
                                                    onClick={event => openSlot({ kind: "layer", layerId: layer.id }, event.currentTarget)}
                                                >
                                                    <ImagePlus className="w-3 h-3" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </Section>
                        </>
                    )}
                </div>
            </div>

            <AssetSelector
                visible={slot !== null}
                assetType={AssetType.Image}
                selectedIds={[]}
                onClose={() => setSlot(null)}
                onConfirm={confirmAsset}
                anchorRef={anchorMemo}
                title={t("characters.editor.selectVariantImage")}
                multiple={false}
            />
        </div>
    );
}
