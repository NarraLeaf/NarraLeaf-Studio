/**
 * Every place an asset's id is written in the project's stories, interface and blueprints, found by
 * reading the stored values rather than by knowing which fields hold assets.
 *
 * The usage index (`ReferenceService`) is precise - it knows a background from a mask and can jump to
 * the field - but it is only as complete as its list of fields, and a row kind missing from that list
 * reads as "nothing uses this asset". An agent that deletes what lint calls unused then deletes a
 * live asset: a whole set of `/vfx` clips once went that way. This walk knows nothing about fields,
 * so it cannot miss one; it is the second opinion `asset_delete` asks before it deletes, and what
 * `asset_usage` lists beside the index.
 *
 * Pure over the documents it is handed.
 *
 * Comments in English per project convention.
 */

import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { StoryDocument } from "@shared/types/story";
import { listSceneBlocksInDocumentOrder, listScenesInDocumentOrder } from "@shared/types/story";
import type { UIDocument } from "@shared/types/ui-editor/document";

export type AssetMention = {
    kind: "storyRow" | "scene" | "uiElement" | "uiSurface" | "blueprint";
    /** Where, in words an author reads: `Main / Opening:12`, `page "Title" / Start`, `blueprint "Quit"`. */
    where: string;
};

/** Whether `value` holds `id` anywhere: as itself, or as a string or key inside it. */
export function mentions(value: unknown, id: string, depth = 0): boolean {
    if (depth > 64) {
        return false;
    }
    if (typeof value === "string") {
        return value === id || value.includes(id);
    }
    if (Array.isArray(value)) {
        return value.some(item => mentions(item, id, depth + 1));
    }
    if (value && typeof value === "object") {
        return Object.entries(value as Record<string, unknown>).some(([key, item]) => key === id || mentions(item, id, depth + 1));
    }
    return false;
}

export function findAssetMentions(input: {
    assetId: string;
    stories: readonly { name: string; document: StoryDocument }[];
    uiDocument?: UIDocument | null;
    blueprintDocument?: BlueprintDocument | null;
}): AssetMention[] {
    const id = input.assetId.trim();
    const out: AssetMention[] = [];
    if (!id) {
        return out;
    }
    for (const { name, document } of input.stories) {
        for (const scene of listScenesInDocumentOrder(document)) {
            const { blocks: _blocks, rootBlockIds: _roots, ...settings } = scene;
            if (mentions(settings, id)) {
                out.push({ kind: "scene", where: `${name} / ${scene.name} (scene settings)` });
            }
            listSceneBlocksInDocumentOrder(scene).forEach((block, index) => {
                if (mentions(block.payload, id)) {
                    out.push({ kind: "storyRow", where: `${name} / ${scene.name}:${index + 1}` });
                }
            });
        }
    }
    const ui = input.uiDocument;
    if (ui) {
        const surfaceByRoot = new Map(ui.surfaces.map(surface => [surface.rootElementId, surface.name]));
        const pageOf = (elementId: string): string | null => {
            let current = ui.elements[elementId];
            const seen = new Set<string>();
            while (current?.parentId && !seen.has(current.id)) {
                seen.add(current.id);
                current = ui.elements[current.parentId];
            }
            return current ? surfaceByRoot.get(current.id) ?? null : null;
        };
        for (const surface of ui.surfaces) {
            if (mentions(surface.settings, id)) {
                out.push({ kind: "uiSurface", where: `page "${surface.name}" (page settings)` });
            }
        }
        for (const element of Object.values(ui.elements)) {
            const { childrenIds: _children, parentId: _parent, ...rest } = element;
            if (mentions(rest, id)) {
                const page = pageOf(element.id);
                out.push({ kind: "uiElement", where: `${page ? `page "${page}"` : "an element on no page"} / ${element.name ?? element.type}` });
            }
        }
        for (const component of ui.components ?? []) {
            for (const element of Object.values(component.elements)) {
                const { childrenIds: _children, parentId: _parent, ...rest } = element;
                if (mentions(rest, id)) {
                    out.push({ kind: "uiElement", where: `component "${component.name}" / ${element.name ?? element.type}` });
                }
            }
        }
    }
    for (const blueprint of Object.values(input.blueprintDocument?.blueprints ?? {})) {
        if (mentions(blueprint.graphs, id) || mentions(blueprint.members, id) || mentions(blueprint.bindings, id)) {
            out.push({ kind: "blueprint", where: `blueprint "${blueprint.name}"` });
        }
    }
    return out;
}
