import React, { useCallback, useMemo, useState } from "react";
import { FileImage, Layers, Square } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "@/apps/workspace/context";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { Services } from "@/lib/workspace/services/services";
import type { CharacterAppearance } from "@/lib/workspace/services/character/CharacterAppearance";
import type { StoredCharacter } from "@/lib/workspace/services/character/types";
import { describeReplaceNotKept } from "@/lib/workspace/assets/importFailure";
import type { TranslationKey } from "@shared/i18n";
import { fileUnderCharacterFolder } from "@/lib/workspace/services/character/psdImportFolder";
import {
    applyPsdPlan,
    nameBakeTargets,
    psdRefreshTargets,
    summarisePlan,
} from "@/lib/workspace/services/character/psdImportBuilder";
import type { BlendResolution, PsdDocument } from "@shared/types/psdImport";
import { describePsdFailure } from "./psdImportFailure";
import {
    canMergeBlendMode,
    estimateImportCost,
    flattenLeaves,
    joinPath,
    planImport,
    toBakeTargets,
    unsupportedBlends,
    type PsdDropReason,
    type PsdLeaf,
} from "@shared/utils/psdLayerPlan";

const SECTION = "text-2xs tracking-wide text-fg-muted px-1";
const ROW = "flex items-center gap-2 rounded-md border border-edge bg-fill-subtle px-2 py-1.5 text-xs";

// Written out rather than interpolated so the keys stay statically checkable against the catalogue.
const DROP_REASON_KEYS = {
    hidden: "characters.editor.psd.reason.hidden",
    "blend-skipped": "characters.editor.psd.reason.blendSkipped",
    "clip-base-dropped": "characters.editor.psd.reason.clipBaseDropped",
} as const satisfies Record<PsdDropReason, string>;

/**
 * The one-shot PSD import.
 *
 * The tree is read first and nothing is baked until the author has seen the mapping and settled
 * every blend mode the engine cannot reproduce — importing one of those silently is forbidden,
 * so the Import button stays disabled while any is undecided. That gate is the interception.
 *
 * Nothing here is destructive. A PSD Studio still recognises refreshes the layers it made last time
 * and leaves their names, order and axis bindings alone; anything else is added. A refreshed layer
 * keeps its image: the new bytes are written into the image the last import made, so an update
 * leaves no second copy of every layer in the library. A new layer, and a slot the author has since
 * pointed at an image of their own, get a file of their own instead.
 *
 * The whole import is one step of undo, on the project's stack (`CharacterService.recordCharacterEdit`):
 * Ctrl+Z puts the character back as it was, takes the new images out of the library and writes the
 * refreshed images' previous pixels back in. Those pixels are copied aside before anything is written
 * over them (`AssetLibraryChange`), and an image that cannot be copied stops the import with nothing
 * replaced. The character's image folder is taken back too when this import made it and nothing else
 * is in it by then.
 *
 * ## The freeze
 *
 * Reading a PSD and looking at the mapping is inspection and stays available; Import is the write and
 * goes off. The check is asked twice for one reason: this dialog is a conversation, and its opener in
 * the character editor was greyed on a render that happened before the author started reading a
 * fifty-layer tree. A freeze that arms in between - a session opening on this project is enough -
 * would otherwise find the button live, and Import bakes every layer to disk and copies each one into
 * the library before anything downstream could refuse it.
 */
/** A baked layer's file name without its extension: the name the library gives the image. */
function bakedFileStem(filePath: string): string {
    return (filePath.split(/[\\/]/).pop() ?? "").replace(/\.png$/i, "");
}

