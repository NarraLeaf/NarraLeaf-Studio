import { useCallback, useState } from "react";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { InputGroupFieldDefinition } from "../types";
import { FieldLayout } from "./FieldLayout";

interface InputGroupFieldProps<TData> {
    field: InputGroupFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

export function InputGroupField<TData>({ field, data, onSaving }: InputGroupFieldProps<TData>) {
    const [draftById, setDraftById] = useState<Record<string, string>>({});

    const clearDraft = useCallback((itemId: string) => {
        setDraftById((prev) => {
            if (!(itemId in prev)) {
                return prev;
            }
            const { [itemId]: _removed, ...rest } = prev;
            return rest;
        });
    }, []);

    const handleInputChange = useCallback(
        async (item: InputGroupFieldDefinition<TData>["inputs"][number], raw: string) => {
            setDraftById((prev) => ({ ...prev, [item.id]: raw }));
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
    const containerClass = [
        "flex",
        shouldWrap ? "flex-wrap" : "flex-nowrap",
        "items-stretch",
    ].join(" ");

    return (
        <FieldLayout field={field} className={field.className}>
            <div
                className={containerClass}
                style={{ gap: `${gap}px`, rowGap: `${gap}px`, columnGap: `${gap}px` }}
            >
                {field.inputs.map((item) => {
                    const committed = item.getValue(data);
                    const hasDraft = Object.prototype.hasOwnProperty.call(draftById, item.id);
                    const value = hasDraft ? draftById[item.id] : committed;
                    const itemClassNames = [
                        "flex flex-col flex-1 min-w-0 space-y-1",
                        item.className,
                    ]
                        .filter(Boolean)
                        .join(" ");

                    return (
                        <div key={item.id} className={itemClassNames}>
                            {item.label && (
                                <span className="text-[10px] tracking-wider text-gray-500">
                                    {item.label}
                                </span>
                            )}
                            <EnhancedInput
                                value={value}
                                onChange={(next) => handleInputChange(item, next)}
                                onBlur={() => clearDraft(item.id)}
                                placeholder={item.placeholder}
                                unit={item.unit}
                                leftIcon={item.icon}
                                type={item.type || "text"}
                                inputMode={item.type === "number" ? "decimal" : undefined}
                                disabled={field.disabled || item.disabled}
                                readOnly={field.readOnly || item.readOnly}
                                maxLength={item.maxLength}
                                selectAllOnFocus={item.selectAllOnFocus}
                                precision={item.type === "number" ? (item.precision ?? null) : null}
                                popoverWhenNarrow
                                popoverThreshold={112}
                            />
                        </div>
                    );
                })}
            </div>
        </FieldLayout>
    );
}
