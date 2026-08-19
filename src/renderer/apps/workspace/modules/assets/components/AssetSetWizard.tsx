/**
 * Making an asset set out of the files an author selected.
 *
 * The set model names its members by tag, which used to mean an author declared a set in three
 * places: a tagging pass over the file names, a second selection to make the set, and then the
 * inspector to say what each axis ranges over and when it resolves. Two of those steps asked them to
 * type the same words twice, and a typo in the second one showed up as a variant with no file -
 * indistinguishable from a picture nobody has drawn yet.
 *
 * This is those three steps as one. The author reads their own file names back: each position gets
 * a name, and the variant list underneath shows what the project will hold the moment they confirm.
 * The tags are written on the way out, so they remain what membership is made of - nothing about the
 * model changed, only where the author stands while declaring it.
 *
 * ## The preview is the same computation as the write
 *
 * Both come from `@shared/types/assetSetPlan`. A preview computed separately from the write is a
 * dialog that can show a set the project does not get, and this dialog exists precisely so that the
 * author sees the holes before committing rather than after.
 *
 * The library is measured whole, not just the selection: a file elsewhere in the project that
 * already carries these tags makes a coordinate ambiguous, and that is worth knowing here rather
 * than as a project check later.
 */

import { useCallback, useMemo, useState } from "react";
import { Input, Select } from "@/lib/components/elements";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { MagicTagManager } from "@/lib/workspace/services/core/MagicTagManager";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import type { AssetSetService } from "@/lib/workspace/services/assets/AssetSetService";
import type { Asset } from "@/lib/workspace/services/assets/types";
import type { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import {
    ASSET_AXIS_RESIDENCIES,
    assetSetCoordinateLabel,
    resolveAssetSetContents,
    type AssetSet,
    type AssetSetCandidate,
} from "@shared/types/assetSet";
import {
    planAssetSet,
    segmentCount,
    segmentValues,
    splitAssetName,
    suggestSegmentRoles,
    type AssetSetPlanFile,
    type AssetSetSegmentRole,
} from "@shared/types/assetSetPlan";

/** Delimiters offered when the names carry none, so the author is never left without the control. */
const FALLBACK_DELIMITERS = ["-", "_", ".", " "];

export interface AssetSetWizardProps {
    /**
     * The rows the author marked. All of one type; the caller refuses a mixed selection.
     *
     * Mounted only while the dialog is up, so every reading below starts from this selection rather
     * than from whatever the last one left behind.
     */
    assets: Asset[];
    onClose: () => void;
}

export function AssetSetWizard({ assets, onClose }: AssetSetWizardProps) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);

    const type = assets[0]?.type;

    /** The languages this project declares, which is what makes a position a locale axis. */
    const localeCodes = useMemo(() => {
        if (!context) return [];
        try {
            return context.services.get<LocalizationService>(Services.Localization)
                .getConfiguration().locales.map(locale => locale.code);
        } catch {
            return [];
        }
    }, [context]);

    /**
     * The delimiters the names actually use, most frequent first.
     *
     * Read off the selection rather than offered as a fixed list: an author who names files
     * `alice_happy_en` should not have to find the underscore among punctuation their project never
     * uses. The fallback list is there for names with no delimiter at all, where the whole name is
     * one position and the control would otherwise be empty.
     */
    const delimiterOptions = useMemo(() => {
        if (assets.length === 0) {
            return FALLBACK_DELIMITERS;
        }
        try {
            const detected = MagicTagManager.analyzeFilenames(assets.map(asset => asset.name))
                .delimiters?.map(entry => entry.char) ?? [];
            return detected.length > 0 ? detected : FALLBACK_DELIMITERS;
        } catch {
            return FALLBACK_DELIMITERS;
        }
    }, [assets]);

    const [delimiter, setDelimiter] = useState(() => delimiterOptions[0] ?? "");

    const files = useMemo<AssetSetPlanFile[]>(
        () => assets.map(asset => ({
            id: asset.id,
            segments: splitAssetName(asset.name, delimiter ? [delimiter] : []),
            tags: asset.tags,
        })),
        [assets, delimiter],
    );

    const positions = segmentCount(files);

    /**
     * What the author has said, over what the names suggest.
     *
     * Held as an override rather than as the state itself: a different delimiter is a different set
     * of positions, so anything typed against the old ones was about positions that no longer
     * exist. Dropping the override reads the names again, which is the only honest thing to show.
     */
    const [roleOverride, setRoleOverride] = useState<AssetSetSegmentRole[] | null>(null);
    const suggested = useMemo(() => suggestSegmentRoles(files, localeCodes), [files, localeCodes]);
    const roles = roleOverride ?? suggested;

    const plan = useMemo(
        () => planAssetSet(files, roles, type ?? ""),
        [files, roles, type],
    );

    // The name the set gets if the author does not type one: what these files have in common, which
    // is what the set is. The first file's name is one corner of the set, not the set.
    const suggestedName = useMemo(
        () => plan.filter.map(tag => tag.slice(tag.indexOf(":") + 1)).join(" "),
        [plan.filter],
    );

    /**
     * The set as it will exist, measured against the library as it will be.
     *
     * The planned tags are laid over the selection's rows; every other row is read as it stands.
     */
    const preview = useMemo(() => {
        if (!type) {
            return null;
        }
        const candidates: AssetSetCandidate[] = [];
        const assetsService = context?.services.get<AssetsService>(Services.Assets) ?? null;
        const names = new Map<string, string>();
        if (assetsService) {
            for (const bucket of Object.values(assetsService.getAssets())) {
                for (const asset of Object.values(bucket ?? {})) {
                    candidates.push({
                        id: asset.id,
                        type: asset.type,
                        tags: plan.tagsByFile.get(asset.id) ?? asset.tags,
                    });
                    names.set(asset.id, asset.name);
                }
            }
        }
        const set: AssetSet = { id: "", name: "", type, filter: plan.filter, axes: plan.axes };
        return { contents: resolveAssetSetContents(set, candidates), names, set };
    }, [context, plan, type]);

    const patchRole = useCallback((index: number, patch: Partial<AssetSetSegmentRole>) => {
        setRoleOverride(current => (current ?? suggested)
            .map((role, position) => (position === index ? { ...role, ...patch } : role)));
    }, [suggested]);

    const chooseDelimiter = useCallback((next: string) => {
        setDelimiter(next);
        setRoleOverride(null);
    }, []);

    const create = useCallback(async () => {
        if (!context || !type || busy) {
            return;
        }
        setBusy(true);
        try {
            const assetsService = context.services.get<AssetsService>(Services.Assets);
            const setService = context.services.get<AssetSetService>(Services.AssetSets);
            // One transaction for the tags, so a set is never made against a library half-written.
            await assetsService.transaction(async service => {
                for (const asset of assets) {
                    const tags = plan.tagsByFile.get(asset.id);
                    if (tags && !sameTags(tags, asset.tags)) {
                        await service.updateAssetTags(asset, tags);
                    }
                }
            });
            setService.createSet({
                name: name.trim() || suggestedName,
                type: type as AssetType,
                filter: plan.filter,
                axes: plan.axes,
            });
            onClose();
        } finally {
            setBusy(false);
        }
    }, [assets, busy, context, name, onClose, plan, suggestedName, type]);

    if (!type) {
        return null;
    }

    const canCreate = plan.axes.length > 0 && !busy;

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={t("assets.sets.create.title")}
            size="lg"
            closeOnOverlayClick={!busy}
            footer={
                <div className="flex w-full items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
                        {preview && preview.contents.cells.length > 0
                            ? t("assets.sets.variantsResolved", {
                                resolved: String(preview.contents.cells.length
                                    - preview.contents.missing.length
                                    - preview.contents.ambiguous.length),
                                total: String(preview.contents.cells.length),
                            })
                            : ""}
                    </span>
                    <button
                        type="button"
                        className={dialogFooterButtonClass({ variant: "secondary", disabled: busy })}
                        onClick={onClose}
                        disabled={busy}
                    >
                        {t("common.cancel")}
                    </button>
                    <button
                        type="button"
                        data-asset-set-wizard-create
                        className={dialogFooterButtonClass({ variant: "primary", disabled: !canCreate })}
                        onClick={() => { void create(); }}
                        disabled={!canCreate}
                    >
                        {t("common.create")}
                    </button>
                </div>
            }
        >
            <div className="space-y-4">
                <div className="grid gap-1">
                    <FieldLabel as="div">{t("common.name")}</FieldLabel>
                    <Input
                        size="sm"
                        fullWidth
                        value={name}
                        placeholder={suggestedName}
                        onChange={event => setName(event.target.value)}
                    />
                </div>

                <div className="grid gap-1">
                    <FieldLabel as="div">{t("assets.sets.create.delimiter")}</FieldLabel>
                    <Select
                        size="sm"
                        value={delimiter}
                        options={delimiterOptions.map(char => ({
                            value: char,
                            label: char === " " ? t("assets.sets.create.delimiterSpace") : char,
                        }))}
                        onChange={value => chooseDelimiter(String(value))}
                        ariaLabel={t("assets.sets.create.delimiter")}
                    />
                </div>

                <div className="space-y-2">
                    <FieldLabel as="div">{t("assets.sets.create.segments")}</FieldLabel>
                    {Array.from({ length: positions }, (_, index) => {
                        const values = segmentValues(files, index);
                        const varies = values.length > 1;
                        const role = roles[index] ?? { category: "", residency: "build" as const };
                        return (
                            <div key={index} className="flex items-center gap-2" data-asset-set-position={index}>
                                <span className="w-24 shrink-0 truncate text-2xs text-fg-subtle" data-tip={values.join(" · ")}>
                                    {values.join(" · ")}
                                </span>
                                <Input
                                    size="sm"
                                    className="min-w-0 flex-1"
                                    value={role.category}
                                    placeholder={t("assets.sets.inspector.axisKey")}
                                    onChange={event => patchRole(index, { category: event.target.value })}
                                />
                                <div className="w-36 shrink-0">
                                    {varies && role.category.trim() ? (
                                        <Select
                                            size="sm"
                                            fullWidth
                                            value={role.residency}
                                            options={ASSET_AXIS_RESIDENCIES.map(residency => ({
                                                value: residency,
                                                label: t(`assets.sets.inspector.residency.${residency}`),
                                            }))}
                                            onChange={value => patchRole(index, {
                                                residency: value as AssetSetSegmentRole["residency"],
                                            })}
                                            ariaLabel={t("assets.sets.inspector.residency.label")}
                                        />
                                    ) : null}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="space-y-1">
                    <FieldLabel as="div">{t("assets.sets.inspector.variants")}</FieldLabel>
                    {/* No axis named yet means one coordinate that matches everything, which would
                        draw a nameless row reporting the whole library as ambiguous. The set does
                        not promise anything until a position is named, so say that instead. */}
                    {!preview || plan.axes.length === 0 || preview.contents.cells.length === 0 ? (
                        <p className="text-2xs text-fg-subtle">{t("assets.sets.inspector.noVariants")}</p>
                    ) : (
                        <div className="max-h-48 space-y-1 overflow-y-auto">
                            {preview.contents.cells.map(cell => {
                                const missing = cell.assetIds.length === 0;
                                const ambiguous = cell.assetIds.length > 1;
                                return (
                                    <div
                                        key={cell.label}
                                        className="flex items-baseline justify-between gap-2"
                                        data-asset-set-preview-cell={cell.label}
                                    >
                                        <FieldLabel as="span" className="mb-0 min-w-0 truncate">
                                            {assetSetCoordinateLabel(preview.set, cell.coordinate)}
                                        </FieldLabel>
                                        <span
                                            className={cn(
                                                "shrink-0 truncate text-2xs",
                                                missing || ambiguous ? "text-warning" : "text-fg-subtle",
                                            )}
                                        >
                                            {missing
                                                ? t("assets.sets.inspector.variantMissing")
                                                : ambiguous
                                                    ? t("assets.sets.inspector.variantAmbiguous", { count: String(cell.assetIds.length) })
                                                    : preview.names.get(cell.assetIds[0]) ?? cell.assetIds[0]}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((tag, index) => tag === right[index]);
}
