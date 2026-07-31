import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { createInputDialog } from "@/lib/components/dialogs";
import { useTranslation } from "@/lib/i18n";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset } from "@/lib/workspace/services/assets/types";
import { Character } from "@/lib/workspace/services/character/Character";
import type { CharacterAppearance } from "@/lib/workspace/services/character/CharacterAppearance";
import {
    collectCharacterDiagnostics,
    type CharacterDiagnostic,
    type CharacterDiagnosticTarget,
    type LayerSize,
} from "@/lib/workspace/services/character/characterDiagnostics";
import type { PortraitCrop } from "@/lib/workspace/services/character/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { getSpriteCompositor } from "@/lib/workspace/hooks/useCompositedSprite";
import { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
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
    Plus,
    Trash2,
    Unlock,
    UserRound,
    XCircle,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { ResizableHandle } from "@/apps/workspace/components/ui/ResizableHandle";
import { EditorComponentProps } from "../../types";
import { LayerStackPreview, type PreviewLayer } from "./components/LayerStackPreview";
import { CombinationGrid } from "./components/CombinationGrid";
import { PsdImportWizard } from "./components/PsdImportWizard";
import { PuppetEditor } from "./components/PuppetEditor";
import { InlineName, nextAutoName } from "./components/InlineName";
import { PoseFilmstrip } from "./components/PoseFilmstrip";
import { PortraitCropBox } from "./components/PortraitCropBox";
import { AvatarSection } from "./components/AvatarSection";
import { characterKindLabel } from "../characterKindLabel";
import { useCharacterAvatarBake } from "../useCharacterAvatarBake";
import { syncCharacterEditorTabTitle } from "../state/useCharacterFocus";
import { isPuppetAppearanceKind } from "@shared/utils/characterAppearanceKinds";
import { combinationKey, enumerateCombinations } from "@/lib/workspace/services/character/characterCombinations";
import { characterAvatarAxisIds, characterAvatarKey } from "@shared/utils/characterAvatar";
import { isReadableAccentColor } from "@/apps/workspace/modules/story/scene-editor/storySceneBlockUtils";
import {
    CHARACTER_INSPECTOR_DEFAULT_WIDTH,
    CHARACTER_INSPECTOR_MAX_FRACTION,
    CHARACTER_INSPECTOR_MIN_WIDTH,
    EMPTY_CHARACTER_EDITOR_VIEW_STATE,
    getCharacterEditorViewState,
    getCharacterInspectorWidth,
    patchCharacterEditorViewState,
    setCharacterInspectorWidth,
    type CharacterEditorViewState,
} from "./characterEditorPaneState";

type CharacterEditorPayload = { character: Character };

/** Which image slot the asset picker is filling. */
type SlotRef =
    | { kind: "pose"; poseId: string }
    | { kind: "layer"; layerId: string }
    | { kind: "option"; layerId: string; tagId: string }
    /** A differential's dialog avatar, keyed the way the baker keys it. */
    | { kind: "avatar"; avatarKey: string };

/**
 * What the author has selected, which is also what a diagnostic row jumps to — and, for a preset
 * character, which pose the big preview draws. One idea, one piece of state: a separate
 * "previewing" id could disagree with the selection, and then clicking a problem row about pose 5
 * would highlight pose 5 while showing pose 1.
 */
type Focus = CharacterDiagnosticTarget | null;

const ROW = "flex items-center gap-2 rounded-md border bg-fill-subtle px-2 py-1.5 text-xs";
const ICON_BTN = "p-1 rounded-md text-fg-muted hover:text-fg hover:bg-fill transition-colors disabled:cursor-not-allowed disabled:opacity-40";
/** Same button, lit. Not `ICON_BTN + " text-primary"`: two colour utilities in one class list are
    decided by stylesheet order, not by the order they are written, so the muted one can win. */
const ICON_BTN_ON = "p-1 rounded-md text-primary hover:bg-fill transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const CARD = "rounded-md border bg-fill-subtle p-2 space-y-1.5";
const FOCUSED = "border-primary/60";

/** What deleting each thing costs, said before it happens rather than after. */
const DELETE_DETAIL = {
    pose: "characters.editor.confirm.deletePoseDetail",
    axis: "characters.editor.confirm.deleteAxisDetail",
    tag: "characters.editor.confirm.deleteTagDetail",
    layer: "characters.editor.confirm.deleteLayerDetail",
    snapshot: "characters.editor.confirm.deleteSnapshotDetail",
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
    const characterId = character?.profile.getId() ?? null;

    const uiService = useMemo(
        () => context?.services.get<UIService>(Services.UI) ?? null,
        [context],
    );
    const panelStateService = useMemo(
        () => context?.services.get<PanelStateService>(Services.PanelState) ?? null,
        [context],
    );
    const inputDialog = useMemo(() => (uiService ? createInputDialog(uiService) : null), [uiService]);

    // The appearance mutates in place, so a version counter is what re-renders this tree.
    const [version, setVersion] = useState(0);
    useEffect(() => character?.subscribe(() => setVersion(current => current + 1)), [character]);

    const [slot, setSlot] = useState<SlotRef | null>(null);
    const [view, setView] = useState<CharacterEditorViewState>(EMPTY_CHARACTER_EDITOR_VIEW_STATE);
    const [hidden, setHidden] = useState<Record<string, boolean>>({});
    const [locked, setLocked] = useState<Record<string, boolean>>({});
    const [sizes, setSizes] = useState<Record<string, LayerSize>>({});
    const [dragLayerId, setDragLayerId] = useState<string | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [occluded, setOccluded] = useState<Record<string, boolean>>({});
    const [grid, setGrid] = useState(false);
    const [psdOpen, setPsdOpen] = useState(false);
    const [cropping, setCropping] = useState(false);
    /** Author's intent for where a new crop is written, before the pose carries one of its own. */
    const [scopeToPose, setScopeToPose] = useState<boolean | null>(null);
    const [inspectorWidth, setInspectorWidth] = useState(CHARACTER_INSPECTOR_DEFAULT_WIDTH);
    const dragRef = useRef<string | null>(null);
    const anchorRef = useRef<HTMLElement | null>(null);
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const inspectorWidthRef = useRef(inspectorWidth);
    inspectorWidthRef.current = inspectorWidth;
    const anchorMemo = useMemo(() => ({ current: anchorRef.current }), [slot]);

    const { previewTags, onionAxisId, focus } = view;

    /** One writer for the persisted half of the view, so nothing can update one and forget the other. */
    const patchView = useCallback((patch: Partial<CharacterEditorViewState>) => {
        setView(current => ({ ...current, ...patch }));
        if (panelStateService && characterId) {
            patchCharacterEditorViewState(panelStateService, characterId, patch);
        }
    }, [panelStateService, characterId]);

    const setFocus = useCallback((next: Focus) => patchView({ focus: next }), [patchView]);
    const setPreviewTags = useCallback(
        (next: Record<string, string>) => patchView({ previewTags: next }),
        [patchView],
    );

    // Read back what this character was last being looked at as: which pose, which tags, what was
    // selected. All of it used to be thrown away on close, so reopening a layered character meant
    // re-picking one tag per axis before the picture was the one being worked on again.
    useEffect(() => {
        if (!panelStateService || !characterId) {
            return;
        }
        setView(getCharacterEditorViewState(panelStateService, characterId));
        setInspectorWidth(getCharacterInspectorWidth(panelStateService));
    }, [panelStateService, characterId]);

    // The tab's title is a snapshot taken when it was opened, so a rename from anywhere - this
    // editor, the list, the properties panel - has to be pushed back into it.
    useEffect(() => {
        if (uiService && characterId && character) {
            syncCharacterEditorTabTitle(uiService, characterId, character.profile.getName());
        }
    }, [uiService, characterId, character, version]);

    const kind = appearance?.getKind() ?? "preset";
    // The three puppet kinds share this whole surface: none of them has a layer stack to preview, and
    // all of them get the same inspector. What differs between them is which runtime is expected,
    // which only `PuppetEditor` cares about.
    const isPuppet = isPuppetAppearanceKind(kind);
    const poses = useMemo(() => appearance?.getPoses() ?? [], [appearance, version]);
    const axes = useMemo(() => appearance?.getAxes() ?? [], [appearance, version]);
    const layers = useMemo(() => appearance?.getLayers() ?? [], [appearance, version]);
    // Editor-only: which tag each axis is previewing. Never stored on the character.
    const tags = useMemo(() => appearance?.resolveTagSelection(previewTags) ?? {}, [appearance, previewTags, version]);

    /**
     * Which pose the preview draws. Selecting one is a *look*, not an edit: the default pose is what
     * a story row gets when it names none, and it stays where it was - set only by the explicit
     * "Default" button on the row. Before this, seeing the fifth pose meant making it the default,
     * looking, and putting it back, which is a real change to the project to answer a question.
     */
    const previewPoseId = kind === "preset"
        ? (focus?.kind === "pose" && poses.some(pose => pose.id === focus.id)
            ? focus.id
            : appearance?.getDefaultPoseId() ?? null)
        : null;

    // The baker's own keying, asked of the shared rule rather than re-derived, so what the avatar
    // section shows and what gets baked cannot drift apart.
    const avatarAxisIds = useMemo(
        () => (appearance && kind === "layered"
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

    // Baking is the panel's job on open; this instance exists only for the manual re-bake and for
    // the receipt, which is why it is created disabled.
    const { rebake, running: rebaking, summary: bakeSummary } = useCharacterAvatarBake(false);

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

    /**
     * Deleting a pose, an axis, a tag, a layer or a snapshot is unrecoverable - this module has no
     * history service - and every one of them used to happen on the first click of a 14px glyph
     * sitting beside four others. The list already confirms before deleting a character; this is the
     * same bargain, one level down.
     */
    const confirmDelete = useCallback(async (name: string, noun: keyof typeof DELETE_DETAIL): Promise<boolean> => {
        if (!uiService) return false;
        return uiService.showConfirm(
            t("characters.editor.confirm.deleteTitle", { name }),
            t(DELETE_DETAIL[noun]),
        );
    }, [uiService, t]);

    // The inspector's left edge: dragging right shrinks it. Returns the unconsumed delta so the
    // handle keeps its anchor aligned with the divider once the width clamps.
    const handleInspectorResize = useCallback((delta: number): number => {
        const width = inspectorWidthRef.current;
        const containerWidth = bodyRef.current?.clientWidth ?? width * 2;
        const maxWidth = Math.max(CHARACTER_INSPECTOR_MIN_WIDTH, containerWidth * CHARACTER_INSPECTOR_MAX_FRACTION);
        const nextWidth = Math.round(Math.min(maxWidth, Math.max(CHARACTER_INSPECTOR_MIN_WIDTH, width - delta)));
        if (nextWidth !== width) {
            inspectorWidthRef.current = nextWidth;
            setInspectorWidth(nextWidth);
            if (panelStateService) {
                setCharacterInspectorWidth(panelStateService, nextWidth);
            }
        }
        return (width - nextWidth) - delta;
    }, [panelStateService]);

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

    const previewPose = previewPoseId ? appearance.getPose(previewPoseId) : null;
    /** Keyed per pose, so switching poses does not report the previous one's pixel size. */
    const presetPreviewId = previewPoseId ?? "pose";
    const visibleLayers: PreviewLayer[] = kind === "preset"
        ? [{ id: presetPreviewId, assetId: previewPose?.assetId ?? null }]
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

    /** What the crop box measures itself against: the picture actually under it, at its own size. */
    const previewNatural = kind === "preset"
        ? sizes[presetPreviewId] ?? null
        : appearance.getCanvas()
            ?? Object.values(measured).sort((a, b) => b.width * b.height - a.width * a.height)[0]
            ?? null;

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

    // ------------------------------------------------------------------ avatar

    const avatarKey = kind === "preset" ? previewPoseId : avatarKeyOf(tags);
    const avatarSelection = kind === "preset" ? { poseId: previewPoseId } : { tags: previewTags };
    const profilePortrait = character.profile.getPortrait();
    const poseHasOwnCrop = previewPose?.portrait !== undefined;
    /** Preset only: whether a new framing is written on the pose or on the character. */
    const cropScoped = kind === "preset" ? (scopeToPose ?? poseHasOwnCrop) : false;
    const effectiveCrop = kind === "preset"
        ? (previewPose?.portrait ?? profilePortrait)
        : profilePortrait;

    const commitCrop = (crop: PortraitCrop) => {
        if (freeze.frozen) return;
        if (kind === "preset" && previewPoseId && cropScoped) {
            appearance.setPosePortrait(previewPoseId, crop);
        } else {
            character.profile.setPortrait(crop);
        }
    };

    const resetCrop = () => {
        if (freeze.frozen) return;
        if (kind === "preset" && previewPoseId && cropScoped) {
            appearance.setPosePortrait(previewPoseId, undefined);
        } else {
            character.profile.setPortrait(undefined);
        }
    };

    const toggleCropScope = () => {
        if (freeze.frozen || kind !== "preset" || !previewPoseId) return;
        const next = !cropScoped;
        setScopeToPose(next);
        if (!next && poseHasOwnCrop) {
            // Back to inheriting: the pose's own framing is what makes it scoped, so it goes.
            appearance.setPosePortrait(previewPoseId, undefined);
        } else if (next && !poseHasOwnCrop && effectiveCrop) {
            // Start from whatever was on screen rather than from the automatic crop.
            appearance.setPosePortrait(previewPoseId, effectiveCrop);
        }
    };

    const bakeReport = bakeSummary?.byCharacter[character.profile.getId()];
    const bakeReceipt = bakeSummary
        ? (bakeSummary.written || bakeSummary.unresolved || bakeSummary.removed)
            ? t("characters.editor.bakeReceipt", {
                written: String(bakeSummary.written),
                unresolved: String(bakeSummary.unresolved),
                removed: String(bakeSummary.removed),
            })
            : t("characters.editor.bakeUpToDate")
        : null;

    const accent = character.profile.getColor();
    // An accent that all but matches one theme's surface is unreadable there, so it degrades to the
    // default ink rather than making the name disappear - the same guard the story nametags use.
    const headerColor = accent && isReadableAccentColor(accent) ? accent : undefined;

    const renameHint = t("characters.editor.renameHint");

    return (
        <div className="h-full bg-surface text-fg flex flex-col">
            <div className="px-4 py-2 border-b border-edge flex items-center gap-2">
                <span
                    className="text-sm font-semibold truncate"
                    style={headerColor ? { color: headerColor } : undefined}
                >
                    {character.profile.getProfile().name || t("characters.editor.header.fallbackName")}
                </span>
                <span className="text-xs text-fg-subtle">
                    {characterKindLabel(kind, t)}
                </span>
            </div>

            {/* A puppet has no stack to preview - Studio cannot draw one outside a running game -
                so the pane that would hold it is not there, rather than there and empty. */}
            <div ref={bodyRef} className="flex flex-1 overflow-hidden">
                {!isPuppet && (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
                        sizes={kind === "preset" ? sizes : measured}
                        onMeasured={onMeasured}
                        // A static sprite is not "1 drawn layer" - the layer vocabulary belongs to
                        // the kind that has layers. A preset preview says which pose it is showing,
                        // which is the thing the author actually needs to read here.
                        caption={kind === "preset" ? (previewPose?.name ?? null) : undefined}
                        // Never drawn while frozen: the box is a gesture, and a gesture that picks
                        // up and refuses to write reads as a broken editor rather than as a freeze.
                        overlay={cropping && !freeze.frozen ? (
                            <PortraitCropBox
                                natural={previewNatural}
                                value={effectiveCrop}
                                title={t("characters.preview.portraitTitle")}
                                onCommit={commitCrop}
                            />
                        ) : null}
                        toolbar={kind === "layered" ? (
                            <>
                                <button
                                    className={ICON_BTN}
                                    onClick={setCanvasFromLargest}
                                    {...freeze.writes(false, t("characters.editor.setCanvas"))}
                                >
                                    <Crop className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    className={onionAxisId ? ICON_BTN_ON : ICON_BTN}
                                    title={t("characters.editor.onionSkin")}
                                    onClick={() => patchView({
                                        onionAxisId: onionAxisId ? null : (axes.find(axis => axis.tags.length > 1)?.id ?? null),
                                    })}
                                >
                                    <Layers className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    className={ICON_BTN}
                                    title={t("characters.editor.combinations.title")}
                                    onClick={() => setGrid(true)}
                                >
                                    <Grid3x3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    className={ICON_BTN}
                                    onClick={() => setPsdOpen(true)}
                                    {...freeze.writes(false, t("characters.editor.psd.title"))}
                                >
                                    <FileImage className="w-3.5 h-3.5" />
                                </button>
                            </>
                        ) : null}
                    />
                    )}
                    {/* The strip is the answer to "how many poses does this character have and which
                        ones are missing art" - a question the pane above could not answer at all. */}
                    {kind === "preset" && !grid && (
                        <PoseFilmstrip
                            poses={poses}
                            activePoseId={previewPoseId}
                            defaultPoseId={appearance.getDefaultPoseId()}
                            onPick={poseId => setFocus({ kind: "pose", id: poseId })}
                        />
                    )}
                    {diagnostics.length > 0 && (
                        <div className="max-h-48 shrink-0 overflow-y-auto border-t border-edge">
                            <div className="px-4 py-1.5 text-2xs tracking-wide text-fg-muted">
                                {t("characters.editor.problems")}
                            </div>
                            {diagnostics.map((diagnostic, index) => (
                                <DiagnosticRow
                                    key={`${diagnostic.code}:${diagnostic.target?.id ?? "-"}:${index}`}
                                    diagnostic={diagnostic}
                                    onClick={diagnostic.target ? () => setFocus(diagnostic.target) : null}
                                />
                            ))}
                        </div>
                    )}
                </div>
                )}

                {!isPuppet && (
                    <ResizableHandle
                        direction="horizontal"
                        onResize={handleInspectorResize}
                        className="w-1 shrink-0 bg-fill-subtle"
                    />
                )}

                <div
                    className={[
                        "overflow-y-auto p-3 space-y-4",
                        isPuppet ? "mx-auto w-full max-w-lg" : "min-h-0 shrink-0",
                    ].join(" ")}
                    style={isPuppet ? undefined : { width: inspectorWidth }}
                >
                    {isPuppet ? (
                        <PuppetEditor appearance={appearance} />
                    ) : (
                        <>
                        <AvatarSection
                            character={character}
                            appearance={appearance}
                            avatarKey={avatarKey}
                            selection={avatarSelection}
                            crop={effectiveCrop}
                            cropScoped={cropScoped}
                            onToggleScope={kind === "preset" && previewPoseId ? toggleCropScope : null}
                            onResetCrop={resetCrop}
                            cropping={cropping}
                            onToggleCropping={() => setCropping(current => !current)}
                            onPickOverride={anchor => {
                                if (avatarKey) openSlot({ kind: "avatar", avatarKey }, anchor);
                            }}
                            onClearOverride={() => {
                                if (avatarKey) appearance.setAvatar(avatarKey, null);
                            }}
                            frozen={freeze.frozen}
                            freezeReason={freeze.reason}
                            unresolved={Boolean(avatarKey && bakeReport?.unresolved.includes(avatarKey))}
                            onRebake={() => void rebake()}
                            rebaking={rebaking}
                            receipt={bakeReceipt}
                        />

                        {kind === "preset" ? (
                        <Section
                            title={t("characters.editor.poses")}
                            onAdd={() => appearance.createPose(
                                nextAutoName(n => t("characters.editor.defaultPoseName", { n: String(n) }), poses),
                            )}
                        >
                            {poses.map(pose => (
                                <div
                                    key={pose.id}
                                    className={[
                                        ROW,
                                        "group cursor-pointer",
                                        focus?.kind === "pose" && focus.id === pose.id ? FOCUSED : "border-edge",
                                    ].join(" ")}
                                    onClick={() => setFocus({ kind: "pose", id: pose.id })}
                                >
                                    <InlineName
                                        value={pose.name}
                                        title={renameHint}
                                        disabled={freeze.frozen}
                                        onCommit={next => appearance.rename(pose, next)}
                                    />
                                    {appearance.getDefaultPoseId() === pose.id ? (
                                        <span className="shrink-0 text-2xs text-primary">{t("characters.variantsPanel.default")}</span>
                                    ) : (
                                        <button
                                            className="shrink-0 rounded-md px-1 text-2xs text-fg-subtle opacity-0 hover:text-fg group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                                            onClick={event => { event.stopPropagation(); appearance.setDefaultPoseId(pose.id); }}
                                            {...freeze.writes(false, t("characters.editor.makeDefault"))}
                                        >
                                            {t("characters.variantsPanel.default")}
                                        </button>
                                    )}
                                    <button
                                        className={ICON_BTN}
                                        onClick={event => { event.stopPropagation(); openSlot({ kind: "pose", poseId: pose.id }, event.currentTarget); }}
                                        {...freeze.writes(false, t("characters.variantsPanel.changeImage"))}
                                    >
                                        <ImagePlus className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        className={appearance.getAvatar(pose.id)?.overrideAssetId ? ICON_BTN_ON : ICON_BTN}
                                        onClick={event => { event.stopPropagation(); openSlot({ kind: "avatar", avatarKey: pose.id }, event.currentTarget); }}
                                        {...freeze.writes(false, t("characters.editor.avatar"))}
                                    >
                                        <UserRound className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        className={ICON_BTN}
                                        onClick={async event => {
                                            event.stopPropagation();
                                            if (await confirmDelete(pose.name, "pose")) appearance.removePose(pose.id);
                                        }}
                                        {...freeze.writes(false, t("characters.editor.removePose"))}
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
                                onAdd={() => appearance.createAxis(
                                    nextAutoName(n => t("characters.editor.defaultAxisName", { n: String(n) }), axes),
                                )}
                            >
                                {axes.map(axis => (
                                    <div
                                        key={axis.id}
                                        className={[CARD, focus?.kind === "axis" && focus.id === axis.id ? FOCUSED : "border-edge"].join(" ")}
                                        onClick={() => setFocus({ kind: "axis", id: axis.id })}
                                    >
                                        <div className="flex items-center gap-2">
                                            <InlineName
                                                value={axis.name}
                                                className="text-xs"
                                                title={renameHint}
                                                disabled={freeze.frozen}
                                                onCommit={next => appearance.rename(axis, next)}
                                            />
                                            <button
                                                className={ICON_BTN}
                                                onClick={event => {
                                                    event.stopPropagation();
                                                    appearance.createTag(axis.id, nextAutoName(
                                                        n => t("characters.editor.defaultTagName", { n: String(n) }),
                                                        axis.tags,
                                                    ));
                                                }}
                                                {...freeze.writes(false, t("characters.editor.newTag"))}
                                            >
                                                <Plus className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                className={avatarAxisIds.includes(axis.id) ? ICON_BTN_ON : ICON_BTN}
                                                onClick={event => { event.stopPropagation(); toggleAvatarAxis(axis.id); }}
                                                {...freeze.writes(false, t("characters.editor.avatarAxis"))}
                                            >
                                                <UserRound className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                className={ICON_BTN}
                                                onClick={async event => {
                                                    event.stopPropagation();
                                                    if (await confirmDelete(axis.name, "axis")) appearance.removeAxis(axis.id);
                                                }}
                                                {...freeze.writes(false, t("characters.editor.removeAxis"))}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            {axis.tags.map(tag => (
                                                <div
                                                    key={tag.id}
                                                    // Clicking the chip still previews the tag, the
                                                    // gesture that was already there; renaming rides
                                                    // on the double-click that had nothing bound to it.
                                                    className={[
                                                        "group/tag flex cursor-pointer items-center gap-0.5 rounded-md border pl-2 pr-1 py-0.5 text-2xs transition-colors",
                                                        tags[axis.id] === tag.id
                                                            ? "border-primary/60 bg-primary/15"
                                                            : "border-edge hover:bg-fill",
                                                    ].join(" ")}
                                                    onClick={() => setPreviewTags({ ...previewTags, [axis.id]: tag.id })}
                                                >
                                                    <InlineName
                                                        value={tag.name}
                                                        grow={false}
                                                        title={renameHint}
                                                        disabled={freeze.frozen}
                                                        onCommit={next => appearance.rename(tag, next)}
                                                    />
                                                    {axis.defaultTagId === tag.id && <span className="text-primary">·</span>}
                                                    <span className="hidden items-center group-hover/tag:flex">
                                                        <button
                                                            className={ICON_BTN}
                                                            onClick={event => { event.stopPropagation(); appearance.setAxisDefaultTag(axis.id, tag.id); }}
                                                            {...freeze.writes(false, t("characters.editor.makeDefault"))}
                                                        >
                                                            <Eye className="w-3 h-3" />
                                                        </button>
                                                        <button
                                                            className={ICON_BTN}
                                                            onClick={async event => {
                                                                event.stopPropagation();
                                                                if (await confirmDelete(tag.name, "tag")) appearance.removeTag(axis.id, tag.id);
                                                            }}
                                                            {...freeze.writes(false, t("characters.editor.removeTag"))}
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
                                onAdd={() => appearance.createLayer(
                                    nextAutoName(n => t("characters.editor.defaultLayerName", { n: String(n) }), layers),
                                )}
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
                                            // A native drag begins on mousedown, before a caret can be
                                            // placed, so a draggable row swallows text selection inside
                                            // it - the name being edited has to switch the drag off.
                                            draggable={!locked[layer.id] && !freeze.frozen && renamingId !== layer.id}
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
                                                <InlineName
                                                    value={layer.name}
                                                    className="text-xs"
                                                    title={renameHint}
                                                    disabled={freeze.frozen}
                                                    onEditingChange={editing => setRenamingId(editing ? layer.id : null)}
                                                    onCommit={next => appearance.rename(layer, next)}
                                                />
                                                <button
                                                    className={ICON_BTN}
                                                    title={t(hidden[layer.id] ? "characters.editor.showLayer" : "characters.editor.hideLayer")}
                                                    onClick={() => setHidden(current => ({ ...current, [layer.id]: !current[layer.id] }))}
                                                >
                                                    {hidden[layer.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                                </button>
                                                <button
                                                    className={ICON_BTN}
                                                    title={t(locked[layer.id] ? "characters.editor.unlockLayer" : "characters.editor.lockLayer")}
                                                    onClick={() => setLocked(current => ({ ...current, [layer.id]: !current[layer.id] }))}
                                                >
                                                    {locked[layer.id] ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                                                </button>
                                                <select
                                                    className="bg-surface border border-edge rounded-md text-2xs px-1 py-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                                                    value={layer.axisId ?? ""}
                                                    onChange={event => appearance.setLayerAxis(layer.id, event.target.value || null)}
                                                    {...freeze.writes(locked[layer.id])}
                                                >
                                                    <option value="">{t("characters.editor.constantLayer")}</option>
                                                    {axes.map(axis => (
                                                        <option key={axis.id} value={axis.id}>{axis.name}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    className={ICON_BTN}
                                                    onClick={async event => {
                                                        event.stopPropagation();
                                                        if (await confirmDelete(layer.name, "layer")) appearance.removeLayer(layer.id);
                                                    }}
                                                    {...freeze.writes(locked[layer.id], t("characters.editor.removeLayer"))}
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
                                                                onClick={event => { event.stopPropagation(); openSlot({ kind: "option", layerId: layer.id, tagId: tag.id }, event.currentTarget); }}
                                                                {...freeze.writes(locked[layer.id], t("characters.variantsPanel.changeImage"))}
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
                                                        onClick={event => { event.stopPropagation(); openSlot({ kind: "layer", layerId: layer.id }, event.currentTarget); }}
                                                        {...freeze.writes(locked[layer.id], t("characters.variantsPanel.changeImage"))}
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
                                        <div
                                            key={snapshot.id}
                                            className={[ROW, "border-edge cursor-pointer"].join(" ")}
                                            onClick={() => setPreviewTags(snapshot.tags)}
                                        >
                                            <Bookmark className="w-3.5 h-3.5 shrink-0 text-fg-subtle" />
                                            <InlineName
                                                value={snapshot.name}
                                                title={renameHint}
                                                disabled={freeze.frozen}
                                                onCommit={next => appearance.rename(snapshot, next)}
                                            />
                                            <button
                                                className={ICON_BTN}
                                                onClick={async event => {
                                                    event.stopPropagation();
                                                    if (await confirmDelete(snapshot.name, "snapshot")) appearance.removeSnapshot(snapshot.id);
                                                }}
                                                {...freeze.writes(false, t("common.delete"))}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </Section>
                            )}
                        </>
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
                // The picker showing nothing selected made every re-open look like a fresh choice,
                // which is how a wrong pick became a wrong pick nobody could see.
                selectedIds={currentSlotAssetIds(appearance, slot)}
                onClose={() => setSlot(null)}
                onConfirm={confirmAsset}
                anchorRef={anchorMemo}
                title={t(slot?.kind === "avatar"
                    ? "characters.editor.selectAvatarImage"
                    : "characters.editor.selectImage")}
                multiple={false}
            />
        </div>
    );
}

/** What the picker should open showing as already chosen. */
function currentSlotAssetIds(appearance: CharacterAppearance, slot: SlotRef | null): string[] {
    if (!slot) return [];
    const id = slot.kind === "pose"
        ? appearance.getPose(slot.poseId)?.assetId
        : slot.kind === "layer"
            ? appearance.getLayer(slot.layerId)?.assetId
            : slot.kind === "option"
                ? appearance.getLayer(slot.layerId)?.options?.[slot.tagId]
                : appearance.getAvatar(slot.avatarKey)?.overrideAssetId;
    return id ? [id] : [];
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
    poseNoImage: "characters.editor.diagnostics.poseNoImage",
    noPoses: "characters.editor.diagnostics.noPoses",
    defaultPoseMissing: "characters.editor.diagnostics.defaultPoseMissing",
    duplicatePose: "characters.editor.diagnostics.duplicatePose",
} as const;

function DiagnosticRow(props: { diagnostic: CharacterDiagnostic; onClick: (() => void) | null }) {
    const { t } = useTranslation();
    const { diagnostic } = props;
    const Icon = diagnostic.severity === "error" ? XCircle : AlertTriangle;
    return (
        <button
            className="flex w-full items-center gap-2 px-4 py-1 text-left text-xs hover:bg-fill disabled:hover:bg-transparent"
            disabled={!props.onClick}
            onClick={props.onClick ?? undefined}
        >
            <Icon className={["w-3.5 h-3.5 shrink-0", diagnostic.severity === "error" ? "text-danger" : "text-warning"].join(" ")} />
            <span className="min-w-0 flex-1 truncate text-fg-muted">
                {t(DIAGNOSTIC_KEYS[diagnostic.code], diagnostic.values)}
            </span>
        </button>
    );
}
