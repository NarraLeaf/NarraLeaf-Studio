/**
 * What a project already answers that a layer template would otherwise leave for the author.
 *
 * Each answer is read off the project as it stands, and each is one the author would give anyway:
 * the page every other confirmation in the project asks through, the scene the default story opens
 * on, the single element a page holds. Where the project does not answer - two confirmation pages in
 * equal use, a page with several elements - the field is left empty rather than guessed.
 *
 * Comments in English per project convention.
 */

import type { BlueprintDocument, BlueprintGraphIr, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_LAYER_CONFIRM } from "@shared/types/blueprint/graph";
import type { StoryDocument } from "@shared/types/story";
import { listSceneIdsInDocumentOrder } from "@shared/types/story";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { isDisplayableWidgetType } from "@shared/types/ui-editor/displayableWidgets";
import type { BlueprintLayerTemplateFacts } from "./blueprintLayerTemplates";

export type BlueprintLayerTemplateFactsInput = {
    owner: BlueprintOwnerRef;
    uiDocument: Pick<UIDocument, "surfaces" | "elements">;
    blueprintDocument: BlueprintDocument;
    /** The project's default story, or else the first one it lists. */
    storyId: string | undefined;
    storyDocuments: Readonly<Record<string, StoryDocument>>;
    text: BlueprintLayerTemplateFacts["text"];
};

export function collectBlueprintLayerTemplateFacts(input: BlueprintLayerTemplateFactsInput): BlueprintLayerTemplateFacts {
    return {
        pageContent: pageContentOf(input),
        confirmPage: confirmPageOf(input),
        gameStart: gameStartOf(input),
        text: input.text,
    };
}

function pageContentOf({ owner, uiDocument }: BlueprintLayerTemplateFactsInput): BlueprintLayerTemplateFacts["pageContent"] {
    if (owner.kind !== "surfaceMain") {
        return undefined;
    }
    const surface = uiDocument.surfaces.find(item => item.id === owner.surfaceId);
    const root = surface ? uiDocument.elements[surface.rootElementId] : undefined;
    const children = root?.childrenIds ?? [];
    const only = children.length === 1 ? uiDocument.elements[children[0]!] : undefined;
    return only && isDisplayableWidgetType(only.type) ? { surfaceId: owner.surfaceId, elementId: only.id } : undefined;
}

/** The page most of the project's `Show Confirm` nodes use, when one is used more than any other. */
function confirmPageOf({ uiDocument, blueprintDocument }: BlueprintLayerTemplateFactsInput): string | undefined {
    const pages = new Set(uiDocument.surfaces.map(surface => surface.id));
    const uses = new Map<string, number>();
    const visit = (graph: BlueprintGraphIr | undefined) => {
        for (const node of Object.values(graph?.nodes ?? {})) {
            const page = node.type === BLUEPRINT_NODE_TYPE_LAYER_CONFIRM ? node.params?.surfaceId : undefined;
            if (typeof page === "string" && pages.has(page)) {
                uses.set(page, (uses.get(page) ?? 0) + 1);
            }
        }
    };
    for (const blueprint of Object.values(blueprintDocument.blueprints)) {
        for (const layer of Object.values(blueprint.graphs.events ?? {})) {
            visit(layer.graph);
        }
        for (const fn of Object.values(blueprint.graphs.functions ?? {})) {
            visit(fn.graph);
        }
    }
    const ranked = [...uses.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0 || (ranked.length > 1 && ranked[0]![1] === ranked[1]![1])) {
        return undefined;
    }
    return ranked[0]![0];
}

function gameStartOf({ storyId, storyDocuments }: BlueprintLayerTemplateFactsInput): BlueprintLayerTemplateFacts["gameStart"] {
    const story = storyId ? storyDocuments[storyId] : undefined;
    if (!story || !storyId) {
        return undefined;
    }
    const sceneId = story.entrySceneId && story.scenes[story.entrySceneId]
        ? story.entrySceneId
        : listSceneIdsInDocumentOrder(story)[0];
    return sceneId ? { storyId, sceneId } : undefined;
}
