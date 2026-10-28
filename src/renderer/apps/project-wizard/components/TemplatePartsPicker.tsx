import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button, Checkbox, CONTROL_SIZE_CLASS } from "@/lib/components/elements";
import { useFloatingLayer } from "@/lib/components/layout";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { partsKeptWith, resolveLeftOutParts, type ProjectTemplatePartId } from "@shared/project/templateParts";
import type { ProjectTemplatePartChoice } from "../types";

interface TemplatePartsPickerProps {
    parts: ProjectTemplatePartChoice[];
    leaveOut: readonly ProjectTemplatePartId[];
    onChange: (leaveOut: ProjectTemplatePartId[]) => void;
}

/**
 * Which parts of a template's sample content come into the project.
 *
 * A dropdown of checkboxes rather than a row of them: the list is the template's to define, and the
 * answer most authors give is "all of it", which the closed trigger says in one word. Ticks follow
 * the parts' requirements both ways - unticking the sample cast unticks the story that speaks
 * through it, and ticking the story back ticks its cast back - so the set the author sees is always
 * the set that is made.
 *
 * Styled as the `Select` trigger and its menu, because that is what it is next to on every other
 * page of the wizard; `Select` itself picks one value and this picks a set.
 */
export function TemplatePartsPicker({ parts, leaveOut, onChange }: TemplatePartsPickerProps) {
    const { t, locale } = useTranslation();
    const [open, setOpen] = useState(false);
    const ownerRef = useRef<HTMLDivElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    useFloatingLayer({
        open,
        onClose: () => setOpen(false),
        panelRef,
        ownerRefs: [ownerRef],
        itemSelector: "input[type=\"checkbox\"]",
    });

    const kept = parts.filter(part => !leaveOut.includes(part.id));
    const summary = kept.length === parts.length
        ? t("wizard.template.parts.all")
        : kept.length === 0
            ? t("wizard.template.parts.none")
            : new Intl.ListFormat(locale, { type: "conjunction" }).format(kept.map(part => part.name));

    const toggle = (part: ProjectTemplatePartChoice, keep: boolean) => {
        if (keep) {
            const comingBack = new Set(partsKeptWith(parts, part.id));
            onChange(leaveOut.filter(id => !comingBack.has(id)));
        } else {
            onChange(resolveLeftOutParts(parts, [...leaveOut, part.id]));
        }
    };

    return (
        <div ref={ownerRef} className="relative">
            <Button
                variant="ghost"
                size="md"
                fullWidth
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={t("wizard.template.parts.label")}
                className={cn(
                    "min-w-0 justify-between border border-edge-strong bg-fill-subtle hover:bg-fill",
                    CONTROL_SIZE_CLASS.md,
                    open && "border-primary ring-2 ring-primary/20",
                )}
                onClick={() => setOpen(prev => !prev)}
            >
                <span className="min-w-0 flex-1 truncate text-left text-fg">{summary}</span>
                <ChevronDown
                    className={cn("h-4 w-4 shrink-0 text-fg-muted transition-transform duration-150", open && "rotate-180")}
                />
            </Button>
            {open ? (
                <div
                    ref={panelRef}
                    role="menu"
                    className="absolute left-0 top-full z-50 mt-1 w-full rounded-md border border-edge-strong bg-surface-raised p-1 shadow-lg"
                >
                    {parts.map(part => (
                        <Checkbox
                            key={part.id}
                            className="items-start rounded-md px-2 py-1.5 text-sm hover:bg-fill"
                            boxClassName="mt-0.5"
                            checked={!leaveOut.includes(part.id)}
                            onCheckedChange={checked => toggle(part, checked)}
                        >
                            <span className="min-w-0">
                                <span className="block text-fg">{part.name}</span>
                                {part.description ? (
                                    <span className="mt-0.5 block text-xs text-fg-muted">{part.description}</span>
                                ) : null}
                            </span>
                        </Checkbox>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
