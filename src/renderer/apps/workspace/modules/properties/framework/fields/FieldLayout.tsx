import type { ReactNode } from "react";
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
        <div className={className}>
            {field.label && (
                <label className="block text-xs font-medium text-gray-400 mb-1">
                    {field.label}
                </label>
            )}
            {children}
            {field.helpText && (
                <p className="mt-1 text-xs text-gray-500">{field.helpText}</p>
            )}
        </div>
    );
}
