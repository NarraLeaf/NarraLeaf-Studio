import type { ReactNode } from "react";
import { FieldLayout } from "./FieldLayout";
import type { InlineRowFieldDefinition, InlineRowItemContext } from "../types";

interface InlineRowFieldProps<TData> {
    field: InlineRowFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

export function InlineRowField<TData>({ field, data, onSaving }: InlineRowFieldProps<TData>) {
    const gap = field.gap ?? 8;
    const shouldWrap = field.wrap ?? true;
    const containerClass = [
        "flex",
        shouldWrap ? "flex-wrap" : "flex-nowrap",
        "items-stretch",
    ].join(" ");

    return (
        <FieldLayout field={field}>
            <div
                className={containerClass}
                style={{ gap: `${gap}px`, rowGap: `${gap}px`, columnGap: `${gap}px` }}
            >
                {field.items.map((item) => (
                    <div key={item.id} className={`flex items-center ${item.className ?? ""}`}>
                        {item.render({ data, onSaving })}
                    </div>
                ))}
            </div>
        </FieldLayout>
    );
}
