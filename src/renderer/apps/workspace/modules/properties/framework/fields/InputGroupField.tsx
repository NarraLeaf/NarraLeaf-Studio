import { useCallback } from "react";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { InputGroupFieldDefinition } from "../types";
import { FieldLayout } from "./FieldLayout";

interface InputGroupFieldProps<TData> {
    field: InputGroupFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

export function InputGroupField<TData>({ field, data, onSaving }: InputGroupFieldProps<TData>) {
    const handleInputChange = useCallback(
        async (item: InputGroupFieldDefinition<TData>["inputs"][number], raw: string) => {
            if (field.disabled || item.disabled) {
                return;
            }
            onSaving(true);
            try {
                await item.setValue(data, raw);
            } catch (error) {
                console.error("InputGroupField: failed to save value", error);
            } finally {
                onSaving(false);
            }
        },
        [data, field.disabled, onSaving]
    );

    const gap = field.gap ?? 8;
    const shouldWrap = field.wrap ?? true;

    return (
        <FieldLayout field={field}>
            <div
                className={`flex ${shouldWrap ? "flex-wrap" : "flex-nowrap"}`}
                style={{ gap: `${gap}px` }}
            >
                {field.inputs.map((item) => {
                    const value = item.getValue(data);
                    return (
                        <div
                            key={item.id}
                            className={`flex-1 min-w-[120px] space-y-1 ${item.className ?? ""}`}
                        >
                            {item.label && (
                                <span className="text-[10px] uppercase tracking-wider text-gray-500">
                                    {item.label}
                                </span>
                            )}
                            <EnhancedInput
                                value={value}
                                onChange={(next) => handleInputChange(item, next)}
                                placeholder={item.placeholder}
                                unit={item.unit}
                                leftIcon={item.icon}
                                type={item.type || "text"}
                                inputMode={item.type === "number" ? "decimal" : undefined}
                                disabled={field.disabled || item.disabled}
                                readOnly={field.readOnly || item.readOnly}
                                maxLength={item.maxLength}
                            />
                        </div>
                    );
                })}
            </div>
        </FieldLayout>
    );
}
