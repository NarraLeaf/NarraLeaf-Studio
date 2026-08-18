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
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import {
    ASSET_AXIS_RESIDENCIES,
    collectAssetTagVocabulary,
    isLegalAxisOrder,
    resolveAssetSetContents,
    type AssetSet,
    type AssetSetAxis,
    type AssetSetCandidate,
} from "@shared/types/assetSet";
import { FieldLabel, IconButton, Input, Select } from "@/lib/components/elements";
import { SectionCard } from "@/lib/components/elements/SectionCard";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import type { AssetSetService } from "@/lib/workspace/services/assets/AssetSetService";

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
    assetNames,
    service,
}: {
    set: AssetSet;
    /** The library, as resolution sees it. */
    candidates: readonly AssetSetCandidate[];
    /** Asset id to the name the library shows, so a resolved cell names a file rather than a uuid. */
    assetNames: ReadonlyMap<string, string>;
    service: AssetSetService;
}) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const [blocked, setBlocked] = useState(false);

    // Only the categories files of this set's own type carry. A picture set offered `voice:alice`
    // would be offering an axis that can never resolve.
    const vocabulary = useMemo(
        () => collectAssetTagVocabulary(candidates.filter(candidate => candidate.type === set.type)),
        [candidates, set.type],
    );

    const contents = useMemo(() => resolveAssetSetContents(set, candidates), [set, candidates]);

    /**
     * Write a new axis list, refusing an arrangement that has no build.
     *
     * The flag is cleared by every accepted write, so the sentence goes away as soon as the author
     * does something the model allows - rather than staying until they select something else.
     */
    const writeAxes = useCallback((next: AssetSetAxis[]) => {
        if (!isLegalAxisOrder(next)) {
            setBlocked(true);
            return;
        }
        setBlocked(false);
        service.setAxes(set.id, next);
    }, [service, set.id]);

    const patchAxis = useCallback((index: number, patch: Partial<AssetSetAxis>) => {
        writeAxes(set.axes.map((axis, position) => (position === index ? { ...axis, ...patch } : axis)));
    }, [set.axes, writeAxes]);

    const moveAxis = useCallback((index: number, delta: number) => {
        const target = index + delta;
        if (target < 0 || target >= set.axes.length) {
            return;
        }
        const next = [...set.axes];
        [next[index], next[target]] = [next[target], next[index]];
        writeAxes(next);
    }, [set.axes, writeAxes]);

    return (
        <div className="p-3 space-y-3">
            <SectionCard
                title={t("assets.sets.inspector.axes")}
                actions={
                    <IconButton
                        size="sm"
                        aria-label={t("assets.sets.inspector.addAxis")}
                        {...freeze.writes(false, t("assets.sets.inspector.addAxis"))}
                        onClick={() => writeAxes([...set.axes, { key: "", residency: "build", values: [] }])}
                    >
                        <Plus className="h-4 w-4" />
                    </IconButton>
                }
                bodyClassName="space-y-3"
            >
                {set.axes.map((axis, index) => (
                    <div key={`${axis.key}-${index}`} className="space-y-1.5">
                        <div className="flex items-center gap-2">
                            <DraftInput
                                value={axis.key}
                                placeholder={t("assets.sets.inspector.axisKey")}
                                {...freeze.writes()}
                                onCommit={next => patchAxis(index, { key: next })}
                                className="flex-1"
                            />
                            <Select
                                size="sm"
                                value={axis.residency}
                                options={ASSET_AXIS_RESIDENCIES.map(residency => ({
                                    value: residency,
                                    label: t(`assets.sets.inspector.residency.${residency}`),
                                }))}
                                onChange={value => patchAxis(index, { residency: value as AssetSetAxis["residency"] })}
                                {...freeze.writes()}
                            />
                            <IconButton
                                size="sm"
                                className="shrink-0"
                                aria-label={t("assets.sets.inspector.moveOut")}
                                {...freeze.writes(index === 0, t("assets.sets.inspector.moveOut"))}
                                onClick={() => moveAxis(index, -1)}
                            >
                                <ChevronUp className="h-4 w-4" />
                            </IconButton>
                            <IconButton
                                size="sm"
                                className="shrink-0"
                                aria-label={t("assets.sets.inspector.moveIn")}
                                {...freeze.writes(index === set.axes.length - 1, t("assets.sets.inspector.moveIn"))}
                                onClick={() => moveAxis(index, 1)}
                            >
                                <ChevronDown className="h-4 w-4" />
                            </IconButton>
                            <IconButton
                                size="sm"
                                className="shrink-0"
                                aria-label={t("assets.sets.inspector.removeAxis")}
                                {...freeze.writes(false, t("assets.sets.inspector.removeAxis"))}
                                onClick={() => writeAxes(set.axes.filter((_, position) => position !== index))}
                            >
                                <Trash2 className="h-4 w-4" />
                            </IconButton>
                        </div>
                        <DraftInput
                            value={axis.values.join(", ")}
                            // Seeded with what the library carries under this category, so an author
                            // who has tagged their files can read the values off the placeholder
                            // instead of remembering them.
                            placeholder={vocabulary.get(axis.key)?.join(", ") || t("assets.sets.inspector.axisValues")}
                            {...freeze.writes()}
                            onCommit={next => patchAxis(index, { values: parseValues(next) })}
                        />
                    </div>
                ))}
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
                        return (
                            <div key={cell.label} className="flex items-baseline justify-between gap-2">
                                <FieldLabel as="span" className="mb-0 min-w-0 truncate">{cell.label}</FieldLabel>
                                <span
                                    className={cn(
                                        "text-2xs shrink-0 truncate",
                                        missing || ambiguous ? "text-warning" : "text-fg-subtle",
                                    )}
                                >
                                    {missing
                                        ? t("assets.sets.inspector.variantMissing")
                                        : ambiguous
                                            ? t("assets.sets.inspector.variantAmbiguous", { count: String(cell.assetIds.length) })
                                            : assetNames.get(cell.assetIds[0]) ?? cell.assetIds[0]}
                                </span>
                            </div>
                        );
                    })
                )}
            </SectionCard>
        </div>
    );
}
