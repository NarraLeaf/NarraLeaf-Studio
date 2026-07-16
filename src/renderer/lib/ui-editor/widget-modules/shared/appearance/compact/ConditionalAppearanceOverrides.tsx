import { useMemo, useState } from "react";
import { useTranslation } from "@/lib/i18n";
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
    const { t } = useTranslation();
    const [addTargetKey, setAddTargetKey] = useState<string>(() => addRowKeyOptions[0]?.value ?? "");

    const groupsWithExtraRows = useMemo(
        () => variant.propertyGroups.filter(g => g.rows.length > 1),
        [variant.propertyGroups]
    );

    const hasAny = groupsWithExtraRows.length > 0;

    return (
        <CollapsibleMiniSection
            title={t("widgetAppearance.conditions.overridesTitle")}
            defaultCollapsed={!hasAny}
            subtle={!hasAny}
        >
            <p className="text-2xs text-fg-subtle leading-snug px-0.5">
                {t("widgetAppearance.conditions.overridesHint")}
            </p>

            <div className="space-y-3 min-w-0">
                {groupsWithExtraRows.length > 0 ? (
                    <div className="text-2xs tracking-wide text-fg-subtle px-0.5">{t("widgetAppearance.conditions.conditionalRows")}</div>
                ) : null}
                {groupsWithExtraRows.map(group => {
                    const groupKey = group.key;
                    return (
                        <div
                            key={groupKey}
                            className="rounded-md border border-edge bg-fill-subtle p-2 space-y-2 min-w-0"
                        >
                            <div className="text-2xs font-medium text-fg-muted">{formatKeyLabel(groupKey)}</div>
                            {group.rows.map((row, rowIndex) => {
                                if (rowIndex === 0) return null;
                                return (
                                    <div
                                        key={`${groupKey}-${rowIndex}`}
                                        className="rounded border border-edge-subtle bg-fill-subtle p-2 space-y-2"
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
                                            className="text-2xs text-danger hover:underline"
                                            onClick={() => {
                                                const v = removeRowFromGroup(variant, groupKey, rowIndex);
                                                commitVariant(v);
                                            }}
                                        >
                                            {t("widgetAppearance.conditions.removeRow")}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}

                <div className="rounded-md border border-edge-subtle bg-fill-subtle p-2 space-y-2 min-w-0">
                    <div className="text-2xs tracking-wide text-fg-subtle">{t("widgetAppearance.conditions.addRowManually")}</div>
                    <p className="text-2xs text-fg-subtle leading-snug">
                        {t("widgetAppearance.conditions.addRowHint")}
                    </p>
                <div className="flex flex-wrap gap-2 items-end min-w-0 pt-1">
                    <div className="flex-1 min-w-[10rem]">
                        <label className="text-2xs tracking-wide text-fg-subtle block mb-1">
                            {t("widgetAppearance.conditions.property")}
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
                        {t("widgetAppearance.conditions.addRow")}
                    </button>
                </div>
                </div>
            </div>
        </CollapsibleMiniSection>
    );
}
