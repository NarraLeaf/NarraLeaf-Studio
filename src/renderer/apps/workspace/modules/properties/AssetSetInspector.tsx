/**
 * The inspector for one asset set: its axes, and what the library currently answers for them.
 *
 * Two halves, and the order is deliberate. The axes come first because they are the declaration - the
 * thing the author edits - and the variant list under them is the reading, which changes only because
 * the declaration or the library did. An author who moves an axis sees the list below rebuild, which
 * is the whole feedback loop this panel exists to close.
 *
 * ## Where the refusal lives
 *
 * A build axis may not sit inside a runtime one (see `@shared/types/assetSet`). This panel refuses
 * the move rather than reporting it afterwards: the arrangement has no build that satisfies it, so
 * there is no state worth letting the document reach. `AssetSetService.setAxes` refuses it a second
 * time, which is what holds if a set is ever edited from somewhere this panel is not.
 *
 * The refusal is shown as a sentence under the axis list and the control stays where it was. It is
 * not a disabled button: which moves are legal depends on the other axes, so a permanently greyed
 * arrow would be greyed on rows where the move is fine.
 *
 * ## The variant list is where a hole gets filled
 *
 * Each row picks a file, and choosing one writes that coordinate's tags onto it. Membership is still
 * the tag - nothing here stores an id - but the author no longer has to leave the panel that told
 * them a variant was missing in order to go and say which file it is.
 *
 * Writing replaces the value that file carried for each of the coordinate's categories, because two
 * values of one category make a file answer to two coordinates at once. Nothing is taken off any
 * *other* file: a file that answered to this coordinate before still carries its own tags, and the
 * row will say so by reporting two matches rather than by quietly picking one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layers } from "lucide-react";
import {
    ASSET_SET_AXIS_KINDS,
    assetSetCoordinateTags,
    makeAssetSetAxis,
    assetSetParent,
    collectAssetTagVocabulary,
    isLegalNesting,
    parseAssetTag,
    resolveAssetSetContents,
    type AssetSet,
    type AssetSetAxisKind,
    type AssetSetCandidate,
    type AssetSetCell,
} from "@shared/types/assetSet";
import { FieldLabel, IconButton, Input, Select } from "@/lib/components/elements";
import { SectionCard } from "@/lib/components/elements/SectionCard";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import type { AssetSetService } from "@/lib/workspace/services/assets/AssetSetService";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { AppTagService } from "@/lib/workspace/services/appTag/AppTagService";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import { AssetThumbnail } from "@/apps/workspace/modules/assets/components/AssetThumbnail";

/**
 * A text field that keeps what is typed and commits it when focus leaves.
 *
 * The same bargain the other inspector text fields make, and needed for the same reason: what is
 * stored is trimmed and de-duplicated on the way in, so a per-keystroke write would take a space
 * back out from under the cursor.
 */
function DraftInput({
    value,
    placeholder,
    disabled,
    onCommit,
    className,
}: {
    value: string;
    placeholder?: string;
    disabled?: boolean;
    onCommit: (next: string) => void;
    className?: string;
}) {
    const [draft, setDraft] = useState(value);
    const [editing, setEditing] = useState(false);

    useEffect(() => {
        if (!editing) {
            setDraft(value);
        }
    }, [editing, value]);

    return (
        <Input
            size="sm"
            fullWidth
            className={cn("min-w-0", className)}
            value={draft}
            placeholder={placeholder}
            disabled={disabled}
            onFocus={() => setEditing(true)}
            onChange={event => setDraft(event.target.value)}
            onBlur={() => {
                setEditing(false);
                if (draft !== value) {
                    onCommit(draft);
                }
            }}
            onKeyDown={event => {
                if (event.key === "Enter") {
                    event.currentTarget.blur();
                }
            }}
        />
    );
}

/** The values of one axis, written as one comma-separated field. */
function parseValues(text: string): string[] {
    return text.split(",").map(part => part.trim()).filter(Boolean);
}

