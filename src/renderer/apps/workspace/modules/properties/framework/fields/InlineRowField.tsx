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

    return (
        <FieldLayout field={field}>
            <div
                className={`flex items-center ${shouldWrap ? "flex-wrap" : "flex-nowrap"}`}
                style={{ gap: `${gap}px` }}
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
