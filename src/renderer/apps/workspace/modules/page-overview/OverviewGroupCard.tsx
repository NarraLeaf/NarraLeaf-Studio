import { memo, useMemo, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { UIElement } from "@shared/types/ui-editor/document";
import { useTranslation } from "@/lib/i18n";
import { Button, Select, type SelectOption } from "@/lib/components/elements";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import {
    BlueprintLayerPreview,
    resolveFirstBlueprintLayerPreview,
    type BlueprintLayerPreviewModel,
} from "@/lib/ui-editor/widget-modules/shared/blueprint/BlueprintLayerPreview";
import { buildPreviewModel } from "@/lib/ui-editor/widget-modules/shared/blueprint/blueprintLayerPreviewModel";
import { FieldRenderer } from "../properties/framework";
import type { FieldDefinition } from "../properties/framework/types";
import { InspectorWritesProvider } from "../properties/framework/fields/inspectorWrites";
import { createLayoutInspectorSchema } from "../properties/PropertiesPanel";
import { interfaceDocumentFreezeScope } from "../ui-editor/uiFreezeScope";
import type { PageOverviewExit } from "./pageOverviewModel";
import { ExitPhrase, type OverviewNames } from "./pageOverviewText";
import { OVERVIEW_EXIT_ROW_H, OVERVIEW_GROUP_W } from "./pageOverviewGraph";

/**
 * The properties a group offers, by the id the widget's own inspector gives them, in the order they
 * appear. Taken from that inspector rather than rebuilt, so a field here is the field in the
 * properties panel - the same translation-key handling, the same clamping, the same binding marks.
 * Anything else is one click away under "More properties".
 */
const GROUP_WIDGET_FIELD_IDS = [
    "button.label",
    "text.content",
    "button.fontAsset",
    "text.fontAsset",
    "button.typographyRow",
    "text.typographyRow",
    "button.colorRow",
] as const;

function collectFields(fields: readonly FieldDefinition<UIInspectorData>[], into: Map<string, FieldDefinition<UIInspectorData>>): void {
    for (const field of fields) {
        into.set(field.id, field);
        if (field.type === "section") {
            collectFields(field.fields as FieldDefinition<UIInspectorData>[], into);
        }
    }
}

/** The position and size rows, then the widget's own few, for one element. */
function groupFields(element: UIElement, documentService: UIDocumentService, surfaceId: string, t: ReturnType<typeof useTranslation>["t"]): FieldDefinition<UIInspectorData>[] {
    const layout = createLayoutInspectorSchema([element], documentService, t, surfaceId);
    // Position first, size second; rotation, opacity and the rest stay in the properties panel.
    const fields = (layout.fields ?? []).slice(0, 2).filter(field => field.id !== "layout.rotation");
    const inspector = widgetModuleRegistry.get(element.type)?.createInspector?.({ element, documentService });
    if (inspector) {
        const byId = new Map<string, FieldDefinition<UIInspectorData>>();
        collectFields(inspector.fields ?? [], byId);
        for (const tab of inspector.tabs ?? []) {
            collectFields(tab.fields ?? [], byId);
        }
        for (const id of GROUP_WIDGET_FIELD_IDS) {
            const field = byId.get(id);
            if (field) {
                fields.push(field);
            }
        }
    }
    return fields;
}

/** What drawing a blueprint's preview needs. `revision` moves with every blueprint edit. */
export type OverviewBlueprintPreviewSource = {
    localBp: LocalBlueprintService | null;
    nodeCatalog: BlueprintNodeCatalogService | null;
    revision: number;
};

/**
 * The layer a card previews: the one its first exit sits in, so the drawing shows the step the
 * summary above it names. A control with no exit shows its first layer, as every other blueprint
 * entry in Studio does.
 */
function previewModelFor(source: OverviewBlueprintPreviewSource, blueprintId: string, exit: PageOverviewExit | undefined): BlueprintLayerPreviewModel | null {
    const layer = exit ? source.localBp?.getBlueprintDocument().blueprints[blueprintId]?.graphs.events[exit.layerId] : undefined;
    if (layer?.graph) {
        return buildPreviewModel(layer.graph, layer.name, source.nodeCatalog);
    }
    return resolveFirstBlueprintLayerPreview(source.localBp, source.nodeCatalog, blueprintId);
}

export type OverviewGroupCardProps = {
    groupKey: string;
    title: string;
    /** The control's kind, beside its name. */
    caption: string;
    exits: readonly PageOverviewExit[];
    names: OverviewNames;
    /** The words a run's starting event goes by - "Mouse Click", "Key Down". */
    headTitle: (headType: string) => string;
    expanded: boolean;
    selected: boolean;
    onToggle: () => void;
    /** Live element, for the property fields. Absent for the page's own events. */
    element?: UIElement;
    /**
     * Moves on every edit to the page. The document is edited in place, so the element above is the
     * same object before and after a change; this is what tells the fields their values moved.
     */
    revision: number;
    surfaceId: string;
    documentService: UIDocumentService | null;
    hasBlueprint: boolean;
    /** The blueprint the card previews; absent when nothing has been written into one yet. */
    blueprintId?: string;
    preview: OverviewBlueprintPreviewSource;
    notes: readonly string[];
    readOnly: boolean;
    /** The exit a picker may change, with the pages it can choose from. */
    retarget: { exit: PageOverviewExit; value: string; options: SelectOption[]; onChange: (surfaceId: string) => void } | null;
    onOpenLogic: (exit?: PageOverviewExit) => void;
    onMoreProperties?: () => void;
    /** The card's input pin, at its header. */
    inHandle?: ReactNode;
    /** The exec pin at the end of an exit's row. */
    renderExitHandle?: (exit: PageOverviewExit) => ReactNode;
};

/**
 * One control as a blueprint node: its kind and name in the header, an exec pin per place its logic
 * goes, and, unfolded, a page picker when there is exactly one page step to change, a preview of the
 * blueprint, and the few properties an author reaches for most.
 */
export const OverviewGroupCard = memo(function OverviewGroupCard({
    groupKey,
    title,
    caption,
    exits,
    names,
    headTitle,
    expanded,
    selected,
    onToggle,
    element,
    revision,
    surfaceId,
    documentService,
    hasBlueprint,
    blueprintId,
    preview,
    notes,
    readOnly,
    retarget,
    onOpenLogic,
    onMoreProperties,
    inHandle,
    renderExitHandle,
}: OverviewGroupCardProps) {
    const { t } = useTranslation();
    const fields = useMemo(
        () => (expanded && element && documentService ? groupFields(element, documentService, surfaceId, t) : []),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `revision` stands in for the element's contents
        [expanded, element, documentService, surfaceId, t, revision],
    );
    const data = useMemo<UIInspectorData | null>(
        () => (element && documentService ? { element, elements: [element], documentService, surfaceId } : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- a new object per revision is what re-renders the fields
        [element, documentService, surfaceId, revision],
    );
    const writes = useMemo(() => ({ scope: interfaceDocumentFreezeScope() }), []);
    const previewModel = useMemo(
        () => (expanded && blueprintId ? previewModelFor(preview, blueprintId, exits[0]) : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `preview.revision` stands in for the blueprint, edited in place
        [expanded, blueprintId, exits, preview.localBp, preview.nodeCatalog, preview.revision],
    );
    const toggleLabel = t(expanded ? "uiEditor.pageOverview.group.collapse" : "uiEditor.pageOverview.group.expand", { name: title });

    return (
        // A blueprint card: the same shell, header and pin rows as a node in the blueprint editor, so
        // the overview reads as one more graph rather than a different kind of page.
        <div
            className={`relative rounded-md border bg-surface-raised text-xs shadow-md transition-colors duration-150 ${
                selected ? "border-primary/80 ring-1 ring-primary/40" : "border-edge"
            }`}
            style={{ width: OVERVIEW_GROUP_W }}
            data-page-overview-group={groupKey}
        >
            {inHandle}
            <button
                type="button"
                className="flex w-full min-w-0 items-start gap-1.5 rounded-t-md border-b border-edge-subtle px-2 py-1.5 text-left hover:bg-fill-subtle"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-label={toggleLabel}
            >
                <span className="min-w-0 flex-1">
                    <span className="block text-2xs text-fg-muted">{caption}</span>
                    <span className="block truncate font-medium leading-tight text-fg">{title}</span>
                </span>
                <ChevronRight className={`mt-2.5 h-3.5 w-3.5 shrink-0 text-fg-subtle transition-transform duration-150 ${expanded ? "rotate-90" : ""}`} />
            </button>
            {/* One exec pin per place the control's logic leads, the way a node's outputs are rows. */}
            <div className="py-1">
                {exits.length > 0 ? exits.map(exit => (
                    <div
                        key={`${exit.layerId}:${exit.nodeId}`}
                        className="relative flex min-w-0 items-center gap-1 pl-2 pr-3 text-2xs leading-tight text-fg-muted"
                        style={{ minHeight: OVERVIEW_EXIT_ROW_H }}
                    >
                        <span className="min-w-0 truncate">
                            <span className="text-fg-subtle">{headTitle(exit.headType)}</span>
                            <span className="px-1 text-fg-subtle" aria-hidden="true">·</span>
                            <ExitPhrase exit={exit} names={names} t={t} />
                        </span>
                        {renderExitHandle?.(exit)}
                    </div>
                )) : (
                    <div className="flex items-center pl-2 pr-3 text-2xs text-fg-subtle" style={{ minHeight: OVERVIEW_EXIT_ROW_H }}>
                        {t("uiEditor.pageOverview.group.noLogic")}
                    </div>
                )}
            </div>
            {expanded ? (
                // Controls inside a node: React Flow must leave their presses, drags and wheels alone.
                <div className="nodrag nopan nowheel flex cursor-auto flex-col gap-4 border-t border-edge-subtle px-2 pb-3 pt-2.5">
                    <section className="flex flex-col gap-2">
                        <div className="text-2xs text-fg-subtle">{t("uiEditor.pageOverview.group.logic")}</div>
                        {retarget ? (
                            <div className="flex min-w-0 items-center gap-2" data-tip={t("uiEditor.pageOverview.group.targetTip")}>
                                <span className="shrink-0 text-xs text-fg-muted">{t("uiEditor.pageOverview.group.target")}</span>
                                <Select
                                    size="sm"
                                    className="min-w-0 flex-1"
                                    options={retarget.options}
                                    value={retarget.value}
                                    disabled={readOnly}
                                    onChange={value => retarget.onChange(String(value))}
                                    ariaLabel={t("uiEditor.pageOverview.group.target")}
                                />
                            </div>
                        ) : null}
                        {notes.map(note => (
                            <div key={note} className="text-2xs text-fg-subtle">{note}</div>
                        ))}
                        {hasBlueprint && blueprintId ? (
                            // The drawing is the way in, as on every other blueprint entry: click opens
                            // the blueprint on the step the first pin names.
                            <button
                                type="button"
                                className="block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                                onClick={() => onOpenLogic(exits[0])}
                                data-tip={t("uiEditor.pageOverview.group.editInBlueprint")}
                                aria-label={t("uiEditor.pageOverview.group.editInBlueprint")}
                                data-page-overview-blueprint-preview=""
                            >
                                <BlueprintLayerPreview model={previewModel} />
                            </button>
                        ) : (
                            <div>
                                <Button size="sm" variant="secondary" onClick={() => onOpenLogic(exits[0])} disabled={readOnly}>
                                    {t("uiEditor.pageOverview.group.addLogic")}
                                </Button>
                            </div>
                        )}
                    </section>
                    {data && fields.length > 0 ? (
                        <section className="flex flex-col gap-3">
                            <div className="text-2xs text-fg-subtle">{t("uiEditor.pageOverview.group.properties")}</div>
                            <InspectorWritesProvider value={writes}>
                                {fields.map(field => (
                                    <FieldRenderer
                                        key={field.id}
                                        field={readOnly ? { ...field, readOnly: true } : field}
                                        data={data}
                                        onSaving={noop}
                                    />
                                ))}
                            </InspectorWritesProvider>
                            {onMoreProperties ? (
                                <div>
                                    <Button size="sm" variant="ghost" onClick={onMoreProperties}>
                                        {t("uiEditor.pageOverview.group.moreProperties")}
                                    </Button>
                                </div>
                            ) : null}
                        </section>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
});

function noop(): void {}
