import { GLOBAL_MAIN_OWNER_KEY } from "@shared/blueprint/ownerKey";
import type { ParsedBlueprintOwnerKey } from "@/lib/workspace/services/search/blueprintOwnerKey";
import type { SearchJumpTarget } from "@/lib/workspace/services/search/searchIndexModel";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { BlueprintEditorOpenTarget } from "@/lib/workspace/services/ui-editor/blueprint/navigationTargets";
import { getBlueprintEntryTabId } from "../blueprint-lite/blueprintEntryTabId";
import { getComponentEditorSurfaceId } from "../ui-editor/editors/componentEditorAdapter";

type BlueprintJumpTarget = Extract<SearchJumpTarget, { kind: "blueprint" }>;

/**
 * Where a deep link into a blueprint - a search hit, a problem, a reference - lands: the blueprint
 * editor tab for that blueprint, addressed and named the way every other way into it does.
 *
 * **Addressed the same way.** A blueprint tab is keyed by its owner's surface slot, and two owners
 * have no real surface to put there: the global blueprint is keyed by the `globalMain` sentinel and
 * a component's widget by its component editor's pseudo surface, which is what the UI panel and the
 * property inspector open them with. Leaving the slot empty here gave the link a key of its own, so
 * following it opened a second editor on a blueprint that was already open.
 *
 * **Named the same way.** A tab that is already open keeps its name: the editor is opened under
 * several (the blueprint's own, the page's or control's logic), and following a link to it is not a
 * reason to rename it. A tab opened here is named after the blueprint, as quick open names it.
 * Without a workspace to ask, the title is left to the tab factory's generic one.
 */
export function blueprintJumpOpenTarget(
    target: BlueprintJumpTarget,
    owner: ParsedBlueprintOwnerKey,
    context: WorkspaceContext | null | undefined,
): BlueprintEditorOpenTarget {
    const place = {
        blueprintId: target.blueprintId,
        ownerKind: owner.ownerKind,
        surfaceId: blueprintTabSurfaceId(owner),
        componentId: owner.componentId,
        elementId: owner.elementId,
        propPath: owner.propPath,
    };
    return {
        ...place,
        focusEventId: target.focusEventId,
        focusFunctionId: target.focusFunctionId,
        focusNodeId: target.focusNodeId,
        title: context ? blueprintTabTitle(context, getBlueprintEntryTabId(place), target.blueprintId) : undefined,
    };
}

function blueprintTabSurfaceId(owner: ParsedBlueprintOwnerKey): string | undefined {
    switch (owner.ownerKind) {
        case "globalMain":
            return GLOBAL_MAIN_OWNER_KEY;
        case "componentWidgetMain":
            return owner.componentId ? getComponentEditorSurfaceId(owner.componentId) : undefined;
        default:
            return owner.surfaceId;
    }
}

function blueprintTabTitle(context: WorkspaceContext, tabId: string, blueprintId: string): string | undefined {
    const open = context.services.get<UIService>(Services.UI).editor.get(tabId);
    if (open) {
        return open.title;
    }
    try {
        const name = context.services
            .get<LocalBlueprintService>(Services.LocalBlueprint)
            .getBlueprintDocument()
            .blueprints[blueprintId]?.name;
        return name || undefined;
    } catch {
        // No blueprint document yet: the tab factory's generic name is the honest one.
        return undefined;
    }
}
