import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { createInputDialog } from "@/lib/components/dialogs";
import { useTranslation } from "@/lib/i18n";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset } from "@/lib/workspace/services/assets/types";
import { Character } from "@/lib/workspace/services/character/Character";
import {
    collectCharacterDiagnostics,
    type CharacterDiagnostic,
    type LayerSize,
} from "@/lib/workspace/services/character/characterDiagnostics";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { getSpriteCompositor } from "@/lib/workspace/hooks/useCompositedSprite";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import {
    AlertTriangle,
    Bookmark,
    Crop,
    Eye,
    EyeOff,
    FileImage,
    Grid3x3,
    ImagePlus,
    Layers,
    Lock,
    Pencil,
    Plus,
    Trash2,
    Unlock,
    UserRound,
    XCircle,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { EditorComponentProps } from "../../types";
import { LayerStackPreview, type PreviewLayer } from "./components/LayerStackPreview";
import { CombinationGrid } from "./components/CombinationGrid";
import { PsdImportWizard } from "./components/PsdImportWizard";
import { PuppetEditor } from "./components/PuppetEditor";
import { combinationKey, enumerateCombinations } from "@/lib/workspace/services/character/characterCombinations";
import { characterAvatarAxisIds, characterAvatarKey } from "@shared/utils/characterAvatar";

type CharacterEditorPayload = { character: Character };

/** Which image slot the asset picker is filling. */
type SlotRef =
    | { kind: "pose"; poseId: string }
    | { kind: "layer"; layerId: string }
    | { kind: "option"; layerId: string; tagId: string }
    /** A differential's dialog avatar, keyed the way the baker keys it. */
    | { kind: "avatar"; avatarKey: string };

/** What the author has selected, which is also what a diagnostic row jumps to. */
type Focus = { kind: "layer" | "axis"; id: string } | null;

const ROW = "flex items-center gap-2 rounded-md border border-edge bg-fill-subtle px-2 py-1.5 text-xs";
const ICON_BTN = "p-1 rounded-md text-fg-muted hover:text-fg hover:bg-fill transition-colors disabled:cursor-not-allowed disabled:opacity-40";
/** Same button, lit. Not `ICON_BTN + " text-primary"`: two colour utilities in one class list are
    decided by stylesheet order, not by the order they are written, so the muted one can win. */
const ICON_BTN_ON = "p-1 rounded-md text-primary hover:bg-fill transition-colors";
const CARD = "rounded-md border bg-fill-subtle p-2 space-y-1.5";
const FOCUSED = "border-primary/60";

/** Written out rather than interpolated so the keys stay statically checkable against the catalogue. */
const KIND_LABELS = {
    preset: "characters.editor.kind.preset",
    layered: "characters.editor.kind.layered",
    puppet: "characters.editor.kind.puppet",
} as const;

function Section(props: { title: string; onAdd: () => void; children: React.ReactNode }) {
    // The one "+" every appearance section shares - poses, axes, layers, snapshots - so guarding it here
    // covers all four creation flows at once. Its `onAdd` always writes the appearance.
    const freeze = useFreezeGuard();
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
                <span className="text-2xs tracking-wide text-fg-muted">{props.title}</span>
                <button className={ICON_BTN} onClick={props.onAdd} aria-label={props.title} {...freeze.writes()}>
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
 * One surface, three shapes, because the kind is fixed when the character is created and the kinds
 * share no data: a preset character is a flat list of finished sprites, a layered one is a stack of
 * layers driven by axes, and a puppet is a box an author-supplied runtime draws. The first two need
 * the same thing - name a slot, give it an image - so the row vocabulary is shared and only the tree
 * above it differs; the puppet has no images at all and gets its own inspector.
 *
 * Two pieces of state deliberately live here rather than on the character: which layers are hidden
 * and which are locked. Hiding a layer to see the one under it must not change what ships, so it
 * cannot be persisted - `toLayeredDefinition` never learns about it.
 */
export function CharacterEditor({ payload }: EditorComponentProps<CharacterEditorPayload>) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    // Reordering the layer stack writes the appearance; hiding and locking a layer are editor state and
    // stay live, which is why they are not guarded here.
    const freeze = useFreezeGuard();
    const character = payload?.character;
    const appearance = character?.profile.appearance;

    const inputDialog = useMemo(() => {
        const ui = context?.services.get<UIService>(Services.UI);
        return ui ? createInputDialog(ui) : null;
    }, [context]);

    // The appearance mutates in place, so a version counter is what re-renders this tree.
    const [version, setVersion] = useState(0);
    useEffect(() => character?.subscribe(() => setVersion(current => current + 1)), [character]);

    const [slot, setSlot] = useState<SlotRef | null>(null);
    const [previewTags, setPreviewTags] = useState<Record<string, string>>({});
    const [hidden, setHidden] = useState<Record<string, boolean>>({});
    const [locked, setLocked] = useState<Record<string, boolean>>({});
    const [sizes, setSizes] = useState<Record<string, LayerSize>>({});
    const [onionAxisId, setOnionAxisId] = useState<string | null>(null);
    const [focus, setFocus] = useState<Focus>(null);
    const [dragLayerId, setDragLayerId] = useState<string | null>(null);
    const [occluded, setOccluded] = useState<Record<string, boolean>>({});
    const [grid, setGrid] = useState(false);
    const [psdOpen, setPsdOpen] = useState(false);
    const dragRef = useRef<string | null>(null);
    const anchorRef = useRef<HTMLElement | null>(null);
    const anchorMemo = useMemo(() => ({ current: anchorRef.current }), [slot]);

    const kind = appearance?.getKind() ?? "preset";
    const poses = useMemo(() => appearance?.getPoses() ?? [], [appearance, version]);
    const axes = useMemo(() => appearance?.getAxes() ?? [], [appearance, version]);
    const layers = useMemo(() => appearance?.getLayers() ?? [], [appearance, version]);
    // Editor-only: which tag each axis is previewing. Never stored on the character.
    const tags = useMemo(() => appearance?.resolveTagSelection(previewTags) ?? {}, [appearance, previewTags, version]);

    // "Completely covered by the layers above it" is an alpha question, so it runs off the same
    // offscreen pass the compositor uses rather than off anything the DOM can tell us.
    const drawList = appearance && kind === "layered" ? appearance.resolveDrawList({ tags: previewTags }) : [];
    const drawKey = drawList.join(",");
    useEffect(() => {
        const assetsService = context?.services.get<AssetsService>(Services.Assets);
        if (!assetsService || drawList.filter(Boolean).length < 2) {
            setOccluded({});
            return;
        }
        let cancelled = false;
        void getSpriteCompositor(assetsService).occlusion(drawList).then(flags => {
            if (cancelled || !appearance) return;
            const ids = appearance.getLayers();
            setOccluded(Object.fromEntries(flags.map((covered, index) => [ids[index]?.id ?? "", covered])));
        }).catch(() => { if (!cancelled) setOccluded({}); });
        return () => { cancelled = true; };
    }, [context, drawKey, version]);

    const onMeasured = useCallback((layerId: string, size: LayerSize) => {
        setSizes(current => (
            current[layerId]?.width === size.width && current[layerId]?.height === size.height
                ? current
                : { ...current, [layerId]: size }
        ));
    }, []);

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
        } else if (slot.kind === "avatar") {
            // Clearing the override hands the differential back to the baker, so the bake
            // field is dropped with it - the next reconcile renders one.
            appearance.setAvatar(slot.avatarKey, assetId ? { overrideAssetId: assetId } : null);
        } else {
            appearance.setLayerOption(slot.layerId, slot.tagId, assetId);
        }
        setSlot(null);
    }, [appearance, slot]);

    /**
     * Which axes the avatar varies with. An empty declaration means every axis, so the toggle
     * writes the *effective* set out on the first narrowing rather than starting from nothing -
     * otherwise turning one axis off would read as turning every other one off at the same time.
     */
    const avatarAxisIds = useMemo(
        () => (appearance && kind === "layered"
            // Asked of the shared rule rather than re-derived here, so the editor and the baker
            // cannot disagree about what "no declaration" means.
            ? characterAvatarAxisIds({
                kind: "layered",
                canvas: null,
                layers: [],
                axes: appearance.getAxes(),
                avatarAxisIds: appearance.getAvatarAxisIds(),
            })
            : []),
        [appearance, kind, version],
    );

    /**
     * The avatar key a look maps to. Several looks can map to one key: a combination varies on
     * every axis, while its avatar is keyed only on the avatar axes, so two looks that differ only
     * in an outfit share an avatar - which is the point of narrowing the axes in the first place.
     */
    const avatarKeyOf = useCallback((selection: Record<string, string>): string | null => {
        if (!appearance || kind !== "layered") return null;
        return characterAvatarKey({
            kind: "layered",
            canvas: null,
            layers: [],
            axes: appearance.getAxes(),
            avatarAxisIds: appearance.getAvatarAxisIds(),
        }, { tags: selection });
    }, [appearance, kind, version]);

    const overriddenAvatarKeys = useMemo(
        () => new Set(Object.entries(appearance?.getAvatars() ?? {})
            .filter(([, entry]) => entry.overrideAssetId)
            .map(([key]) => key)),
        [appearance, version],
    );

    const toggleAvatarAxis = useCallback((axisId: string) => {
        if (!appearance) return;
        const next = avatarAxisIds.includes(axisId)
            ? avatarAxisIds.filter(id => id !== axisId)
            : [...avatarAxisIds, axisId];
        // Every axis back on is the default, which is stored as no declaration at all.
        appearance.setAvatarAxisIds(next.length === appearance.getAxes().length ? null : next);
    }, [appearance, avatarAxisIds]);

    const openSlot = (next: SlotRef, element: HTMLElement | null) => {
        anchorRef.current = element;
        setSlot(next);
    };

    const combinationSet = useMemo(
        () => (appearance && kind === "layered"
            ? enumerateCombinations(appearance)
            : { combinations: [], total: 0, axisNames: [] }),
        [appearance, kind, version],
    );

    /** Name the look currently on screen, so it can be jumped back to. */
    const nameCombination = useCallback(async (selection: Record<string, string>) => {
        if (!appearance || !inputDialog) return;
        const name = await inputDialog.show({
            title: t("characters.editor.combinations.name"),
            placeholder: t("characters.panel.namePlaceholder"),
            required: true,
            maxLength: 100,
        });
        if (name) {
            appearance.createSnapshot(name, selection);
        }
    }, [appearance, inputDialog, t]);

    /** Ids are what everything else stores, so a rename rewrites nothing and needs no confirmation. */
    const rename = useCallback(async (target: { id: string; name: string } | null, noun: string) => {
        if (!appearance || !inputDialog || !target) return;
        const next = await inputDialog.showRenameDialog(target.name, noun);
        if (next) {
            appearance.rename(target, next);
        }
    }, [appearance, inputDialog]);

    if (!character || !appearance) {
        return null;
    }

    /** What each layer draws under the current preview tags. */
    const draw = (layerId: string, selection: Record<string, string>): string | null => {
        const layer = appearance.getLayer(layerId);
        if (!layer) return null;
        if (!layer.axisId) return layer.assetId ?? null;
        return layer.options?.[selection[layer.axisId] ?? ""] ?? null;
    };

    const visibleLayers: PreviewLayer[] = kind === "preset"
        ? [{ id: "pose", assetId: poses.find(pose => pose.id === appearance.getDefaultPoseId())?.assetId ?? null }]
        : layers.filter(layer => !hidden[layer.id]).map(layer => ({ id: layer.id, assetId: draw(layer.id, tags) }));

    // The onion stack is the same layers under the axis's *other* tag - the one the author is
    // comparing against - so it is built from a selection that differs in exactly one axis.
    const onionLayers: PreviewLayer[] | null = (() => {
        if (kind !== "layered" || !onionAxisId) return null;
        const axis = appearance.getAxis(onionAxisId);
        if (!axis || axis.tags.length < 2) return null;
        const current = tags[axis.id];
        const other = axis.tags.find(tag => tag.id !== current) ?? axis.tags[0];
        const selection = { ...tags, [axis.id]: other.id };
        return layers.filter(layer => !hidden[layer.id]).map(layer => ({ id: layer.id, assetId: draw(layer.id, selection) }));
    })();

    // Adopts exactly the size the header is showing - the largest layer measured so far, which is the
    // same stand-in the diagnostics compare against until a canvas is declared.
    // A size is only true of the image that was measured, so a layer drawing nothing right now has a
    // stale one - keeping it would report an off-canvas layer that is not on the canvas at all.
    // Hidden layers keep theirs: hiding is a way to look at the stack, not a way to narrow it.
    const measured = Object.fromEntries(
        layers.filter(layer => draw(layer.id, tags)).map(layer => [layer.id, sizes[layer.id]]).filter(([, size]) => size),
    ) as Record<string, LayerSize>;
    const diagnostics = collectCharacterDiagnostics(appearance, measured, occluded);

    const setCanvasFromLargest = () => {
        const largest = Object.values(measured)
            .sort((a, b) => b.width * b.height - a.width * a.height)[0];
        if (largest) {
            appearance.setCanvas(largest);
        }
    };

    const moveLayer = (draggedId: string, targetId: string) => {
        if (draggedId === targetId || locked[draggedId]) return;
        const target = layers.findIndex(layer => layer.id === targetId);
        if (target === -1) return;
        appearance.moveLayer(draggedId, target);
    };

    return (
        <div className="h-full bg-surface text-fg flex flex-col">
            <div className="px-4 py-2 border-b border-edge flex items-center gap-2">
                <span className="text-sm font-semibold truncate">
                    {character.profile.getProfile().name || t("characters.editor.header.fallbackName")}
                </span>
                <span className="text-xs text-fg-subtle">
                    {t(KIND_LABELS[kind])}
                </span>
            </div>

            {/* A puppet has no stack to preview - Studio cannot draw one outside a running game -
                so the pane that would hold it is not there, rather than there and empty. */}
            <div className={[
                "flex-1 overflow-hidden",
                kind === "puppet" ? "" : "grid grid-cols-[minmax(0,1fr)_360px]",
            ].join(" ")}>
                {kind !== "puppet" && (
                <div className="flex min-h-0 flex-col">
                    {grid ? (
                        <CombinationGrid
                            character={character}
                            set={combinationSet}
                            activeKey={combinationKey(tags)}
                            overriddenAvatarKeys={overriddenAvatarKeys}
                            avatarKeyOf={combination => avatarKeyOf(combination.tags)}
                            onPick={combination => { setPreviewTags(combination.tags); setGrid(false); }}
                            onName={combination => void nameCombination(combination.tags)}
                            onAvatar={(combination, anchor) => {
                                const key = avatarKeyOf(combination.tags);
                                if (key) openSlot({ kind: "avatar", avatarKey: key }, anchor);
                            }}
                            onClose={() => setGrid(false)}
                        />
                    ) : (
                    <LayerStackPreview
                        layers={visibleLayers}
                        onion={onionLayers}
                        canvas={appearance.getCanvas()}
                        sizes={measured}
                        onMeasured={onMeasured}
                        toolbar={kind === "layered" ? (
                            <>
                                <button
                                    className={ICON_BTN}
                                    aria-label={t("characters.editor.setCanvas")}
                                    onClick={setCanvasFromLargest}
                                >
                                    <Crop className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    className={[ICON_BTN, onionAxisId ? "text-primary" : ""].join(" ")}
                                    aria-label={t("characters.editor.onionSkin")}
                                    onClick={() => setOnionAxisId(current => (
                                        current ? null : (axes.find(axis => axis.tags.length > 1)?.id ?? null)
                                    ))}
                                >
                                    <Layers className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    className={ICON_BTN}
                                    aria-label={t("characters.editor.combinations.title")}
                                    onClick={() => setGrid(true)}
                                >
                                    <Grid3x3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    className={ICON_BTN}
                                    aria-label={t("characters.editor.psd.title")}
                                    onClick={() => setPsdOpen(true)}
                                >
                                    <FileImage className="w-3.5 h-3.5" />
                                </button>
                            </>
                        ) : null}
                    />
                    )}
                    {diagnostics.length > 0 && (
                        <div className="max-h-48 shrink-0 overflow-y-auto border-t border-edge">
                            <div className="px-4 py-1.5 text-2xs tracking-wide text-fg-muted">
                                {t("characters.editor.problems")}
                            </div>
                            {diagnostics.map((diagnostic, index) => (
                                <DiagnosticRow
                                    key={`${diagnostic.code}:${diagnostic.target.id}:${index}`}
                                    diagnostic={diagnostic}
                                    onClick={() => setFocus(diagnostic.target)}
                                />
                            ))}
                        </div>
                    )}
                </div>
                )}

                <div className={[
                    "overflow-y-auto p-3 space-y-4",
                    kind === "puppet" ? "mx-auto w-full max-w-lg" : "border-l border-edge",
                ].join(" ")}>
                    {kind === "puppet" ? (
                        <PuppetEditor appearance={appearance} />
                    ) : kind === "preset" ? (
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
                                        aria-label={t("common.rename")}
                                        onClick={() => void rename(pose, "pose")}
                                    >
                                        <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        className={ICON_BTN}
                                        aria-label={t("characters.variantsPanel.changeImage")}
                                        onClick={event => openSlot({ kind: "pose", poseId: pose.id }, event.currentTarget)}
                                    >
                                        <ImagePlus className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        className={appearance.getAvatar(pose.id)?.overrideAssetId ? ICON_BTN_ON : ICON_BTN}
                                        aria-label={t("characters.editor.avatar")}
                                        onClick={event => openSlot({ kind: "avatar", avatarKey: pose.id }, event.currentTarget)}
                                    >
                                        <UserRound className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        className={ICON_BTN}
                                        aria-label={t("characters.editor.removePose")}
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
                                    <div
                                        key={axis.id}
                                        className={[CARD, focus?.kind === "axis" && focus.id === axis.id ? FOCUSED : "border-edge"].join(" ")}
                                        onClick={() => setFocus({ kind: "axis", id: axis.id })}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="min-w-0 flex-1 truncate text-xs">{axis.name}</span>
                                            <button
                                                className={ICON_BTN}
                                                aria-label={t("common.rename")}
                                                onClick={() => void rename(axis, "axis")}
                                            >
                                                <Pencil className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                className={ICON_BTN}
                                                aria-label={t("characters.editor.newTag")}
                                                onClick={() => appearance.createTag(axis.id, t("characters.editor.newTag"))}
                                            >
                                                <Plus className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                className={avatarAxisIds.includes(axis.id) ? ICON_BTN_ON : ICON_BTN}
                                                aria-label={t("characters.editor.avatarAxis")}
                                                onClick={() => toggleAvatarAxis(axis.id)}
                                            >
                                                <UserRound className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                className={ICON_BTN}
                                                aria-label={t("characters.editor.removeAxis")}
                                                onClick={() => appearance.removeAxis(axis.id)}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            {axis.tags.map(tag => (
                                                <div
                                                    key={tag.id}
                                                    className={[
                                                        "group/tag flex items-center gap-0.5 rounded-md border pl-2 pr-1 py-0.5 text-2xs transition-colors",
                                                        tags[axis.id] === tag.id
                                                            ? "border-primary/60 bg-primary/15"
                                                            : "border-edge hover:bg-fill",
                                                    ].join(" ")}
                                                >
                                                    <button
                                                        onClick={() => setPreviewTags(current => ({ ...current, [axis.id]: tag.id }))}
                                                    >
                                                        {tag.name}
                                                    </button>
                                                    {axis.defaultTagId === tag.id && <span className="text-primary">·</span>}
                                                    <span className="hidden items-center group-hover/tag:flex">
                                                        <button
                                                            className={ICON_BTN}
                                                            aria-label={t("common.rename")}
                                                            onClick={() => void rename(tag, "tag")}
                                                        >
                                                            <Pencil className="w-3 h-3" />
                                                        </button>
                                                        <button
                                                            className={ICON_BTN}
                                                            aria-label={t("characters.editor.makeDefault")}
                                                            onClick={() => appearance.setAxisDefaultTag(axis.id, tag.id)}
                                                        >
                                                            <Eye className="w-3 h-3" />
                                                        </button>
                                                        <button
                                                            className={ICON_BTN}
                                                            aria-label={t("characters.editor.removeTag")}
                                                            onClick={() => appearance.removeTag(axis.id, tag.id)}
                                                        >
                                                            <Trash2 className="w-3 h-3" />
                                                        </button>
                                                    </span>
                                                </div>
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
                                {[...layers].reverse().map(layer => {
                                    const isFocused = focus?.kind === "layer" && focus.id === layer.id
                                        || (focus?.kind === "axis" && focus.id === layer.axisId);
                                    return (
                                        <div
                                            key={layer.id}
                                            className={[
                                                CARD,
                                                "nl-drag-source",
                                                isFocused ? FOCUSED : "border-edge",
                                                dragLayerId === layer.id ? "opacity-50" : "",
                                            ].join(" ")}
                                            draggable={!locked[layer.id] && !freeze.frozen}
                                            onDragStart={event => {
                                                // A native drag runs a nested message loop, so a
                                                // React state update made here is not visible to the
                                                // dragover handler that has to preventDefault - the
                                                // ref is what the drop actually reads.
                                                dragRef.current = layer.id;
                                                event.dataTransfer.effectAllowed = "move";
                                                event.dataTransfer.setData("text/plain", layer.id);
                                                setDragLayerId(layer.id);
                                            }}
                                            onDragEnd={() => { dragRef.current = null; setDragLayerId(null); }}
                                            onDragOver={event => {
                                                event.preventDefault();
                                                event.dataTransfer.dropEffect = "move";
                                            }}
                                            // Reordering the stack writes the appearance. Selecting a layer
                                            // to look at it does not, so the row stays clickable.
                                            onDrop={event => {
                                                event.preventDefault();
                                                if (freeze.frozen) return;
                                                const dragged = dragRef.current || event.dataTransfer.getData("text/plain");
                                                if (dragged) moveLayer(dragged, layer.id);
                                                dragRef.current = null;
                                                setDragLayerId(null);
                                            }}
                                            onClick={() => setFocus({ kind: "layer", id: layer.id })}
                                        >
                                            <div className="flex items-center gap-2">
                                                <LayerThumb assetId={draw(layer.id, tags)} />
                                                <span className="min-w-0 flex-1 truncate text-xs">{layer.name}</span>
                                                <button
                                                    className={ICON_BTN}
                                                    aria-label={t(hidden[layer.id] ? "characters.editor.showLayer" : "characters.editor.hideLayer")}
                                                    onClick={() => setHidden(current => ({ ...current, [layer.id]: !current[layer.id] }))}
                                                >
                                                    {hidden[layer.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                                </button>
                                                <button
                                                    className={ICON_BTN}
                                                    aria-label={t(locked[layer.id] ? "characters.editor.unlockLayer" : "characters.editor.lockLayer")}
                                                    onClick={() => setLocked(current => ({ ...current, [layer.id]: !current[layer.id] }))}
                                                >
                                                    {locked[layer.id] ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                                                </button>
                                                <button
                                                    className={ICON_BTN}
                                                    aria-label={t("common.rename")}
                                                    onClick={() => void rename(layer, "layer")}
                                                >
                                                    <Pencil className="w-3.5 h-3.5" />
                                                </button>
                                                <select
                                                    className="bg-surface border border-edge rounded-md text-2xs px-1 py-0.5"
                                                    value={layer.axisId ?? ""}
                                                    disabled={locked[layer.id]}
                                                    onChange={event => appearance.setLayerAxis(layer.id, event.target.value || null)}
                                                >
                                                    <option value="">{t("characters.editor.constantLayer")}</option>
                                                    {axes.map(axis => (
                                                        <option key={axis.id} value={axis.id}>{axis.name}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    className={ICON_BTN}
                                                    aria-label={t("characters.editor.removeLayer")}
                                                    disabled={locked[layer.id]}
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
                                                                aria-label={t("characters.variantsPanel.changeImage")}
                                                                disabled={locked[layer.id]}
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
                                                        aria-label={t("characters.variantsPanel.changeImage")}
                                                        disabled={locked[layer.id]}
                                                        onClick={event => openSlot({ kind: "layer", layerId: layer.id }, event.currentTarget)}
                                                    >
                                                        <ImagePlus className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </Section>

                            {appearance.getSnapshots().length > 0 && (
                                <Section
                                    title={t("characters.editor.snapshots")}
                                    onAdd={() => void nameCombination(tags)}
                                >
                                    {appearance.getSnapshots().map(snapshot => (
                                        <div key={snapshot.id} className={ROW}>
                                            <Bookmark className="w-3.5 h-3.5 shrink-0 text-fg-subtle" />
                                            <button
                                                className="min-w-0 flex-1 truncate text-left"
                                                onClick={() => setPreviewTags(snapshot.tags)}
                                            >
                                                {snapshot.name}
                                            </button>
                                            <button
                                                className={ICON_BTN}
                                                aria-label={t("common.rename")}
                                                onClick={() => void rename(snapshot, "item")}
                                            >
                                                <Pencil className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                className={ICON_BTN}
                                                aria-label={t("common.delete")}
                                                onClick={() => appearance.removeSnapshot(snapshot.id)}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </Section>
                            )}
                        </>
                    )}
                </div>
            </div>

            <PsdImportWizard
                open={psdOpen}
                onClose={() => setPsdOpen(false)}
                appearance={appearance}
                characterName={character.profile.getProfile().name}
            />

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

/** The current tag's image for a layer, so the row shows what it draws rather than that it draws. */
function LayerThumb(props: { assetId: string | null }) {
    const { url } = useAssetObjectUrl(props.assetId);
    return (
        <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-sm bg-fill">
            {url
                ? <img src={url} alt="" draggable={false} className="h-full w-full object-contain" />
                : <Layers className="w-3 h-3 text-fg-subtle" />}
        </span>
    );
}

// Written out rather than interpolated so the keys stay statically checkable against the catalogue.
const DIAGNOSTIC_KEYS = {
    offCanvas: "characters.editor.diagnostics.offCanvas",
    constantNoImage: "characters.editor.diagnostics.constantNoImage",
    layerNoImage: "characters.editor.diagnostics.layerNoImage",
    axisNoTags: "characters.editor.diagnostics.axisNoTags",
    axisUnused: "characters.editor.diagnostics.axisUnused",
    duplicateTag: "characters.editor.diagnostics.duplicateTag",
    occluded: "characters.editor.diagnostics.occluded",
    avatarCombinations: "characters.editor.diagnostics.avatarCombinations",
} as const;

function DiagnosticRow(props: { diagnostic: CharacterDiagnostic; onClick: () => void }) {
    const { t } = useTranslation();
    const { diagnostic } = props;
    const Icon = diagnostic.severity === "error" ? XCircle : AlertTriangle;
    return (
        <button
            className="flex w-full items-center gap-2 px-4 py-1 text-left text-xs hover:bg-fill"
            onClick={props.onClick}
        >
            <Icon className={["w-3.5 h-3.5 shrink-0", diagnostic.severity === "error" ? "text-danger" : "text-warning"].join(" ")} />
            <span className="min-w-0 flex-1 truncate text-fg-muted">
                {t(DIAGNOSTIC_KEYS[diagnostic.code], diagnostic.values)}
            </span>
        </button>
    );
}
