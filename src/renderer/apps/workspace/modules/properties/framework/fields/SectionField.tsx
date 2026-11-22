import { createContext, useContext, useState, useCallback, memo } from "react";
import { HelpTrigger } from "@/lib/help";
import { SectionTitle } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { SectionFieldDefinition } from "../types";
import { FieldRenderer } from "./FieldRenderer";

/** Whether this section sits inside another one, which draws it in the nested form. */
const InsideSectionContext = createContext(false);

interface SectionFieldProps<TData> {
    field: SectionFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

/**
 * A group of fields under a `section` heading (docs/design-system.md §4.1).
 *
 * No card and no filled header bar: the heading's weight and colour and the divider above it set the
 * section apart from its fields, the same way a section with nothing to fold reads. The first section
 * in a run drops the divider, since the panel header's own rule is already above it.
 *
 * Nothing here clips, so a field inside a section can open a menu or a popover past its edge.
 */
function SectionFieldInner<TData>({ field, data, onSaving }: SectionFieldProps<TData>) {
    const nested = useContext(InsideSectionContext);
    const [isCollapsed, setIsCollapsed] = useState(field.defaultCollapsed ?? false);

    const toggleCollapse = useCallback(() => {
        setIsCollapsed((prev) => !prev);
    }, []);

    /*
     * A section with a topic answers `F1` from anywhere inside it, and shows the `?` when the pointer
     * is over its heading, as a panel header does. The `?` sits at the heading's far end, outside the
     * fold toggle, so its click opens the topic and leaves the section as it was.
     */
    return (
        <section
            // A nested section has no divider of its own: the outer section's rule already groups it,
            // and space alone separates it from the sibling before it.
            className={cn(
                nested ? "pt-1 first:pt-0" : "border-t border-edge-subtle pt-4 first:border-t-0 first:pt-0",
                field.className,
            )}
            data-help-topic={field.helpTopic}
        >
            <SectionTitle
                className={field.helpTopic ? "group/help" : undefined}
                collapsed={field.collapsible ? isCollapsed : undefined}
                onToggle={field.collapsible ? toggleCollapse : undefined}
                nested={nested}
                actions={field.helpTopic ? <HelpTrigger topic={field.helpTopic} className="-my-1" /> : undefined}
            >
                {field.title}
            </SectionTitle>
            {!(field.collapsible && isCollapsed) && (
                <div className={nested ? "mt-2 space-y-3" : "mt-3 space-y-3"}>
                    <InsideSectionContext.Provider value={true}>
                        {field.fields.map((nestedField) => (
                            <FieldRenderer
                                key={nestedField.id}
                                field={nestedField}
                                data={data}
                                onSaving={onSaving}
                            />
                        ))}
                    </InsideSectionContext.Provider>
                </div>
            )}
        </section>
    );
}

export const SectionField = memo(SectionFieldInner) as typeof SectionFieldInner;
