/**
 * Who still names a scene, a character or a variable, for the delete tools to refuse with.
 *
 * Found by value rather than by asking each row kind where it keeps its references: a jump, a menu
 * option, a call, a `Start Game` node, a speaker, a stage row, a variable ref in an expression and a
 * `Get`/`Set` node's variable param all hold the id as a plain string
 * somewhere in their payload, and the ids are UUIDs, so a string equal to one is a reference to it.
 * A row kind added later is covered without anyone remembering this file.
 *
 * Comments in English per project convention.
 */

import type { StoryBlock, StoryScene } from "@shared/types/story";
import type { StoryVariableValueType } from "@shared/types/story/document";
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

/**
 * Every blueprint that names `id`, by name and owner. `skip` leaves out blueprints that go with the
 * thing being deleted - a page's own, which may name the page they are on.
 */
export function blueprintReferencesTo(
    document: BlueprintDocument,
    id: string,
    skip?: (blueprint: BlueprintDocument["blueprints"][string]) => boolean,
): string[] {
    const ownerOf = new Map<string, string>();
    for (const [ownerKey, record] of Object.entries(document.ownerRecords ?? {})) {
        ownerOf.set(record.blueprintId, ownerKey);
    }
    return Object.values(document.blueprints ?? {})
        .filter(blueprint => !skip?.(blueprint))
        .filter(blueprint => holdsId(blueprint.graphs, id) || holdsId(blueprint.bindings, id))
        .map(blueprint => `blueprint "${blueprint.name}"${ownerOf.has(blueprint.id) ? ` (${ownerOf.get(blueprint.id)})` : ""}`);
}

/**
 * Every interface element that names `id` in its props, by page or component and name.
 * `skipSurfaceId` leaves out one page's own elements: the page being deleted.
 */
export function uiReferencesTo(document: UIDocument, id: string, skipSurfaceId?: string): string[] {
    const out: string[] = [];
    const describe = (element: UIElement) => element.name?.trim() || element.type;
    const pageOf = new Map<string, string>();
    const skipped = new Set<string>();
    for (const surface of document.surfaces) {
        const stack = [surface.rootElementId];
        while (stack.length > 0) {
            const elementId = stack.pop() as string;
            const element = document.elements[elementId];
            if (!element || pageOf.has(elementId)) {
                continue;
            }
            pageOf.set(elementId, surface.name);
            if (surface.id === skipSurfaceId) {
                skipped.add(elementId);
            }
            stack.push(...(element.childrenIds ?? []));
        }
    }
    for (const element of Object.values(document.elements)) {
        if (!skipped.has(element.id) && holdsId(element.props, id)) {
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

/** Whether a literal is a value of `valueType`. A json variable holds anything. */
function literalFits(value: unknown, valueType: StoryVariableValueType): boolean {
    switch (valueType) {
        case "boolean":
            return typeof value === "boolean";
        case "number":
            return typeof value === "number";
        case "string":
            return typeof value === "string";
        default:
            return true;
    }
}

const ORDERED_OPERATORS = new Set(["greaterThan", "greaterOrEqual", "lessThan", "lessOrEqual"]);

/**
 * What one story row does with variable `id` that a `valueType` variable can no longer take, or
 * null when nothing it does is wrong for that type: a `/set` writing a literal of another type, a
 * branch testing it as true/false, ordering it, or comparing it with a literal of another type.
 *
 * Only literals are judged. A computed right-hand side (`/set gold gold + 1`) or a typed expression
 * condition is evaluated at play time, and guessing its type here would be the kind of warning an
 * agent learns to read past.
 */
function misfitIn(block: StoryBlock, id: string, valueType: StoryVariableValueType): string | null {
    if (valueType === "json") {
        // Holds any value, so every literal and every test fits it.
        return null;
    }
    const payload = block.payload as Record<string, unknown>;
    if (payload.action === "setVariable" && (payload.target as { variableId?: string } | undefined)?.variableId === id) {
        if (payload.expression === undefined && !literalFits(payload.value, valueType)) {
            return `sets it to ${JSON.stringify(payload.value)}`;
        }
        return null;
    }
    let found: string | null = null;
    const walk = (value: unknown): void => {
        if (found || !value || typeof value !== "object") {
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(walk);
            return;
        }
        const node = value as Record<string, unknown>;
        if (node.kind === "variable" && typeof node.operator === "string" && (node.target as { variableId?: string } | undefined)?.variableId === id) {
            const operator = node.operator;
            if ((operator === "isTrue" || operator === "isFalse") && valueType !== "boolean") {
                found = `tests it as ${operator === "isTrue" ? "true" : "false"}`;
            } else if (ORDERED_OPERATORS.has(operator) && valueType === "boolean") {
                found = `orders it (${operator} ${JSON.stringify(node.value)})`;
            } else if (node.value !== undefined && operator !== "isTrue" && operator !== "isFalse" && operator !== "exists"
                && !literalFits(node.value, valueType)) {
                found = `compares it with ${JSON.stringify(node.value)} (${operator})`;
            }
            return;
        }
        Object.values(node).forEach(walk);
    };
    walk(payload);
    return found;
}

/**
 * Every story row whose use of variable `id` no longer fits once it is a `valueType` - what a retype
 * leaves behind, since nothing rewrites those rows. One readable line each, placed like
 * {@link storyReferencesTo}.
 */
export function storyUsesNotFitting(
    stories: readonly StoryLintStory[],
    id: string,
    valueType: StoryVariableValueType,
): string[] {
    const out: string[] = [];
    for (const story of stories) {
        for (const scene of scenesInOrder(story.document)) {
            rowsInOrder(scene).forEach((block, index) => {
                const misfit = misfitIn(block, id, valueType);
                if (misfit) {
                    out.push(`story "${story.name}", scene "${scene.name}", row ${index + 1}: ${misfit}`);
                }
            });
        }
    }
    return out;
}
