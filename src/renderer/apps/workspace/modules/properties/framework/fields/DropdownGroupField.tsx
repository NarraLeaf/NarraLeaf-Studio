import { useCallback } from "react";
import { Select } from "@/lib/components/elements/Select";
import { DropdownGroupFieldDefinition } from "../types";
import { FieldLayout } from "./FieldLayout";

interface DropdownGroupFieldProps<TData> {
    field: DropdownGroupFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

export function DropdownGroupField<TData>({
    field,
    data,
    onSaving,
}: DropdownGroupFieldProps<TData>) {
    const handleChange = useCallback(
        async (dropdownId: string, value: string | number) => {
            const dropdown = field.dropdowns.find((entry) => entry.id === dropdownId);
            if (!dropdown) return;
            onSaving(true);
            try {
                await dropdown.setValue(data, value);
            } catch (error) {
                console.error("DropdownGroupField: failed to save selection", error);
            } finally {
                onSaving(false);
            }
        },
        [data, field, onSaving]
    );

    const gap = field.gap ?? 8;
    const shouldWrap = field.wrap ?? true;

    return (
        <FieldLayout field={field}>
            <div
                className={`flex ${shouldWrap ? "flex-wrap" : "flex-nowrap"}`}
                style={{ gap: `${gap}px` }}
            >
                {field.dropdowns.map((dropdown) => {
                    const currentValue = dropdown.getValue(data);
                    return (
                        <div key={dropdown.id} className={`flex-1 min-w-[120px] ${dropdown.className ?? ""}`}>
                            {dropdown.label && (
                                <span className="text-[10px] uppercase tracking-wider text-gray-500">
                                    {dropdown.label}
                                </span>
                            )}
                            <Select
                                options={dropdown.options}
                                value={currentValue ?? undefined}
                                onChange={(value) => handleChange(dropdown.id, value)}
                                placeholder={dropdown.placeholder}
                                disabled={field.disabled || dropdown.disabled}
                                className="mt-1"
                            />
                        </div>
                    );
                })}
            </div>
        </FieldLayout>
    );
}
