import { useCallback, useMemo } from "react";
import {
    IconButtonGroupFieldDefinition,
    IconButtonSelection,
    IconButtonGroupMode,
} from "../types";
import { FieldLayout } from "./FieldLayout";

interface IconButtonGroupFieldProps<TData> {
    field: IconButtonGroupFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

const groupColors = {
    base: "bg-[#1c1d20]",
    border: "border border-white/10",
    active: "bg-white/10 text-white",
    idle: "bg-transparent text-gray-300 hover:bg-white/10",
};

export function IconButtonGroupField<TData>({
    field,
    data,
    onSaving,
}: IconButtonGroupFieldProps<TData>) {
    const mode = field.mode ?? "single";
    const selection = field.getValue(data);
    const showLabels = field.showLabels ?? true;

    const handleOptionClick = useCallback(
        async (optionId: string, disabled?: boolean) => {
            if (field.disabled || disabled) return;
            let nextValue: IconButtonSelection = selection;

            if (mode === "multiple") {
                const current = Array.isArray(selection) ? selection : [];
                const hasValue = current.includes(optionId);
                nextValue = hasValue
                    ? current.filter((value) => value !== optionId)
                    : [...current, optionId];
            } else if (mode === "single") {
                nextValue = optionId;
            } else {
                nextValue = optionId;
            }

            onSaving(true);
            try {
                await field.setValue(data, nextValue);
            } catch (error) {
                console.error("IconButtonGroupField: failed to save selection", error);
            } finally {
                onSaving(false);
            }
        },
        [data, field, mode, onSaving, selection]
    );

    const resolvedSelection = useMemo(() => {
        if (mode === "multiple") {
            return Array.isArray(selection) ? selection : [];
        }
        if (mode === "single") {
            return typeof selection === "string" ? selection : null;
        }
        return null;
    }, [mode, selection]);

    return (
        <FieldLayout field={field} className={field.className}>
            <div
                className={`flex divide-x divide-white/10 rounded-md overflow-hidden ${groupColors.border} ${groupColors.base}`}
            >
                {field.options.map((option, index) => {
                    const isActive =
                        mode === "multiple"
                            ? Array.isArray(resolvedSelection) && resolvedSelection.includes(option.id)
                            : mode === "single"
                            ? resolvedSelection === option.id
                            : false;

                    return (
                        <button
                            key={option.id}
                            type="button"
                            className={`flex-1 px-3 py-2 transition ${
                                isActive ? groupColors.active : groupColors.idle
                            }`}
                            onClick={() => handleOptionClick(option.id, option.disabled)}
                            disabled={field.disabled || option.disabled}
                            aria-pressed={isActive}
                            title={option.label}
                        >
                            <div
                                className={`flex items-center justify-center ${
                                    showLabels && option.label ? "gap-2" : ""
                                }`}
                            >
                                <span className="text-base">{option.icon}</span>
                                {showLabels && option.label && (
                                    <span className="text-xs uppercase tracking-wide">
                                        {option.label}
                                    </span>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </FieldLayout>
    );
}
