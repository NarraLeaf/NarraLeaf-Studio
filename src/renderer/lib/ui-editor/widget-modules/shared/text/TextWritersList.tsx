import { useMemo, type ReactNode } from "react";
import { GitBranch } from "lucide-react";
import type { Blueprint } from "@shared/types/blueprint/document";
import type { TranslationKey } from "@shared/i18n";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { UITextWriter } from "@shared/types/ui-editor/textWriters";
import { useWorkspace } from "@/apps/workspace/context";
import { resolveBlueprintNodeTitle } from "@/apps/workspace/modules/blueprint-lite/blueprintNodeI18n";
import { blueprintEntryContextMenu } from "@/apps/workspace/modules/blueprint-lite/hooks/blueprintEntryGesture";
import { useBlueprintDocumentRevision } from "@/apps/workspace/modules/blueprint-lite/hooks/useBlueprintDocumentRevision";
import { useOpenBlueprintTarget, type BlueprintOpenOptions } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { blueprintOwnerOpenTarget } from "@/apps/workspace/modules/search/blueprintJumpTarget";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { InspectOnlyButton } from "@/lib/components/elements/InspectOnlyButton";
import { useTranslation } from "@/lib/i18n";
import { widgetKindName } from "@/lib/ui-editor/blueprint-nodes/widgetKindName";
import { blueprintNodeDisplayName } from "@/lib/ui-editor/blueprint-nodes/requiredInputPins";
import { flattenBlueprintOwner } from "@/lib/workspace/services/search/blueprintOwnerKey";
import { Services } from "@/lib/workspace/services/services";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { readProjectTextWriters } from "@/lib/workspace/services/ui-editor/blueprint/projectTextWriters";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { ownerLabelKey } from "@shared/types/ui-editor/ownerLabels";

const NO_WRITERS: readonly UITextWriter[] = [];

/**
 * The blueprints that write an element's words while the game runs (`textWriters.ts`), kept current
 * as graphs are edited. Empty outside a workspace.
 */
export function useElementTextWriters(elementId: string): readonly UITextWriter[] {
    const { context, isInitialized } = useWorkspace();
    const revision = useBlueprintDocumentRevision();
    return useMemo(() => {
        void revision;
        if (!context || !isInitialized) {
            return NO_WRITERS;
        }
        return readProjectTextWriters(context.services).get(elementId) ?? NO_WRITERS;
    }, [context, isInitialized, elementId, revision]);
}

/** Writers of one node type in one blueprint, shown as one entry; it opens at the first of them. */
type WriterEntry = {
    key: string;
    blueprint: Blueprint;
    nodeType: string;
    first: UITextWriter;
    count: number;
};

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

function elementLabel(element: UIElement | undefined): string {
    return element?.name?.trim() || widgetKindName(element?.type ?? "");
}

/**
 * Where a blueprint sits, in the words the author navigates by: the page or component, then the
 * control whose logic it is - 「存档位 › 点击区域」, 「设置 › 页面逻辑」, 「应用逻辑」.
 *
 * Read from the owner rather than from the blueprint's stored name, which follows its control's name
 * only once the control's logic has been opened, and so can say something the page no longer does.
 */
function blueprintPlace(blueprint: Blueprint, document: UIDocument | null, t: Translate): string {
    const owner = blueprint.owner;
    const surfaceName = (surfaceId: string) => {
        const surface = document?.surfaces.find(candidate => candidate.id === surfaceId);
        return surface?.name?.trim() || t("properties.blueprintEntry.interfaceFallback");
    };
    switch (owner.kind) {
        case "surfaceMain": {
            const surface = document?.surfaces.find(candidate => candidate.id === owner.surfaceId);
            const logic = surface?.kind === "stageSurface"
                ? t("properties.blueprintEntry.gameUiLogic")
                : t("properties.blueprintEntry.pageLogic");
            return `${surfaceName(owner.surfaceId)} › ${logic}`;
        }
        case "widgetMain":
        case "widgetValue":
            return `${surfaceName(owner.surfaceId)} › ${elementLabel(document?.elements[owner.elementId])}`;
        case "componentWidgetMain": {
            const component = document?.components?.find(candidate => candidate.id === owner.componentId);
            const name = component?.name?.trim() || t("uiEditor.ownerLabel.widgetMain");
            return `${name} › ${elementLabel(component?.elements[owner.elementId])}`;
        }
        default:
            return blueprint.name?.trim() || t(ownerLabelKey(owner.kind));
    }
}

