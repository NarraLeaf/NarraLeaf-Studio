/**
 * Making an asset set out of the files an author selected.
 *
 * Two questions, and both are answered from lists the project already has: what this set varies by,
 * and which file is which. The author never types a tag category, a value, or a resolution time -
 * every one of those was a second copy of something the project already knew, and getting one of
 * them wrong showed up much later as a variant with no file.
 *
 * ## Sub-sets rather than a grid
 *
 * A set varies by one thing. Art that varies by edition *and* by language is a set of editions with
 * a set of languages under one of them, made by selecting those files and opening this dialog again
 * from that value. Nothing here combines two kinds of variation on its own.
 *
 * ## The preview is the same computation as the write
 *
 * Both come from `@shared/types/assetSetPlan`. A preview computed separately from the write is a
 * dialog that can show a set the project does not get, and this dialog exists precisely so that the
 * author sees the holes before committing rather than after.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { Input, Select } from "@/lib/components/elements";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { AppTagService } from "@/lib/workspace/services/appTag/AppTagService";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import { UuidService } from "@/lib/workspace/services/core/UuidService";
import type { AssetSetService } from "@/lib/workspace/services/assets/AssetSetService";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { ASSET_CATEGORY_TYPES, AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSelector } from "./AssetSelector";
import { AssetThumbnail } from "./AssetThumbnail";
import { ASSET_SET_AXIS_KINDS, type AssetSet, type AssetSetAxisKind } from "@shared/types/assetSet";
import {
    planAssetSet,
    suggestAssetSetMembers,
    type AssetSetPlanFile,
    type AssetSetPlanValue,
} from "@shared/types/assetSetPlan";

export interface AssetSetWizardProps {
    /**
     * The rows the author marked, when they started from files. All of one type; the caller refuses
     * a mixed selection.
     *
     * Empty when they started from a folder instead. Either way the dialog is the same: the marked
     * files are a head start on which file answers which variant, never a limit on it - the picker
     * below reaches the whole library.
     *
     * Mounted only while the dialog is up, so every reading below starts from this selection rather
     * than from whatever the last one left behind.
     */
    assets: Asset[];
    /** The section a set made from a folder belongs to. Ignored when the files say it themselves. */
    category?: AssetCategory;
    /** The folder the author was in. The set's row is drawn there rather than at the section's top. */
    groupId?: string;
    /** The set and value this one hangs under, when the author is making a sub-set. */
    parent?: { set: AssetSet; value: string };
    onClose: () => void;
}

