import { GLOBAL_MAIN_OWNER_KEY } from "@shared/blueprint/ownerKey";
import { blueprintDisplayName } from "@shared/types/ui-editor/ownerLabels";
import { translate } from "@/lib/i18n";
import type { ParsedBlueprintOwnerKey } from "@/lib/workspace/services/search/blueprintOwnerKey";
import type { SearchJumpTarget } from "@/lib/workspace/services/search/searchIndexModel";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import { workspaceStoryBlueprintSummary } from "@/lib/story/storyBlueprintSummary";
import type { BlueprintEditorOpenTarget } from "@/lib/workspace/services/ui-editor/blueprint/navigationTargets";
import { getBlueprintEntryTabId } from "../blueprint-lite/blueprintEntryTabId";
import { getComponentEditorSurfaceId } from "../ui-editor/editors/componentEditorAdapter";

type BlueprintJumpTarget = Extract<SearchJumpTarget, { kind: "blueprint" }>;

/**
 * Where a deep link into a blueprint - a search hit, a problem, a reference - lands: the blueprint
 * editor tab for that blueprint, as {@link blueprintOwnerOpenTarget} addresses and names it, with
 * the event, function or node the link points at to focus.
 */
export function blueprintJumpOpenTarget(
    target: BlueprintJumpTarget,
    owner: ParsedBlueprintOwnerKey,
    context: WorkspaceContext | null | undefined,
): BlueprintEditorOpenTarget {
    return {
        ...blueprintOwnerOpenTarget(target.blueprintId, owner, context),
        focusEventId: target.focusEventId,
        focusFunctionId: target.focusFunctionId,
        focusNodeId: target.focusNodeId,
    };
}

/**
 * The blueprint editor tab for one owner's blueprint, addressed and named the way every other way
 * into it does. What a way in that knows only the blueprint and its owner - quick open, the project
 * scripts list, a search hit - opens, so that it lands on the tab already open rather than beside it.
 *
 * **Addressed the same way.** A blueprint tab is keyed by its owner's surface slot, and two owners
 * have no real surface to put there: the global blueprint is keyed by the `globalMain` sentinel and
 * a component's widget by its component editor's pseudo surface, which is what the UI panel and the
 * property inspector open them with. Leaving the slot empty gave the opener a key of its own, so it
 * opened a second editor on a blueprint that was already open.
 *
 * **Named the same way.** A tab that is already open keeps its name: the editor is opened under
 * several (the blueprint's own, the page's or control's logic), and reaching it again is not a
 * reason to rename it. A tab opened here is named after the blueprint. Without a workspace to ask,
 * the title is left to the tab factory's generic one.
 */
export function blueprintOwnerOpenTarget(
    blueprintId: string,
    owner: ParsedBlueprintOwnerKey,
    context: WorkspaceContext | null | undefined,
): BlueprintEditorOpenTarget {
    const place = {
        blueprintId,
        ownerKind: owner.ownerKind,
        surfaceId: blueprintTabSurfaceId(owner),
        componentId: owner.componentId,
        elementId: owner.elementId,
        propPath: owner.propPath,
    };
    return {
        ...place,
        title: context ? blueprintTabTitle(context, getBlueprintEntryTabId(place), blueprintId) : undefined,
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
        const document = context.services.get<LocalBlueprintService>(Services.LocalBlueprint).getBlueprintDocument();
        const blueprint = document.blueprints[blueprintId];
        if (!blueprint) {
            return undefined;
        }
        // Named as Quick Open lists it: a story blueprint nobody named by what it does.
        const whatItDoes = blueprint.owner?.kind === "storyAction"
            ? workspaceStoryBlueprintSummary(
                document,
                context.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog),
                translate,
            )(blueprint)
            : null;
        return blueprintDisplayName(blueprint, translate, whatItDoes) || undefined;
    } catch {
        // No blueprint document yet: the tab factory's generic name is the honest one.
        return undefined;
    }
}
