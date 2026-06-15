import { memo } from "react";
import { InfoFieldDefinition, InfoItem } from "../types";

interface InfoFieldProps<TData> {
    field: InfoFieldDefinition<TData>;
    data: TData;
}

/**
 * Renders a read-only info display field
 */
function InfoFieldInner<TData>({ field, data }: InfoFieldProps<TData>) {
    // Get items - can be static array or function
    const items: InfoItem<TData>[] =
        typeof field.items === "function" ? field.items(data) : field.items;

    // Filter visible items
    const visibleItems = items.filter((item) => {
        if (item.hidden === undefined) return true;
        if (typeof item.hidden === "function") {
            return !item.hidden(data);
        }
        return !item.hidden;
    });

    if (visibleItems.length === 0) {
        return null;
    }

    return (
        <div className={field.className}>
            {field.label && (
                <label className="block text-xs font-medium text-gray-400 mb-1">
                    {field.label}
                </label>
            )}
            <div className="bg-[#1e1f22] border border-white/10 rounded-md p-3 space-y-1">
                {visibleItems.map((item, index) => (
                    <div key={index} className="flex justify-between text-xs">
                        <span className="text-gray-400">{item.label}:</span>
                        <span className="text-gray-300">{item.getValue(data)}</span>
                    </div>
                ))}
            </div>
            {field.helpText && (
                <p className="mt-1 text-xs text-gray-500">{field.helpText}</p>
            )}
        </div>
    );
}

export const InfoField = memo(InfoFieldInner) as typeof InfoFieldInner;
