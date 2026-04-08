import { useCallback } from "react";
import type { IconButtonGroupFieldDefinition, IconButtonSelection } from "../types";
import { FieldLayout } from "./FieldLayout";
import { IconButtonSegGroup } from "./IconButtonSegGroup";

interface IconButtonGroupFieldProps<TData> {
    field: IconButtonGroupFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

export function IconButtonGroupField<TData>({
    field,
    data,
    onSaving,
}: IconButtonGroupFieldProps<TData>) {
    const mode = field.mode ?? "single";
    const selection = field.getValue(data);
    const showLabels = field.showLabels ?? true;

    const handleChange = useCallback(
        async (nextValue: IconButtonSelection) => {
            onSaving(true);
            try {
                await field.setValue(data, nextValue);
            } catch (error) {
                console.error("IconButtonGroupField: failed to save selection", error);
            } finally {
                onSaving(false);
            }
        },
        [data, field, onSaving]
    );

    if (mode === "multipleExclusivePrimary" && !field.exclusivePrimaryId) {
        console.warn("IconButtonGroupField: multipleExclusivePrimary requires exclusivePrimaryId");
    }

    return (
        <FieldLayout field={field} className={field.className}>
            <IconButtonSegGroup
                options={field.options}
                mode={mode}
                value={selection}
                onChange={handleChange}
                showLabels={showLabels}
                disabled={Boolean(field.disabled)}
                exclusivePrimaryId={field.exclusivePrimaryId}
                density={field.density}
            />
        </FieldLayout>
    );
}
