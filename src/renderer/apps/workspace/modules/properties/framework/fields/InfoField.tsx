import { memo } from "react";
import { FieldLabelRow } from "./FieldLabelRow";
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
            <FieldLabelRow field={field} />
            {/* Read-only values draw no box: label muted on the left, value in the text colour on the right, no colon. */}
            <dl className="m-0 space-y-1">
                {visibleItems.map((item, index) => (
                    <div key={index} className="flex min-w-0 justify-between gap-3 text-xs">
                        <dt className="shrink-0 text-fg-muted">{item.label}</dt>
                        <dd className="m-0 min-w-0 truncate text-right tabular-nums text-fg">{item.getValue(data)}</dd>
                    </div>
                ))}
            </dl>
            {field.helpText && (
                <p className="mt-1 text-2xs text-fg-subtle">{field.helpText}</p>
            )}
        </div>
    );
}

export const InfoField = memo(InfoFieldInner) as typeof InfoFieldInner;
