import { memo, useMemo } from "react";
import { ChevronRight } from "lucide-react";
import type { UIElement } from "@shared/types/ui-editor/document";
import { useTranslation } from "@/lib/i18n";
import { Button, Select, type SelectOption } from "@/lib/components/elements";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { FieldRenderer } from "../properties/framework";
import type { FieldDefinition } from "../properties/framework/types";
import { InspectorWritesProvider } from "../properties/framework/fields/inspectorWrites";
import { createLayoutInspectorSchema } from "../properties/PropertiesPanel";
import { interfaceDocumentFreezeScope } from "../ui-editor/uiFreezeScope";
import type { PageOverviewExit } from "./pageOverviewModel";
import { ExitPhrase, type OverviewNames } from "./pageOverviewText";

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
    surfaceId: string;
    documentService: UIDocumentService | null;
    hasBlueprint: boolean;
    notes: readonly string[];
    readOnly: boolean;
    /** The exit a picker may change, with the pages it can choose from. */
    retarget: { exit: PageOverviewExit; value: string; options: SelectOption[]; onChange: (surfaceId: string) => void } | null;
    onOpenLogic: (exit?: PageOverviewExit) => void;
    onMoreProperties?: () => void;
};

/**
 * One control in the middle column: its name and, folded, a line per place its logic goes. Unfolded
 * it shows the logic in full, a page picker when there is exactly one page step to change, and the
 * few properties an author reaches for most.
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
    surfaceId,
    documentService,
    hasBlueprint,
    notes,
    readOnly,
    retarget,
    onOpenLogic,
    onMoreProperties,
}: OverviewGroupCardProps) {
    const { t } = useTranslation();
    const fields = useMemo(
        () => (expanded && element && documentService ? groupFields(element, documentService, surfaceId, t) : []),
        // The element is replaced on every edit, which is what rebuilds the fields' values.
        [expanded, element, documentService, surfaceId, t],
    );
    const data = useMemo<UIInspectorData | null>(
        () => (element && documentService ? { element, elements: [element], documentService, surfaceId } : null),
        [element, documentService, surfaceId],
    );
    const writes = useMemo(() => ({ scope: interfaceDocumentFreezeScope() }), []);
    const toggleLabel = t(expanded ? "uiEditor.pageOverview.group.collapse" : "uiEditor.pageOverview.group.expand", { name: title });

    const exitLines = exits.length > 0 ? (
        <ul className="flex flex-col gap-1">
            {exits.map(exit => (
                <li key={`${exit.layerId}:${exit.nodeId}`} className="min-w-0 text-xs text-fg-muted">
                    <span className="text-fg-subtle">{headTitle(exit.headType)}</span>
                    <span className="px-1 text-primary" aria-hidden="true">→</span>
                    <ExitPhrase exit={exit} names={names} t={t} />
                </li>
            ))}
        </ul>
    ) : (
        <div className="text-xs text-fg-subtle">{t("uiEditor.pageOverview.group.noLogic")}</div>
    );

    return (
        <div
            className={`rounded-md border bg-surface-raised transition-colors duration-150 ${selected ? "border-primary" : "border-edge"}`}
            data-page-overview-group={groupKey}
        >
            <button
                type="button"
                className="flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-fill-subtle"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-label={toggleLabel}
            >
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-fg-subtle transition-transform duration-150 ${expanded ? "rotate-90" : ""}`} />
                <span className="min-w-0 truncate text-sm font-medium text-fg">{title}</span>
                <span className="shrink-0 text-2xs text-fg-subtle">{caption}</span>
            </button>
            {!expanded ? <div className="px-3 pb-2.5">{exitLines}</div> : null}
            {expanded ? (
                <div className="flex flex-col gap-4 border-t border-edge-subtle px-3 pb-3 pt-2.5">
                    <section className="flex flex-col gap-2">
                        <div className="text-2xs text-fg-subtle">{t("uiEditor.pageOverview.group.logic")}</div>
                        {exitLines}
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
                        <div>
                            <Button size="sm" variant="secondary" onClick={() => onOpenLogic(exits[0])}>
                                {hasBlueprint ? t("uiEditor.pageOverview.group.editInBlueprint") : t("uiEditor.pageOverview.group.addLogic")}
                            </Button>
                        </div>
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
