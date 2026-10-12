import { useState, useCallback, memo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { HelpTrigger } from "@/lib/help";
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

    /*
     * The card clips nothing on purpose: a field inside a section can open a menu or a popover that
     * has to reach past the card's edge, which is why `overflow-visible` replaced the original
     * `overflow-hidden` here. That leaves the header to round its own corners. Its fill
     * (`bg-surface-raised`) is a different one from the body's, so with no radius of its own it
     * painted square into the card's rounded top corners and the whole section read as a plain
     * rectangle - the card's radius was still there, just covered up. Collapsed, the header *is* the
     * card, so it takes the radius on all four corners.
     */
    const headerRadiusClass = isCollapsed ? "rounded-md" : "rounded-t-md";

    /*
     * A section with a topic answers `F1` from anywhere inside it, and shows the `?` when the pointer
     * is over its header, as a panel header does. The `?` sits at the header's far end, away from the
     * chevron, and keeps its click to itself: the header around it folds the section on a click.
     */
    return (
        <div
            className={`border border-edge rounded-md overflow-visible ${field.className || ""}`}
            data-help-topic={field.helpTopic}
        >
            <div
                className={`flex items-center gap-2 px-3 py-2 bg-surface-raised ${headerRadiusClass} ${
                    field.collapsible ? "cursor-pointer hover:bg-surface-overlay" : ""
                } ${field.helpTopic ? "group/help" : ""}`}
                onClick={toggleCollapse}
            >
                {field.collapsible && (
                    <span className="text-fg-muted">
                        {isCollapsed ? (
                            <ChevronRight className="w-4 h-4" />
                        ) : (
                            <ChevronDown className="w-4 h-4" />
                        )}
                    </span>
                )}
                <span className="text-sm font-medium text-fg-muted">{field.title}</span>
                {field.helpTopic ? (
                    <span className="ml-auto flex" onClick={event => event.stopPropagation()}>
                        <HelpTrigger topic={field.helpTopic} className="-my-1" />
                    </span>
                ) : null}
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
