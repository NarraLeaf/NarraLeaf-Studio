import React, { useCallback, useMemo, useState } from "react";
import { FileImage, Layers, Square } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "@/apps/workspace/context";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services } from "@/lib/workspace/services/services";
import type { CharacterAppearance } from "@/lib/workspace/services/character/CharacterAppearance";
import {
    applyPsdPlan,
    nameBakeTargets,
    summarisePlan,
} from "@/lib/workspace/services/character/psdImportBuilder";
import type { BlendResolution, PsdDocument } from "@shared/types/psdImport";
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
 * every blend mode the engine cannot reproduce — the plan forbids importing one of those silently,
 * so the Import button stays disabled while any is undecided. That gate is the interception.
 *
 * Nothing here is destructive. A PSD Studio still recognises refreshes the layers it made last time
 * and leaves their names, order and axis bindings alone; anything else is added.
 */
export function PsdImportWizard(props: {
    open: boolean;
    onClose: () => void;
    appearance: CharacterAppearance;
    characterName: string;
}) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
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
                setError(result.error || t("characters.editor.psd.failed"));
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
        if (!assetsService || !filePath || !document) return;
        setBusy("importing");
        setError(null);
        try {
            const targets = nameBakeTargets(toBakeTargets(plan), plan, props.characterName);
            const baked = await getInterface().bakePsd({ filePath, layers: targets });
            if (!baked.success) {
                setError(baked.error || t("characters.editor.psd.failed"));
                return;
            }
            const layers = baked.data.layers;
            const imported = await assetsService.importFromPaths(
                AssetType.Image,
                layers.map(layer => layer.filePath),
            );
            if (!imported.success) {
                setError(imported.error || t("characters.editor.psd.failed"));
                return;
            }
            // `importFromPaths` answers one result per path, in order, which is what lets a baked
            // layer be matched back to the asset it became.
            const assetIds = new Map<string, string>();
            layers.forEach((layer, index) => {
                const result = imported.data[index];
                if (result?.success) {
                    assetIds.set(joinPath(layer.path), result.data.id);
                }
            });

            const fingerprint = props.appearance.getPsdFingerprint();
            const sameFile = fingerprint?.fileName === document.fileName;
            if (!props.appearance.getCanvas() || sameFile) {
                // A re-import of the same PSD is authoritative about its own size; otherwise the
                // canvas already in place belongs to art this import knows nothing about.
                props.appearance.setCanvas({ width: document.width, height: document.height });
            }

            const slots = applyPsdPlan(props.appearance, plan, path => assetIds.get(joinPath(path)) ?? null);
            props.appearance.setPsdFingerprint({
                fileName: document.fileName,
                width: document.width,
                height: document.height,
                slots,
                importedAt: Date.now(),
            });
            close();
        } catch (thrown: unknown) {
            setError(thrown instanceof Error ? thrown.message : String(thrown));
        } finally {
            setBusy(null);
        }
    }, [close, context, document, filePath, plan, props, t]);

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
                            disabled: !document || undecided.length > 0 || busy !== null,
                        })}
                        onClick={() => void runImport()}
                        disabled={!document || undecided.length > 0 || busy !== null}
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
                                aria-label={t("characters.editor.psd.cost")}
                                data-psd-heavy={cost.heavy ? "true" : "false"}
                                className={cost.heavy ? "text-warning" : "text-fg-subtle"}
                            >
                                {t("characters.editor.psd.cost", { layers: cost.layers, megabytes: cost.megabytes })}
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
                                            title={mergeable ? undefined : t("characters.editor.psd.mergeUnavailable", { mode: leaf.blendMode })}
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
                                        {t("characters.editor.psd.axis", { count: slot.options.length })}
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