function groupWriters(writers: readonly UITextWriter[], blueprints: Record<string, Blueprint>): WriterEntry[] {
    const entries: WriterEntry[] = [];
    const byKey = new Map<string, WriterEntry>();
    for (const writer of writers) {
        const blueprint = blueprints[writer.blueprintId];
        if (!blueprint) {
            continue;
        }
        const key = `${writer.blueprintId}\u0000${writer.nodeType}`;
        const entry = byKey.get(key);
        if (entry) {
            entry.count += 1;
            continue;
        }
        const created = { key, blueprint, nodeType: writer.nodeType, first: writer, count: 1 };
        byKey.set(key, created);
        entries.push(created);
    }
    return entries;
}

/**
 * The blueprints that write an element's words while the game runs, each opening at the node that
 * writes them: 「存档位 › 点击区域 › 设置文本 ×2」 - where the blueprint sits, then the node.
 *
 * Read from the graphs, not stored (`textWriters.ts`): a writer appears when its node is wired and goes
 * when it is deleted. A script layer that writes the words is not listed - its writes are in its code.
 *
 * Opening is reading, so the entries stay live on a frozen project; click opens the blueprint in a
 * preview tab and right click in a window of its own, as every blueprint entry does.
 */
export function TextWritersList(props: { writers: readonly UITextWriter[] }): ReactNode {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const openBlueprint = useOpenBlueprintTarget();
    const revision = useBlueprintDocumentRevision();
    const entries = useMemo(() => {
        void revision;
        if (!context || !isInitialized || props.writers.length === 0) {
            return [];
        }
        try {
            const document = context.services.get<LocalBlueprintService>(Services.LocalBlueprint).getBlueprintDocument();
            return groupWriters(props.writers, document.blueprints ?? {});
        } catch {
            return [];
        }
    }, [context, isInitialized, props.writers, revision]);
    // The whole project's interface document, not the inspector's: a component's editor holds only
    // the component, and a writer may sit on any page.
    const uiDocument = context && isInitialized
        ? context.services.get<UIDocumentService>(Services.UIDocument).getDocument()
        : null;

    if (entries.length === 0) {
        return null;
    }

    const open = (entry: WriterEntry, options?: BlueprintOpenOptions) => {
        const owner = flattenBlueprintOwner(entry.blueprint.owner);
        const { first } = entry;
        openBlueprint(
            {
                ...blueprintOwnerOpenTarget(entry.blueprint.id, owner, context),
                ...(first.graphKind === "event" ? { focusEventId: first.graphId } : {}),
                ...(first.graphKind === "function" ? { focusFunctionId: first.graphId } : {}),
                focusNodeId: first.nodeId,
            },
            options,
        );
    };

    return (
        <div className="space-y-1">
            <FieldLabel as="div">{t("widgets.textWriters.title")}</FieldLabel>
            {entries.map(entry => {
                const blueprintName = blueprintPlace(entry.blueprint, uiDocument, t);
                const nodeName = resolveBlueprintNodeTitle(blueprintNodeDisplayName(entry.nodeType), t);
                const label = t("widgets.textWriters.entry", { blueprint: blueprintName, node: nodeName });
                return (
                    <InspectOnlyButton
                        key={entry.key}
                        className="flex w-full min-w-0 items-center gap-2 rounded-md border border-edge bg-surface px-3 py-1.5 text-left text-xs text-fg hover:bg-fill cursor-default"
                        onClick={() => open(entry)}
                        onContextMenu={blueprintEntryContextMenu(options => open(entry, options))}
                        aria-label={entry.count > 1 ? `${label} ${t("widgets.textWriters.count", { count: entry.count })}` : label}
                        data-text-writer={entry.first.nodeId}
                        data-tip={t("blueprint.entry.openInWindow")}
                    >
                        <GitBranch className="h-3.5 w-3.5 shrink-0 text-binding" />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        {entry.count > 1 ? (
                            <span className="shrink-0 text-fg-subtle">{t("widgets.textWriters.count", { count: entry.count })}</span>
                        ) : null}
                    </InspectOnlyButton>
                );
            })}
        </div>
    );
}
