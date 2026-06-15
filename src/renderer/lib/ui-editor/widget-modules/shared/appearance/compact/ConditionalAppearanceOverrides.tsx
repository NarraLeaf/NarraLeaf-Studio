import { useMemo, useState } from "react";
import type {
    AppearanceRowValue,
    AppearanceValueRow,
    AppearanceVariant,
    ButtonAppearancePropertyKey,
    ContainerAppearancePropertyKey,
} from "@shared/types/ui-editor/appearance";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { Select } from "@/lib/components/elements/Select";
import {
    addRowToGroup,
    removeRowFromGroup,
    setRowConditions,
    updateRowInGroup,
} from "../appearancePatch";
import { ConditionRowToggles } from "../editors/ConditionRowToggles";
import { ContainerAppearanceValueEditor } from "../editors/containerValueEditor";
import { ButtonAppearanceValueEditor } from "../editors/buttonValueEditor";
import { CollapsibleMiniSection } from "./CollapsibleMiniSection";

function formatKeyLabel(key: string): string {
    return key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, s => s.toUpperCase())
        .trim();
}

type Props = {
    kind: "container" | "button";
    variant: AppearanceVariant;
    commitVariant: (v: AppearanceVariant) => void;
    inspectorData: UIInspectorData;
    draftResetKey: string;
    /** Keys offered in “add override” picker. */
    addRowKeyOptions: { value: string; label: string }[];
};

export function ConditionalAppearanceOverrides({
    kind,
    variant,
    commitVariant,
    inspectorData,
    draftResetKey,
    addRowKeyOptions,
}: Props) {
    const [addTargetKey, setAddTargetKey] = useState<string>(() => addRowKeyOptions[0]?.value ?? "");

    const groupsWithExtraRows = useMemo(
        () => variant.propertyGroups.filter(g => g.rows.length > 1),
        [variant.propertyGroups]
    );

    const hasAny = groupsWithExtraRows.length > 0;

    return (
        <CollapsibleMiniSection title="State overrides (advanced)" defaultCollapsed={!hasAny} subtle={!hasAny}>
            <p className="text-[10px] text-gray-500 leading-snug px-0.5">
                Prefer module headers for single-flag hover/active/disabled/focused overrides. Use this section to inspect
                rows, tweak compound conditions, or add per-property rows manually. Last matching row wins per property.
            </p>

            <div className="space-y-3 min-w-0">
                {groupsWithExtraRows.length > 0 ? (
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 px-0.5">Conditional rows</div>
                ) : null}
                {groupsWithExtraRows.map(group => {
                    const groupKey = group.key;
                    return (
                        <div
                            key={groupKey}
                            className="rounded-md border border-white/10 bg-white/[0.03] p-2 space-y-2 min-w-0"
                        >
                            <div className="text-[10px] font-medium text-gray-300">{formatKeyLabel(groupKey)}</div>
                            {group.rows.map((row, rowIndex) => {
                                if (rowIndex === 0) return null;
                                return (
                                    <div
                                        key={`${groupKey}-${rowIndex}`}
                                        className="rounded border border-white/5 bg-black/20 p-2 space-y-2"
                                    >
                                        <ConditionRowToggles
                                            conditions={row.conditions}
                                            onChange={next => {
                                                const v = setRowConditions(variant, groupKey, rowIndex, next);
                                                commitVariant(v);
                                            }}
                                        />
                                        <div className="min-w-0">
                                            {kind === "container" ? (
                                                <ContainerAppearanceValueEditor
                                                    fieldKey={groupKey as ContainerAppearancePropertyKey}
                                                    value={row.value}
                                                    onChange={nextVal => {
                                                        const vTyped = nextVal as AppearanceRowValue;
                                                        const nextRow: AppearanceValueRow = { ...row, value: vTyped };
                                                        const v = updateRowInGroup(
                                                            variant,
                                                            groupKey,
                                                            rowIndex,
                                                            nextRow
                                                        );
                                                        commitVariant(v);
                                                    }}
                                                    draftResetKey={`${draftResetKey}-${groupKey}-${rowIndex}`}
                                                    inspectorData={inspectorData}
                                                    onSaving={() => {}}
                                                />
                                            ) : (
                                                <ButtonAppearanceValueEditor
                                                    fieldKey={groupKey as ButtonAppearancePropertyKey}
                                                    value={row.value}
                                                    onChange={nextVal => {
                                                        const vTyped = nextVal as AppearanceRowValue;
                                                        const nextRow: AppearanceValueRow = { ...row, value: vTyped };
                                                        const v = updateRowInGroup(
                                                            variant,
                                                            groupKey,
                                                            rowIndex,
                                                            nextRow
                                                        );
                                                        commitVariant(v);
                                                    }}
                                                    draftResetKey={`${draftResetKey}-${groupKey}-${rowIndex}`}
                                                    inspectorData={inspectorData}
                                                    onSaving={() => {}}
                                                />
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            className="text-[10px] text-red-400 hover:underline"
                                            onClick={() => {
                                                const v = removeRowFromGroup(variant, groupKey, rowIndex);
                                                commitVariant(v);
                                            }}
                                        >
                                            Remove row
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}

                <div className="rounded-md border border-white/5 bg-black/15 p-2 space-y-2 min-w-0">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500">Add row manually</div>
                    <p className="text-[10px] text-gray-500 leading-snug">
                        Adds one conditional row for a single property key (default condition: hovered).
                    </p>
                <div className="flex flex-wrap gap-2 items-end min-w-0 pt-1">
                    <div className="flex-1 min-w-[10rem]">
                        <label className="text-[10px] uppercase tracking-wide text-gray-500 block mb-1">
                            Property
                        </label>
                        <Select
                            value={addTargetKey}
                            options={addRowKeyOptions}
                            fullWidth
                            onChange={v => setAddTargetKey(String(v))}
                        />
                    </div>
                    <button
                        type="button"
                        className="text-xs text-primary hover:underline shrink-0 pb-0.5"
                        onClick={() => {
                            if (!addTargetKey) return;
                            const g = variant.propertyGroups.find(gr => gr.key === addTargetKey);
                            const last = g?.rows[g.rows.length - 1];
                            const newRow: AppearanceValueRow = {
                                conditions: { hovered: true },
                                value: last?.value ?? null,
                            };
                            const v = addRowToGroup(variant, addTargetKey, newRow);
                            commitVariant(v);
                        }}
                    >
                        + Add row
                    </button>
                </div>
                </div>
            </div>
        </CollapsibleMiniSection>
    );
}
