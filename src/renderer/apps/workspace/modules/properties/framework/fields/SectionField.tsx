import { useState, useCallback, memo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SectionFieldDefinition } from "../types";
import { FieldRenderer } from "./FieldRenderer";

interface SectionFieldProps<TData> {
    field: SectionFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

/**
 * Renders a collapsible section containing nested fields
 */
function SectionFieldInner<TData>({ field, data, onSaving }: SectionFieldProps<TData>) {
    const [isCollapsed, setIsCollapsed] = useState(field.defaultCollapsed ?? false);

    const toggleCollapse = useCallback(() => {
        if (field.collapsible) {
            setIsCollapsed((prev) => !prev);
        }
    }, [field.collapsible]);

    return (
        <div className={`border border-white/10 rounded-md overflow-visible ${field.className || ""}`}>
            <div
                className={`flex items-center gap-2 px-3 py-2 bg-[#1e1f22] ${
                    field.collapsible ? "cursor-pointer hover:bg-[#252629]" : ""
                }`}
                onClick={toggleCollapse}
            >
                {field.collapsible && (
                    <span className="text-gray-400">
                        {isCollapsed ? (
                            <ChevronRight className="w-4 h-4" />
                        ) : (
                            <ChevronDown className="w-4 h-4" />
                        )}
                    </span>
                )}
                <span className="text-sm font-medium text-gray-300">{field.title}</span>
            </div>
            {!isCollapsed && (
                <div className="p-3 space-y-3">
                    {field.fields.map((nestedField) => (
                        <FieldRenderer
                            key={nestedField.id}
                            field={nestedField}
                            data={data}
                            onSaving={onSaving}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export const SectionField = memo(SectionFieldInner) as typeof SectionFieldInner;
