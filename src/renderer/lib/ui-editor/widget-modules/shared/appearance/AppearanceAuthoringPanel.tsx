import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Star, Trash2 } from "lucide-react";
import type {
    AppearanceModel,
    AppearancePropertyGroup,
    AppearanceRowValue,
    AppearanceValueRow,
    AppearanceVariant,
    ButtonAppearancePropertyKey,
    ContainerAppearancePropertyKey,
} from "@shared/types/ui-editor/appearance";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { Select } from "@/lib/components/elements/Select";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import {
    addRowToGroup,
    addVariant,
    newVariantId,
    removeRowFromGroup,
    removeVariant,
    renameVariant,
    replaceVariant,
    setDefaultVariantId,
    setRowConditions,
    updateRowInGroup,
} from "./appearancePatch";
import { isUsableAppearanceModel } from "./initialAppearanceModel";
import { ConditionRowToggles } from "./editors/ConditionRowToggles";
import { ContainerAppearanceValueEditor } from "./editors/containerValueEditor";
import { ButtonAppearanceValueEditor } from "./editors/buttonValueEditor";

export type AppearanceAuthoringPanelProps = {
    kind: "container" | "button";
    appearance: AppearanceModel | null | undefined;
    onReplace: (next: AppearanceModel) => void;
    inspectorData: UIInspectorData;
    draftResetKey: string;
};

function formatKeyLabel(key: string): string {
    return key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, s => s.toUpperCase())
        .trim();
}

function cloneVariantShallow(source: AppearanceVariant, id: string, name: string): AppearanceVariant {
    return {
        id,
        name,
        propertyGroups: JSON.parse(JSON.stringify(source.propertyGroups)) as AppearancePropertyGroup[],
    };
}

