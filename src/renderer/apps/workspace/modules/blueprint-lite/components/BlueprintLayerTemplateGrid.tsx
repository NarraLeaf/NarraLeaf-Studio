import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { LibraryBig, Plus } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { CANVAS_SIDEBAR_INSET_PADDING } from "@/lib/components/layout/editorSidebarInset";
import type { FrozenControlProps } from "@/apps/workspace/components/ui/freezeGuard";
import { blueprintTemplateIcon, blueprintTemplateText, type BlueprintLayerTemplate } from "../templates/blueprintLayerTemplates";

type Props = {
    /** The few templates shown as tiles, already narrowed to this blueprint and in display order. */
    templates: readonly BlueprintLayerTemplate[];
    onPickTemplate: (template: BlueprintLayerTemplate) => void;
    /** Opens the template library; absent when the library holds nothing the tiles do not. */
    onOpenLibrary?: () => void;
    /** The blank layer, which asks graph or script as the member panel's New button does. */
    onPickBlank: () => void;
    /** Every tile writes the blueprint, so a frozen project greys all of them alike. */
    writeProps: FrozenControlProps;
};

/** Narrowest a tile gets before the grid drops a column. */
const MIN_TILE_WIDTH_PX = 176;
const GAP_PX = 12;

/**
 * The canvas of a blueprint with no layers: a few templates, the template library, and a blank layer.
 *
 * The blank tile always takes the last column of the last row, and the library the cell before it.
 * A grid that ran short would otherwise leave them wherever the count happened to put them, and they
 * are the two tiles an author looks for by position rather than by name.
 */
export function BlueprintLayerTemplateGrid({ templates, onPickTemplate, onOpenLibrary, onPickBlank, writeProps }: Props) {
    const { t, locale } = useTranslation();
    const listRef = useRef<HTMLUListElement>(null);
    const tileCount = templates.length + (onOpenLibrary ? 1 : 0) + 1;
    const columns = useColumnCount(listRef, preferredColumns(tileCount));

    return (
        // The layer panel is drawn over the canvas, so the grid keeps to the part of it the panel
        // leaves - without moving the canvas, which the first layer's graph then opens on.
        <div className="flex h-full min-h-0 overflow-y-auto" style={{ paddingLeft: CANVAS_SIDEBAR_INSET_PADDING }}>
            <div className="m-auto w-full max-w-3xl px-6 py-8">
                <div className="mb-4 text-center">
                    <p className="text-sm font-medium text-fg-muted">{t("blueprint.layerTemplates.heading")}</p>
                    <p className="mt-1 text-xs text-fg-subtle">{t("blueprint.layerTemplates.description")}</p>
                </div>
                <ul
                    ref={listRef}
                    aria-label={t("blueprint.layerTemplates.listLabel")}
                    className="grid auto-rows-fr gap-3"
                    style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                >
                    {templates.map(template => {
                        const Icon = blueprintTemplateIcon(template);
                        const text = blueprintTemplateText(template, locale);
                        return (
                            <li key={template.id}>
                                <TemplateTile
                                    icon={<Icon className="h-4 w-4" aria-hidden />}
                                    title={text.title}
                                    description={text.description}
                                    onClick={() => onPickTemplate(template)}
                                    writeProps={writeProps}
                                />
                            </li>
                        );
                    })}
                    {onOpenLibrary ? (
                        // Browsing writes nothing, so the library stays open on a frozen project; it
                        // is the Add inside it that is refused.
                        <li style={columns > 1 ? { gridColumnEnd: -2 } : undefined}>
                            <TemplateTile
                                icon={<LibraryBig className="h-4 w-4" aria-hidden />}
                                title={t("blueprint.layerTemplates.library.title")}
                                description={t("blueprint.layerTemplates.library.description")}
                                onClick={onOpenLibrary}
                            />
                        </li>
                    ) : null}
                    <li style={{ gridColumnEnd: -1 }}>
                        <TemplateTile
                            icon={<Plus className="h-4 w-4" aria-hidden />}
                            title={t("blueprint.layerTemplates.blank.title")}
                            description={t("blueprint.layerTemplates.blank.description")}
                            onClick={onPickBlank}
                            writeProps={writeProps}
                        />
                    </li>
                </ul>
            </div>
        </div>
    );
}

function TemplateTile(props: {
    icon: ReactNode;
    title: string;
    description: string;
    onClick: () => void;
    writeProps?: FrozenControlProps;
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            className={cn(
                "group flex h-full w-full flex-col items-start gap-1.5 rounded-md border border-dashed border-edge-strong p-3 text-left",
                "transition-colors duration-150 hover:border-primary hover:bg-fill-subtle focus-visible:border-primary focus-visible:bg-fill-subtle",
                "disabled:cursor-not-allowed disabled:opacity-50",
            )}
            {...props.writeProps}
        >
            <span className="text-fg-muted transition-colors duration-150 group-hover:text-primary group-disabled:text-fg-muted">
                {props.icon}
            </span>
            <span className="text-xs font-medium text-fg">{props.title}</span>
            <span className="text-2xs text-fg-subtle">{props.description}</span>
        </button>
    );
}

/**
 * Columns for a grid of `count` tiles that fills its rows: three, except where that would leave a
 * lone tile on a second row - four tiles read as two by two, and three or fewer as one row.
 */
function preferredColumns(count: number): number {
    if (count <= 3) {
        return count;
    }
    return count === 4 ? 2 : 3;
}

/** `preferred`, or fewer when the grid is too narrow for that many tiles at a readable width. */
function useColumnCount(ref: React.RefObject<HTMLElement | null>, preferred: number): number {
    const [fit, setFit] = useState(preferred);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) {
            return undefined;
        }
        const measure = () => {
            const width = element.clientWidth;
            setFit(Math.max(1, Math.floor((width + GAP_PX) / (MIN_TILE_WIDTH_PX + GAP_PX))));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);
    return Math.max(1, Math.min(preferred, fit));
}