export function PsdImportWizard(props: {
    open: boolean;
    onClose: () => void;
    /** The character whose appearance this is: the import's undo step restores its record. */
    characterId: string;
    appearance: CharacterAppearance;
    characterName: string;
    /** After a successful import, with whether the character had any art before it. */
    onImported?: (hadArt: boolean) => void;
}) {
    const { t, tn } = useTranslation();
    const { context } = useWorkspace();
    const freeze = useFreezeGuard();
    const [filePath, setFilePath] = useState<string | null>(null);
    const [document, setDocument] = useState<PsdDocument | null>(null);
    const [resolutions, setResolutions] = useState<Record<string, BlendResolution>>({});
    const [busy, setBusy] = useState<"opening" | "importing" | null>(null);
    const [error, setError] = useState<string | null>(null);

    const leaves = useMemo(() => (document ? flattenLeaves(document.layers) : []), [document]);
    const blends = useMemo(() => unsupportedBlends(leaves), [leaves]);
    const plan = useMemo(() => planImport(leaves, resolutions), [leaves, resolutions]);
    const undecided = blends.filter(leaf => !resolutions[joinPath(leaf.path)]);
    const summary = document ? summarisePlan(props.appearance, plan) : null;
    const cost = document ? estimateImportCost(plan, document) : null;

    const reset = useCallback(() => {
        setFilePath(null);
        setDocument(null);
        setResolutions({});
        setError(null);
    }, []);

    const close = useCallback(() => {
        reset();
        props.onClose();
    }, [props, reset]);

    const choose = useCallback(async () => {
        setBusy("opening");
        setError(null);
        try {
            const result = await getInterface().openPsd();
            if (!result.success) {
                console.warn("[psd] could not read the PSD", result.error);
                setError(describePsdFailure(t("characters.editor.psd.readFailed"), result.code, t));
                return;
            }
            if (!result.data.filePath || !result.data.document) {
                return; // cancelled
            }
            setFilePath(result.data.filePath);
            setDocument(result.data.document);
            setResolutions({});
        } finally {
            setBusy(null);
        }
    }, [t]);

    const runImport = useCallback(async () => {
        const assetsService = context?.services.get<AssetsService>(Services.Assets);
        const characterService = context?.services.get<CharacterService>(Services.Character);
        const character = characterService?.getCharacter(props.characterId);
        if (!assetsService || !characterService || !character || !filePath || !document || freeze.frozen) return;
        setBusy("importing");
        setError(null);
        // What the import does to the library - images it writes over, files it brings in - kept for
        // the one undo step it leaves. Null in a live session, which takes no such step.
        const change = assetsService.beginLibraryChange();
        let recorded = false;
        try {
            // Read before anything moves: the step puts the character back to exactly this.
            const before = structuredClone(character.toJSON()) as StoredCharacter;
            const targets = nameBakeTargets(toBakeTargets(plan), plan, props.characterName);
            const baked = await getInterface().bakePsd({ filePath, layers: targets });
            if (!baked.success) {
                // The title alone: the file was read a moment ago when the tree was drawn, so what
                // failed here is the bake itself, and its message is the worker's.
                console.warn("[psd] could not bake the layers", baked.error);
                setError(t("characters.editor.psd.failed"));
                return;
            }
            const layers = baked.data.layers;
            // A layer the last import made is refreshed in place: same image, new bytes. The bake's
            // file names are what the library named that import's images after.
            const images = assetsService.getAssets()[AssetType.Image] ?? {};
            const refresh = psdRefreshTargets(
                props.appearance,
                plan,
                new Map(layers.map(layer => [joinPath(layer.path), bakedFileStem(layer.filePath)])),
                id => images[id]?.name ?? null,
            );
            // Every image about to be written over is copied aside first, all of them before any is
            // written: one that cannot be copied stops the import with nothing replaced, because a
            // refresh that cannot be undone is not one this import makes.
            const refreshed = [...new Set(refresh.values())].flatMap(id => (images[id] ? [images[id]] : []));
            if (change && refreshed.length > 0) {
                const kept = await change.keep(refreshed);
                if (!kept.ok) {
                    setError(describeReplaceNotKept(kept.name, kept.refusal, t));
                    return;
                }
            }
            const assetIds = new Map<string, string>();
            const fresh: typeof layers = [];
            for (const layer of layers) {
                const key = joinPath(layer.path);
                const image = images[refresh.get(key) ?? ""];
                if (image) {
                    const replaced = await assetsService.replaceAssetContent(image, layer.filePath);
                    if (replaced.success) {
                        change?.replaced(image.id);
                        assetIds.set(key, image.id);
                        continue;
                    }
                    // A file of its own instead, as for a new layer: the import still lands.
                    console.warn(`[psd] could not refresh ${image.name} in place`, replaced.error);
                    change?.forget(image.id);
                }
                fresh.push(layer);
            }
            const imported = fresh.length > 0
                ? await assetsService.importFromPaths(AssetType.Image, fresh.map(layer => layer.filePath))
                : { success: true as const, data: [] };
            if (!imported.success) {
                // The library's refusal is the log's; the title is what the author can read.
                console.warn("[psd] could not import the baked layers", imported.error);
                setError(t("characters.editor.psd.failed"));
                return;
            }
            const importedAssets = imported.data.flatMap(result => (result.success && result.data ? [result.data] : []));
            change?.noteImported(importedAssets);
            // `importFromPaths` answers one result per path, in order, which is what lets a baked
            // layer be matched back to the asset it became.
            fresh.forEach((layer, index) => {
                const result = imported.data[index];
                if (result?.success) {
                    assetIds.set(joinPath(layer.path), result.data.id);
                }
            });
            // Into the character's own folder, not the section's root. The layers are imported by
            // now, so a folder that could not be made or used leaves them where they landed. A
            // refreshed image stays wherever it is.
            const filed = await fileUnderCharacterFolder(assetsService, importedAssets, props.characterName);
            if (!filed.success) {
                console.warn("[psd] could not file the layers under the character's folder", filed.error);
            } else if (filed.data?.created) {
                // Made for this import, so its undo takes the folder back once the layers are out of it.
                change?.noteCreatedFolder(AssetCategory.Image, filed.data.id);
            }

            const fingerprint = props.appearance.getPsdFingerprint();
            const sameFile = fingerprint?.fileName === document.fileName;
            if (!props.appearance.getCanvas() || sameFile) {
                // A re-import of the same PSD is authoritative about its own size; otherwise the
                // canvas already in place belongs to art this import knows nothing about.
                props.appearance.setCanvas({ width: document.width, height: document.height });
            }

            const hadArt = props.appearance.getLayers().some(layer => Boolean(layer.assetId) || Object.values(layer.options ?? {}).some(Boolean));
            const slots = applyPsdPlan(props.appearance, plan, path => assetIds.get(joinPath(path)) ?? null);
            props.appearance.setPsdFingerprint({
                fileName: document.fileName,
                width: document.width,
                height: document.height,
                slots,
                importedAt: Date.now(),
            });
            // One step for the whole import, on the project's stack where every recorded change to a
            // character goes: the layers and their bindings, the images it wrote over, the files it
            // brought in. The step owns `change` from here on, recorded or not.
            characterService.recordCharacterEdit(
                props.characterId,
                before,
                { key: "workspace.history.entry.importPsd" as TranslationKey },
                change ?? undefined,
            );
            recorded = true;
            props.onImported?.(hadArt);
            close();
        } catch (thrown: unknown) {
            console.warn("[psd] import failed", thrown);
            setError(t("characters.editor.psd.failed"));
        } finally {
            if (change && !recorded) {
                // An import that stopped partway takes back what it had already written or brought
                // in, so a failed import leaves the library as it found it.
                await change.undo().catch(error => {
                    console.warn("[psd] could not take back a failed import", error);
                });
                change.dispose();
            }
            setBusy(null);
        }
    }, [close, context, document, filePath, freeze.frozen, plan, props, t]);

    /** What is being flattened onto a given layer, so a clip or a merge is never invisible. */
    const attachedTo = (leaf: PsdLeaf) => (plan.attachments[joinPath(leaf.path)] ?? []).map(entry => (
        <div key={joinPath(entry.leaf.path)} className="pl-5 text-2xs text-fg-subtle">
            {t(entry.clip ? "characters.editor.psd.clippedInto" : "characters.editor.psd.mergedInto", {
                name: entry.leaf.name,
                mode: entry.leaf.blendMode,
            })}
        </div>
    ));

    return (
        <Modal
            isOpen={props.open}
            onClose={close}
            title={t("characters.editor.psd.title")}
            helpTopic="appearances"
            size="lg"
            closeOnOverlayClick={busy === null}
            footer={
                <div className="flex w-full items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
                        {undecided.length > 0
                            ? t("characters.editor.psd.undecided", { count: undecided.length })
                            : summary
                                ? t("characters.editor.psd.summary", summary)
                                : ""}
                    </span>
                    <button
                        type="button"
                        className={dialogFooterButtonClass({ variant: "secondary", disabled: busy === "importing" })}
                        onClick={close}
                        disabled={busy === "importing"}
                    >
                        {t("common.cancel")}
                    </button>
                    <button
                        type="button"
                        aria-label={t("characters.editor.psd.import")}
                        className={dialogFooterButtonClass({
                            variant: "primary",
                            disabled: !document || undecided.length > 0 || busy !== null || freeze.frozen,
                        })}
                        onClick={() => void runImport()}
                        {...freeze.writes(!document || undecided.length > 0 || busy !== null)}
                    >
                        {busy === "importing" ? t("characters.editor.psd.importing") : t("characters.editor.psd.import")}
                    </button>
                </div>
            }
        >
            {!document ? (
                <div className="flex flex-col items-center gap-3 py-8">
                    <FileImage className="h-8 w-8 text-fg-subtle" />
                    <button
                        type="button"
                        className={dialogFooterButtonClass({ variant: "primary", disabled: busy !== null })}
                        onClick={() => void choose()}
                        disabled={busy !== null}
                    >
                        {t("characters.editor.psd.choose")}
                    </button>
                    {error && <p className="text-xs text-danger">{error}</p>}
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate font-medium">{document.fileName}</span>
                        {cost && (
                            <span
                                data-psd-heavy={cost.heavy ? "true" : "false"}
                                className={cost.heavy ? "text-warning" : "text-fg-subtle"}
                            >
                                {t("characters.editor.psd.costCounts", {
                                    layers: tn("characters.editor.psd.layerCount", cost.layers),
                                    megabytes: cost.megabytes,
                                })}
                            </span>
                        )}
                        <span
                            className="text-fg-subtle"
                            aria-label={t("characters.editor.psd.canvas")}
                        >
                            {document.width} × {document.height}
                        </span>
                    </div>

                    {blends.length > 0 && (
                        <div className="space-y-1.5">
                            <div className={SECTION}>{t("characters.editor.psd.blends")}</div>
                            {blends.map(leaf => {
                                const key = joinPath(leaf.path);
                                const mergeable = canMergeBlendMode(leaf.blendMode);
                                const chosen = resolutions[key];
                                return (
                                    <div key={key} className={ROW} data-psd-blend={key}>
                                        <span className="min-w-0 flex-1 truncate">{leaf.name}</span>
                                        <span className="shrink-0 text-2xs text-warning">{leaf.blendMode}</span>
                                        <button
                                            type="button"
                                            aria-label={t("characters.editor.psd.merge")}
                                            data-tip={mergeable ? undefined : t("characters.editor.psd.mergeUnavailable", { mode: leaf.blendMode })}
                                            disabled={!mergeable}
                                            className={[
                                                "rounded-md border px-2 py-0.5 text-2xs transition-colors",
                                                !mergeable
                                                    ? "border-edge text-fg-subtle cursor-not-allowed"
                                                    : chosen === "merge"
                                                        ? "border-primary/60 bg-primary/15"
                                                        : "border-edge hover:bg-fill",
                                            ].join(" ")}
                                            onClick={() => setResolutions(current => ({ ...current, [key]: "merge" }))}
                                        >
                                            {t("characters.editor.psd.merge")}
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={t("characters.editor.psd.skip")}
                                            className={[
                                                "rounded-md border px-2 py-0.5 text-2xs transition-colors",
                                                chosen === "skip" ? "border-primary/60 bg-primary/15" : "border-edge hover:bg-fill",
                                            ].join(" ")}
                                            onClick={() => setResolutions(current => ({ ...current, [key]: "skip" }))}
                                        >
                                            {t("characters.editor.psd.skip")}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <div className={SECTION}>{t("characters.editor.psd.mapping")}</div>
                        {plan.slots.length === 0 && (
                            <p className="px-1 text-xs text-fg-subtle">{t("characters.editor.psd.nothing")}</p>
                        )}
                        {/* Top of the stack reads at the top of the list, the way the art does. */}
                        {[...plan.slots].reverse().map(slot => (slot.kind === "constant" ? (
                            <div key={joinPath(slot.leaf.path)} data-psd-constant={slot.name}>
                                <div className={ROW}>
                                    <Square className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                                    <span className="min-w-0 flex-1 truncate">{slot.name}</span>
                                    <span className="text-2xs text-fg-subtle">
                                        {t("characters.editor.constantLayer")}
                                    </span>
                                </div>
                                {attachedTo(slot.leaf)}
                            </div>
                        ) : (
                            <div key={slot.axis} data-psd-axis={slot.axis} className="space-y-1">
                                <div className={ROW}>
                                    <Layers className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                                    <span className="min-w-0 flex-1 truncate">{slot.axis}</span>
                                    <span className="text-2xs text-fg-subtle">
                                        {tn("characters.editor.psd.axis", slot.options.length)}
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-1 pl-5">
                                    {slot.options.map(option => (
                                        <span
                                            key={joinPath(option.leaf.path)}
                                            data-psd-tag={option.tag}
                                            className="rounded-md border border-edge px-2 py-0.5 text-2xs"
                                        >
                                            {option.tag}
                                        </span>
                                    ))}
                                </div>
                                {slot.options.map(option => attachedTo(option.leaf))}
                            </div>
                        )))}
                    </div>

                    {plan.dropped.length > 0 && (
                        <div className="space-y-1.5">
                            <div className={SECTION}>{t("characters.editor.psd.dropped")}</div>
                            {plan.dropped.map(entry => (
                                <div
                                    key={joinPath(entry.leaf.path)}
                                    data-psd-dropped={entry.leaf.name}
                                    className={[ROW, "text-fg-subtle"].join(" ")}
                                >
                                    <span className="min-w-0 flex-1 truncate">{entry.leaf.name}</span>
                                    <span className="text-2xs">{t(DROP_REASON_KEYS[entry.reason])}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {error && <p className="text-xs text-danger">{error}</p>}
                </div>
            )}
        </Modal>
    );
}
