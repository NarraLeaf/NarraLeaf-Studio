/**
 * Who still names a scene or a character, for the delete tools to refuse with.
 *
 * Found by value rather than by asking each row kind where it keeps its references: a jump, a menu
 * option, a call, a `Start Game` node, a speaker and a stage row all hold the id as a plain string
 * somewhere in their payload, and the ids are UUIDs, so a string equal to one is a reference to it.
 * A row kind added later is covered without anyone remembering this file.
 *
 * Comments in English per project convention.
 */

import type { StoryBlock, StoryScene } from "@shared/types/story";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { StoryLintStory } from "@/lib/agent-core";
import { scenesInOrder } from "./agentLookups";

/** Whether `value` holds the string `id` anywhere inside it, keys excluded. */
export function holdsId(value: unknown, id: string): boolean {
    if (typeof value === "string") {
        return value === id;
    }
    if (Array.isArray(value)) {
        return value.some(item => holdsId(item, id));
    }
    if (value && typeof value === "object") {
        return Object.values(value as Record<string, unknown>).some(item => holdsId(item, id));
    }
    return false;
}

/** A scene's rows in reading order: the tree depth first, then any row the tree does not reach. */
export function rowsInOrder(scene: StoryScene): StoryBlock[] {
    const blocks = scene.blocks ?? {};
    const out: StoryBlock[] = [];
    const seen = new Set<string>();
    const walk = (ids: readonly string[] | undefined) => {
        for (const id of ids ?? []) {
            const block = blocks[id];
            if (!block || seen.has(id)) {
                continue;
            }
            seen.add(id);
            out.push(block);
            walk(block.childrenIds);
        }
    };
    walk(scene.rootBlockIds);
    for (const block of Object.values(blocks)) {
        if (!seen.has(block.id)) {
            out.push(block);
        }
    }
    return out;
}

/**
 * Every place in the stories that names `id`, one readable line each: the row (1-based, in reading
 * order) and its kind, or the scene's own settings. `skip` leaves out one scene - the one being
 * deleted, whose own rows go with it.
 */
export function storyReferencesTo(
    stories: readonly StoryLintStory[],
    id: string,
    skip?: { storyId: string; sceneId: string },
): string[] {
    const out: string[] = [];
    for (const story of stories) {
        for (const scene of scenesInOrder(story.document)) {
            if (skip && skip.storyId === story.id && skip.sceneId === scene.id) {
                continue;
            }
            const place = `story "${story.name}", scene "${scene.name}"`;
            const { blocks: _blocks, ...settings } = scene;
            if (holdsId(settings, id)) {
                out.push(`${place}: the scene's own settings`);
            }
            rowsInOrder(scene).forEach((block, index) => {
                if (holdsId(block, id)) {
                    out.push(`${place}, row ${index + 1} (${block.kind})`);
                }
            });
        }
    }
    return out;
}

/** Every blueprint that names `id`, by name and owner. */
export function blueprintReferencesTo(document: BlueprintDocument, id: string): string[] {
    const ownerOf = new Map<string, string>();
    for (const [ownerKey, record] of Object.entries(document.ownerRecords ?? {})) {
        ownerOf.set(record.blueprintId, ownerKey);
    }
    return Object.values(document.blueprints ?? {})
        .filter(blueprint => holdsId(blueprint.graphs, id) || holdsId(blueprint.bindings, id))
        .map(blueprint => `blueprint "${blueprint.name}"${ownerOf.has(blueprint.id) ? ` (${ownerOf.get(blueprint.id)})` : ""}`);
}

/** Every interface element that names `id` in its props, by page or component and name. */
export function uiReferencesTo(document: UIDocument, id: string): string[] {
    const out: string[] = [];
    const describe = (element: UIElement) => element.name?.trim() || element.type;
    const pageOf = new Map<string, string>();
    for (const surface of document.surfaces) {
        const stack = [surface.rootElementId];
        while (stack.length > 0) {
            const elementId = stack.pop() as string;
            const element = document.elements[elementId];
            if (!element || pageOf.has(elementId)) {
                continue;
            }
            pageOf.set(elementId, surface.name);
            stack.push(...(element.childrenIds ?? []));
        }
    }
    for (const element of Object.values(document.elements)) {
        if (holdsId(element.props, id)) {
            out.push(`page "${pageOf.get(element.id) ?? "?"}", element "${describe(element)}"`);
        }
    }
    for (const component of document.components ?? []) {
        for (const element of Object.values(component.elements)) {
            if (holdsId(element.props, id)) {
                out.push(`component "${component.name}", element "${describe(element)}"`);
            }
        }
    }
    return out;
}

/** A refusal's list of referrers, capped so a heavily used character does not flood the answer. */
export function formatReferrers(referrers: readonly string[], limit = 30): string {
    const shown = referrers.slice(0, limit).map(line => `  ${line}`);
    if (referrers.length > limit) {
        shown.push(`  ... and ${referrers.length - limit} more`);
    }
    return shown.join("\n");
}