export function AssetSetInspector({
    set,
    candidates,
    assetsById,
    service,
    assetsService,
}: {
    set: AssetSet;
    /** The library, as resolution sees it. */
    candidates: readonly AssetSetCandidate[];
    /**
     * The library by id, so a resolved variant shows the picture and the name rather than a uuid.
     *
     * The picture is what an author recognises a variant by. A column of file names answers "is this
     * set complete" and nothing else; a column of thumbnails answers "is this the right art", which
     * is the question a set is usually opened to settle.
     */
    assetsById: ReadonlyMap<string, Asset>;
    service: AssetSetService;
    /** Where a chosen file's tags are written. Null while the library has not loaded. */
    assetsService: AssetsService | null;
}) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const freeze = useFreezeGuard();
    const [blocked, setBlocked] = useState(false);
    // The document changes under this panel whenever a sub-set is made or renamed, and what a value
    // resolves to depends on it.
    const [revision, setRevision] = useState(0);
    /**
     * What each kind ranges over in this project.
     *
     * Read here rather than stored on the set, because switching kinds has to re-state the promise:
     * a set that was language-shaped and is now edition-shaped promises editions.
     */
    const localeValues = useMemo(() => {
        try {
            return context!.services.get<LocalizationService>(Services.Localization)
                .getConfiguration().locales.map(locale => locale.code);
        } catch {
            return [];
        }
    }, [context]);
    const editionValues = useMemo(() => {
        try {
            return context!.services.get<AppTagService>(Services.AppTags).listTags().map(tag => tag.id);
        } catch {
            return [];
        }
    }, [context]);
    useEffect(() => service.onSetsChanged(() => setRevision(current => current + 1)), [service]);
    const [picking, setPicking] = useState<AssetSetCell | null>(null);
    const pickerAnchor = useRef<HTMLElement | null>(null);

    // Only the categories files of this set's own type carry. A picture set offered `voice:alice`
    // would be offering an axis that can never resolve.
    const vocabulary = useMemo(
        () => collectAssetTagVocabulary(candidates.filter(candidate => candidate.type === set.type)),
        [candidates, set.type],
    );

    // Every set in the project, because what a value resolves to may be one level down and because
    // the nesting rule is a statement about this set and the one it hangs under.
    const sets = useMemo(() => service.listSets(), [service, revision]);
    const contents = useMemo(() => resolveAssetSetContents(set, candidates, sets), [set, candidates, sets]);

    /**
     * Write a new axis list, refusing an arrangement that has no build.
     *
     * The flag is cleared by every accepted write, so the sentence goes away as soon as the author
     * does something the model allows - rather than staying until they select something else.
     */
    /**
     * Change what this set varies by.
     *
     * The values come with the kind, read off the project - so switching a set from languages to
     * editions re-states what it promises rather than leaving it promising language codes under an
     * edition axis.
     */
    const patchAxis = useCallback((kind: AssetSetAxisKind) => {
        const next = makeAssetSetAxis(kind, kind === "locale" ? localeValues : editionValues);
        const parent = assetSetParent(set, sets);
        if (parent && !isLegalNesting(parent.set.axis, next)) {
            setBlocked(true);
            return;
        }
        setBlocked(false);
        service.setAxis(set.id, next);
    }, [service, set, sets]);

    /**
     * Make one file the answer to one coordinate, by writing that coordinate onto it.
     *
     * The set's fixed tags go on too, not just the axis values: a file that carries `mood:sad` but
     * not `char:alice` is not a member of this set, and an author who picked it from the list plainly
     * meant it to be one.
     */
    const assign = useCallback(async (cell: AssetSetCell, asset: Asset) => {
        if (!assetsService) {
            return;
        }
        const written = assetSetCoordinateTags(set, cell.coordinate);
        const claimed = new Set(
            written.map(tag => parseAssetTag(tag)?.category).filter((category): category is string => Boolean(category)),
        );
        const kept = asset.tags.filter(tag => {
            const pair = parseAssetTag(tag);
            return !pair || !claimed.has(pair.category);
        });
        await assetsService.updateAssetTags(asset, [...kept, ...written]);
    }, [assetsService, set]);

    return (
        <div className="p-3 space-y-3" data-help-topic="assetSetAxes">
            <SectionCard title={t("assets.sets.inspector.axes")} bodyClassName="space-y-3">
                {/* The kind, and nothing else. What tag it reads, when it resolves and what it
                    ranges over all follow from it, and each of them offered as a field was a way for
                    an author to say something the project would then refuse. */}
                <Select
                    size="sm"
                    fullWidth
                    value={set.axis.kind}
                    options={ASSET_SET_AXIS_KINDS.map(entry => ({
                        value: entry,
                        label: t(`assets.sets.axisKind.${entry}`),
                    }))}
                    onChange={value => patchAxis(value as AssetSetAxisKind)}
                    ariaLabel={t("assets.sets.inspector.axes")}
                    {...freeze.writes()}
                />
                {blocked && (
                    <p className="text-2xs text-warning">{t("assets.sets.inspector.residencyBlocked")}</p>
                )}
            </SectionCard>

            {set.filter.length > 0 && (
                <SectionCard title={t("assets.sets.inspector.filter")} bodyClassName="space-y-1">
                    <p className="text-2xs text-fg-subtle break-words">{set.filter.join(" · ")}</p>
                </SectionCard>
            )}

            <SectionCard title={t("assets.sets.inspector.variants")} bodyClassName="space-y-1">
                {contents.cells.length === 0 ? (
                    <p className="text-2xs text-fg-subtle">{t("assets.sets.inspector.noVariants")}</p>
                ) : (
                    contents.cells.map(cell => {
                        const missing = cell.assetIds.length === 0;
                        const ambiguous = cell.assetIds.length > 1;
                        const resolved = missing || ambiguous ? null : assetsById.get(cell.assetIds[0]) ?? null;
                        return (
                            <div
                                key={cell.label}
                                className="flex items-center justify-between gap-2"
                                data-asset-set-variant={cell.label}
                            >
                                <FieldLabel as="span" className="mb-0 min-w-0 truncate">{cell.label}</FieldLabel>
                                <button
                                    type="button"
                                    aria-label={cell.label}
                                    className={cn(
                                        "flex min-w-0 shrink items-center gap-1.5 rounded-md px-1.5 py-0.5 text-2xs transition-colors",
                                        "hover:bg-edge-subtle disabled:cursor-not-allowed disabled:opacity-50",
                                        missing || ambiguous ? "text-warning" : "text-fg-subtle",
                                    )}
                                    {...freeze.writes(!assetsService)}
                                    onClick={event => {
                                        pickerAnchor.current = event.currentTarget;
                                        setPicking(cell);
                                    }}
                                >
                                    {resolved && (
                                        <AssetThumbnail asset={resolved} className="h-5 w-6 shrink-0 rounded-sm" />
                                    )}
                                    <span className="min-w-0 truncate">
                                        {missing
                                            ? t("assets.sets.inspector.variantMissing")
                                            : ambiguous
                                                ? t("assets.sets.inspector.variantAmbiguous", { count: String(cell.assetIds.length) })
                                                : resolved?.name ?? cell.assetIds[0]}
                                    </span>
                                </button>
                            </div>
                        );
                    })
                )}
            </SectionCard>

            {picking && (
                <AssetSelector
                    visible
                    assetType={set.type as AssetType}
                    selectedIds={picking.assetIds.slice(0, 1)}
                    anchorRef={pickerAnchor}
                    title={picking.label}
                    onClose={() => setPicking(null)}
                    onConfirm={assets => {
                        const chosen = assets[0];
                        setPicking(null);
                        if (chosen) {
                            void assign(picking, chosen);
                        }
                    }}
                />
            )}
        </div>
    );
}