export function AssetSetWizard({ assets, category, groupId, parent, onClose }: AssetSetWizardProps) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);

    /**
     * What the members are.
     *
     * Taken from the marked files when there are any - they are all of one type, which is what the
     * caller checks - and otherwise chosen here, because a section can stand for more than one
     * (Media is audio and video) and a set resolves within one type.
     */
    const offeredTypes = useMemo(
        () => (assets.length > 0 || !category ? [] : ASSET_CATEGORY_TYPES[category]),
        [assets.length, category],
    );
    const [chosenType, setChosenType] = useState<AssetType | null>(() => offeredTypes[0] ?? null);
    const type = assets[0]?.type ?? chosenType ?? undefined;

    /**
     * The two lists a set may vary by, read off the project.
     *
     * The editions include the release edition, which is a real answer: art that differs only in a
     * demo still needs to say which file the full game gets.
     */
    const valuesByKind = useMemo<Record<AssetSetAxisKind, AssetSetPlanValue[]>>(() => {
        const empty = { locale: [] as AssetSetPlanValue[], release: [] as AssetSetPlanValue[] };
        if (!context) {
            return empty;
        }
        try {
            const locales = context.services.get<LocalizationService>(Services.Localization)
                .getConfiguration().locales.map(locale => ({ value: locale.code, label: locale.displayName }));
            const editions = context.services.get<AppTagService>(Services.AppTags)
                .listTags().map(tag => ({ value: tag.id, label: tag.name }));
            return { locale: locales, release: editions };
        } catch {
            return empty;
        }
    }, [context]);

    // Opens on whichever kind the project can actually offer more than one of. A project with one
    // language and two editions is making an edition set; the reverse is the ordinary case.
    const [kind, setKind] = useState<AssetSetAxisKind>(
        () => (valuesByKind.locale.length > 1 ? "locale" : "release"),
    );
    const values = valuesByKind[kind];

    /**
     * Every file this dialog knows about: the marked ones, and the ones picked out of the library.
     *
     * Held here rather than read from the library on demand because the plan is computed from the
     * tags each file carries today, and the picker is the only place a file outside the selection
     * enters the dialog.
     */
    const [pickedAssets, setPickedAssets] = useState<Asset[]>([]);
    const candidates = useMemo<Asset[]>(() => {
        const byId = new Map<string, Asset>();
        for (const asset of [...assets, ...pickedAssets]) {
            if (!type || asset.type === type) {
                byId.set(asset.id, asset);
            }
        }
        return [...byId.values()];
    }, [assets, pickedAssets, type]);

    const files = useMemo<AssetSetPlanFile[]>(
        () => candidates.map(asset => ({ id: asset.id, name: asset.name, tags: asset.tags })),
        [candidates],
    );

    /** The value whose file is being picked, and the control the picker opens against. */
    const [picking, setPicking] = useState<AssetSetPlanValue | null>(null);
    const pickerAnchor = useRef<HTMLElement | null>(null);

    /**
     * Which file answers which value, guessed from the names and then owned by the author.
     *
     * Held as an override so that changing the kind reads the names again: an assignment made
     * against languages says nothing about editions.
     */
    const [override, setOverride] = useState<Record<string, string> | null>(null);
    const suggested = useMemo(() => suggestAssetSetMembers(files, values), [files, values]);
    const members = useMemo<ReadonlyMap<string, string>>(
        () => (override ? new Map(Object.entries(override).filter(([, id]) => id)) : suggested),
        [override, suggested],
    );

    const setId = useMemo(() => {
        try {
            return context?.services.get<UuidService>(Services.Uuid).generate() ?? "";
        } catch {
            return "";
        }
    }, [context]);

    const plan = useMemo(
        () => planAssetSet({ setId, kind, values, files, members, ...(parent ? { parent } : {}) }),
        [files, kind, members, parent, setId, values],
    );

    const filled = plan.members.size;
    const assetsById = useMemo(() => new Map(candidates.map(asset => [asset.id, asset])), [candidates]);

    const chooseKind = useCallback((next: AssetSetAxisKind) => {
        setKind(next);
        setOverride(null);
    }, []);

    // A different type is a different set of files, so nothing chosen against the old one survives.
    const chooseType = useCallback((next: AssetType) => {
        setChosenType(next);
        setPickedAssets([]);
        setOverride({});
    }, []);

    /** The files answering a value right now, in axis order. What the default name is read off. */
    const chosenAssets = useMemo<Asset[]>(
        () => [...plan.members.values()]
            .map(assetId => assetsById.get(assetId))
            .filter((asset): asset is Asset => !!asset),
        [assetsById, plan.members],
    );

    const chooseMember = useCallback((value: string, assetId: string) => {
        setOverride(current => {
            const next: Record<string, string> = { ...(current ?? Object.fromEntries(suggested)) };
            // One file answers one value: leaving it in both places would make the set ambiguous at
            // the value the author just moved it away from.
            for (const [key, id] of Object.entries(next)) {
                if (id === assetId && key !== value) {
                    delete next[key];
                }
            }
            next[value] = assetId;
            return next;
        });
    }, [suggested]);

    const create = useCallback(async () => {
        if (!context || !type || busy || !setId) {
            return;
        }
        setBusy(true);
        try {
            const assetsService = context.services.get<AssetsService>(Services.Assets);
            const setService = context.services.get<AssetSetService>(Services.AssetSets);
            // One transaction for the tags, so a set is never made against a library half-written.
            await assetsService.transaction(async service => {
                for (const [assetId, tags] of plan.tagsByFile) {
                    const asset = assetsById.get(assetId);
                    if (asset && !sameTags(tags, asset.tags)) {
                        await service.updateAssetTags(asset, tags);
                    }
                }
            });
            setService.createSet({
                id: setId,
                name: name.trim() || defaultName(chosenAssets),
                type: type as AssetType,
                filter: plan.filter,
                axis: plan.axis,
                ...(groupId ? { groupId } : {}),
            });
            onClose();
        } finally {
            setBusy(false);
        }
    }, [assetsById, busy, chosenAssets, context, groupId, name, onClose, plan, setId, type]);

    if (!type) {
        return null;
    }

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={parent ? t("assets.sets.create.subTitle") : t("assets.sets.create.title")}
            helpTopic="assetSets"
            size="lg"
            closeOnOverlayClick={!busy}
            footer={
                <div className="flex w-full items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
                        {values.length > 0
                            ? t("assets.sets.variantsResolved", {
                                resolved: String(filled),
                                total: String(values.length),
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
                        className={dialogFooterButtonClass({ variant: "primary", disabled: busy || filled === 0 })}
                        onClick={() => { void create(); }}
                        disabled={busy || filled === 0}
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
                        placeholder={defaultName(chosenAssets)}
                        onChange={event => setName(event.target.value)}
                    />
                </div>

                {offeredTypes.length > 1 && (
                    <div className="grid gap-1">
                        <FieldLabel as="div">{t("assets.sets.create.type")}</FieldLabel>
                        <Select
                            size="sm"
                            value={type ?? ""}
                            options={offeredTypes.map(entry => ({
                                value: entry,
                                label: t(`assets.types.${entry}`),
                            }))}
                            onChange={value => chooseType(value as AssetType)}
                            portalMenu
                            ariaLabel={t("assets.sets.create.type")}
                        />
                    </div>
                )}

                <div className="grid gap-1">
                    <FieldLabel as="div">{t("assets.sets.create.axis")}</FieldLabel>
                    <Select
                        size="sm"
                        value={kind}
                        options={ASSET_SET_AXIS_KINDS.map(entry => ({
                            value: entry,
                            label: t(`assets.sets.axisKind.${entry}`),
                        }))}
                        onChange={value => chooseKind(value as AssetSetAxisKind)}
                        // The menu leaves the dialog: a select near the bottom of a modal opens into
                        // the modal's own overflow otherwise, and its options are cut off.
                        portalMenu
                        ariaLabel={t("assets.sets.create.axis")}
                    />
                </div>

                <div className="space-y-1">
                    <FieldLabel as="div">{t("assets.sets.inspector.variants")}</FieldLabel>
                    {values.length === 0 ? (
                        <p className="text-2xs text-fg-subtle">{t(`assets.sets.create.no.${kind}`)}</p>
                    ) : (
                        <div className="max-h-56 space-y-1 overflow-y-auto">
                            {values.map(entry => {
                                const chosen = members.get(entry.value);
                                const asset = chosen ? assetsById.get(chosen) : undefined;
                                return (
                                    <div
                                        key={entry.value}
                                        className="flex items-center gap-2"
                                        data-asset-set-value={entry.value}
                                    >
                                        <FieldLabel as="span" className="mb-0 w-28 shrink-0 truncate">
                                            {entry.label}
                                        </FieldLabel>
                                        <button
                                            type="button"
                                            aria-label={entry.label}
                                            className={cn(
                                                "flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-edge",
                                                "px-2 py-1 text-2xs hover:bg-fill",
                                                asset ? "text-fg" : "text-warning",
                                            )}
                                            onClick={event => {
                                                pickerAnchor.current = event.currentTarget;
                                                setPicking(entry);
                                            }}
                                        >
                                            {asset && (
                                                <AssetThumbnail asset={asset} className="h-5 w-6 shrink-0 rounded-sm" />
                                            )}
                                            <span className="min-w-0 truncate">
                                                {asset?.name ?? t("assets.sets.inspector.variantMissing")}
                                            </span>
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {picking && type && (
                <AssetSelector
                    visible
                    assetType={type as AssetType}
                    selectedIds={members.get(picking.value) ? [members.get(picking.value)!] : []}
                    anchorRef={pickerAnchor}
                    title={picking.label}
                    onClose={() => setPicking(null)}
                    onConfirm={chosen => {
                        const asset = chosen[0];
                        setPicking(null);
                        if (!asset) {
                            return;
                        }
                        // Kept, because the plan reads the tags this file carries today and the
                        // library list the picker drew from is gone the moment it closes.
                        setPickedAssets(current => (
                            current.some(entry => entry.id === asset.id) ? current : [...current, asset]
                        ));
                        chooseMember(picking.value, asset.id);
                    }}
                />
            )}
        </Modal>
    );
}

/** What the set is called when the author does not say: the part of the names they have in common. */
function defaultName(assets: readonly Asset[]): string {
    const [first, ...rest] = assets.map(asset => asset.name);
    if (!first) {
        return "";
    }
    let shared = first;
    for (const name of rest) {
        let index = 0;
        while (index < shared.length && index < name.length && shared[index] === name[index]) {
            index += 1;
        }
        shared = shared.slice(0, index);
    }
    // Trimmed of the separator the common part ends on, so `title_en` and `title_zh` suggest
    // `title` rather than `title_`.
    return shared.replace(/[\s_\-.·・|]+$/u, "") || first;
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((tag, index) => tag === right[index]);
}