export function AppearanceAuthoringPanel({
    kind,
    appearance,
    onReplace,
    inspectorData,
    draftResetKey,
}: AppearanceAuthoringPanelProps) {
    const [selectedVariantId, setSelectedVariantId] = useState<string>(() =>
        isUsableAppearanceModel(appearance) ? appearance.defaultVariantId : ""
    );

    useEffect(() => {
        if (!isUsableAppearanceModel(appearance)) {
            return;
        }
        setSelectedVariantId(prev =>
            appearance.variants.some(v => v.id === prev) ? prev : appearance.defaultVariantId
        );
    }, [appearance]);

    const model = appearance;
    const selectedVariant = useMemo(() => {
        if (!isUsableAppearanceModel(model)) {
            return null;
        }
        return model.variants.find(v => v.id === selectedVariantId) ?? model.variants[0] ?? null;
    }, [model, selectedVariantId]);

    const commitVariant = useCallback(
        (nextVariant: AppearanceVariant) => {
            if (!isUsableAppearanceModel(model) || !selectedVariant) {
                return;
            }
            onReplace(replaceVariant(model, selectedVariant.id, nextVariant));
        },
        [model, onReplace, selectedVariant]
    );

    if (!isUsableAppearanceModel(model)) {
        return (
            <p className="text-xs text-amber-200/90 leading-relaxed px-1 py-2">
                Appearance data is missing or invalid for this element. This editor requires a serialized appearance
                model. Create a new element from the palette to get a valid appearance block.
            </p>
        );
    }

    const variantOptions = model.variants.map(v => ({ value: v.id, label: v.name || v.id }));

    const handleAddVariant = () => {
        const base = selectedVariant ?? model.variants[0];
        if (!base) {
            return;
        }
        const id = newVariantId();
        const nextName = `Variant ${model.variants.length + 1}`;
        const variant = cloneVariantShallow(base, id, nextName);
        onReplace(addVariant(model, variant));
        setSelectedVariantId(id);
    };

    const handleRemoveVariant = () => {
        if (!selectedVariant || model.variants.length <= 1) {
            return;
        }
        const removedId = selectedVariant.id;
        const nextModel = removeVariant(model, removedId);
        onReplace(nextModel);
        setSelectedVariantId(nextModel.defaultVariantId);
    };

    const handleSetDefault = () => {
        if (!selectedVariant) {
            return;
        }
        onReplace(setDefaultVariantId(model, selectedVariant.id));
    };

    const handleRenameVariant = (raw: string) => {
        if (!selectedVariant) {
            return;
        }
        onReplace(renameVariant(model, selectedVariant.id, raw));
    };

    return (
        <div className="space-y-4 min-w-0">
            <p className="text-[10px] text-gray-500 leading-snug px-0.5">
                Within each property, the last matching row wins (default row first, then conditional overrides).
            </p>

            <div className="flex flex-wrap gap-2 items-center min-w-0">
                <div className="flex-1 min-w-[8rem]">
                    <Select
                        value={selectedVariant?.id ?? ""}
                        options={variantOptions}
                        fullWidth
                        onChange={v => setSelectedVariantId(String(v))}
                    />
                </div>
                <button
                    type="button"
                    title="Add variant (duplicate current)"
                    onClick={handleAddVariant}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10"
                >
                    <Plus className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    title="Set as default variant"
                    onClick={handleSetDefault}
                    disabled={!selectedVariant || model.defaultVariantId === selectedVariant.id}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-40"
                >
                    <Star className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    title="Delete variant"
                    onClick={handleRemoveVariant}
                    disabled={model.variants.length <= 1}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>

            <div className="min-w-0">
                <label className="text-[10px] uppercase tracking-wide text-gray-500 block mb-1">Variant name</label>
                <EnhancedInput
                    key={selectedVariant?.id}
                    value={selectedVariant?.name ?? ""}
                    onChange={handleRenameVariant}
                    className="text-xs"
                />
            </div>

            {selectedVariant && (
                <div className="space-y-6 min-w-0">
                    {selectedVariant.propertyGroups.map(group => {
                        const groupKey = group.key;
                        return (
                            <div
                                key={groupKey}
                                className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-2 min-w-0"
                            >
                                <div className="text-xs font-medium text-gray-200">{formatKeyLabel(groupKey)}</div>
                                <div className="space-y-3">
                                    {group.rows.map((row, rowIndex) => (
                                        <div
                                            key={`${groupKey}-${rowIndex}`}
                                            className="rounded-md border border-white/5 bg-white/[0.03] p-2 space-y-2"
                                        >
                                            {rowIndex === 0 ? (
                                                <div className="text-[10px] text-gray-500">Default row</div>
                                            ) : (
                                                <ConditionRowToggles
                                                    conditions={row.conditions}
                                                    onChange={next => {
                                                        const v = setRowConditions(selectedVariant, groupKey, rowIndex, next);
                                                        commitVariant(v);
                                                    }}
                                                />
                                            )}
                                            <div className="min-w-0">
                                                {kind === "container" ? (
                                                    <ContainerAppearanceValueEditor
                                                        fieldKey={groupKey as ContainerAppearancePropertyKey}
                                                        value={row.value}
                                                        onChange={nextVal => {
                                                            const vTyped = nextVal as AppearanceRowValue;
                                                            const nextRow: AppearanceValueRow =
                                                                rowIndex === 0
                                                                    ? { conditions: null, value: vTyped }
                                                                    : { ...row, value: vTyped };
                                                            const v = updateRowInGroup(
                                                                selectedVariant,
                                                                groupKey,
                                                                rowIndex,
                                                                nextRow
                                                            );
                                                            commitVariant(v);
                                                        }}
                                                        draftResetKey={`${draftResetKey}-${groupKey}-${rowIndex}`}
                                                        inspectorData={inspectorData}
                                                        onSaving={saving => {
                                                            void saving;
                                                        }}
                                                    />
                                                ) : (
                                                    <ButtonAppearanceValueEditor
                                                        fieldKey={groupKey as ButtonAppearancePropertyKey}
                                                        value={row.value}
                                                        onChange={nextVal => {
                                                            const vTyped = nextVal as AppearanceRowValue;
                                                            const nextRow: AppearanceValueRow =
                                                                rowIndex === 0
                                                                    ? { conditions: null, value: vTyped }
                                                                    : { ...row, value: vTyped };
                                                            const v = updateRowInGroup(
                                                                selectedVariant,
                                                                groupKey,
                                                                rowIndex,
                                                                nextRow
                                                            );
                                                            commitVariant(v);
                                                        }}
                                                        draftResetKey={`${draftResetKey}-${groupKey}-${rowIndex}`}
                                                    />
                                                )}
                                            </div>
                                            {rowIndex > 0 && (
                                                <button
                                                    type="button"
                                                    className="text-[10px] text-red-400 hover:underline"
                                                    onClick={() => {
                                                        const v = removeRowFromGroup(
                                                            selectedVariant,
                                                            groupKey,
                                                            rowIndex
                                                        );
                                                        commitVariant(v);
                                                    }}
                                                >
                                                    Remove row
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        className="text-xs text-primary hover:underline"
                                        onClick={() => {
                                            const last = group.rows[group.rows.length - 1];
                                            const newRow: AppearanceValueRow = {
                                                conditions: { hovered: true },
                                                value: last?.value ?? null,
                                            };
                                            const v = addRowToGroup(selectedVariant, groupKey, newRow);
                                            commitVariant(v);
                                        }}
                                    >
                                        + Add conditional row
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
