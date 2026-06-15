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
    // min-w-0: allow flex children to shrink below intrinsic width (avoids row overflow).
    // w-full: row participates in narrow sidebars so grow/shrink math uses full track width.
    const containerClass = [
        "flex w-full min-w-0",
        shouldWrap ? "flex-wrap" : "flex-nowrap",
        "items-stretch",
        field.className,
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <FieldLayout field={field}>
            <div
                className={containerClass}
                style={{ gap: `${gap}px`, rowGap: `${gap}px`, columnGap: `${gap}px` }}
            >
                {field.items.map((item) => (
                    <div
                        key={item.id}
                        className={`flex min-w-0 items-center ${item.className ?? ""}`}
                    >
                        {item.render({ data, onSaving })}
                    </div>
                ))}
            </div>
        </FieldLayout>
    );
}
