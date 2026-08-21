import type { ReactNode } from "react";
import { FieldLabelRow } from "./FieldLabelRow";
import { BaseFieldDefinition } from "../types";

interface FieldLayoutProps {
    field: BaseFieldDefinition;
    children: ReactNode;
    className?: string;
}

/**
 * Shared wrapper that renders field label/help text for custom controls.
 */
export function FieldLayout({ field, children, className = "" }: FieldLayoutProps) {
    return (
        <div className={["min-w-0", className].filter(Boolean).join(" ")}>
            <FieldLabelRow field={field} />
            {children}
            {field.helpText && (
                <p className="mt-1 text-xs text-fg-subtle">{field.helpText}</p>
            )}
        </div>
    );
}
