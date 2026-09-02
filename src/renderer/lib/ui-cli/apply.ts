/**
 * Putting a compiled file into the document.
 *
 * **A block describes a whole surface, or a whole component.** Applying one replaces its element
 * tree entire, including elements the file does not mention - `ui.element_dropped` and
 * `ui.orphaned_blueprint` name them before it happens. Blocks the file does not contain are left
 * exactly as they were, so a file may be one surface out of twelve.
 *
 * Structs and actions are document-wide tables and are merged by id rather than replaced, because a
 * file that declares one list's item shape has said nothing about the other eleven.
 *
 * Comments in English per project convention.
 */

import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { normalizeFlowChildLayouts } from "@services/ui-editor/uiDocumentTreeMove";
import type { UiCompileResult } from "./dsl/compile";
import { collectTree } from "./project";

export type ApplyResult = {
    surfacesAdded: string[];
    surfacesReplaced: string[];
    componentsAdded: string[];
    componentsReplaced: string[];
    elementsWritten: number;
    elementsRemoved: number;
    structsWritten: string[];
    actionsWritten: string[];
};

/**
 * `next`, in the order `previous` already had it, with genuinely new keys appended.
 *
 * Nothing reads the key order of an element map - every element is addressed by id, and the
 * semantic diff walks the tree - but a text diff does, and a reordered map is 20,000 lines of
 * churn hiding the five that changed. That is a merge conflict for every other branch touching the
 * same document, and a history nobody can read.
 *
 * Keys `previous` holds and `next` does not are dropped: this is a replacement, not a merge.
 */
export function mergePreservingOrder<T>(
    previous: Readonly<Record<string, T>>,
    next: Readonly<Record<string, T>>,
): Record<string, T> {
    const merged: Record<string, T> = {};
    for (const key of Object.keys(previous)) {
        if (Object.prototype.hasOwnProperty.call(next, key)) {
            merged[key] = next[key] as T;
        }
    }
    for (const [key, value] of Object.entries(next)) {
        if (!Object.prototype.hasOwnProperty.call(merged, key)) {
            merged[key] = value;
        }
    }
    return merged;
}

export function applyCompiled(document: UIDocument, compiled: UiCompileResult): ApplyResult {
    const result: ApplyResult = {
        surfacesAdded: [],
        surfacesReplaced: [],
        componentsAdded: [],
        componentsReplaced: [],
        elementsWritten: 0,
        elementsRemoved: 0,
        structsWritten: [],
        actionsWritten: [],
    };

    if (compiled.documentName) {
        document.name = compiled.documentName;
    }
    if (compiled.documentId) {
        document.id = compiled.documentId;
    }

    // Ids the trees being replaced hold today, collected before anything is written.
    //
    // Before the loop rather than inside it, because a tree walked after a sibling surface had
    // already landed could reach an id the new document now owns - and the removal pass at the
    // bottom would then delete an element that is in use.
    const lifted = new Set<string>();
    for (const compiledSurface of compiled.surfaces) {
        const existing = document.surfaces.find(surface => surface.id === compiledSurface.surface.id);
        if (!existing) {
            continue;
        }
        for (const element of collectTree(document.elements, existing.rootElementId)) {
            lifted.add(element.id);
        }
    }

    const written = new Set<string>();
    for (const compiledSurface of compiled.surfaces) {
        const index = document.surfaces.findIndex(surface => surface.id === compiledSurface.surface.id);
        if (index >= 0) {
            document.surfaces[index] = compiledSurface.surface;
            result.surfacesReplaced.push(compiledSurface.surface.name);
        } else {
            document.surfaces.push(compiledSurface.surface);
            result.surfacesAdded.push(compiledSurface.surface.name);
        }
        for (const [id, element] of Object.entries(compiledSurface.elements)) {
            // Written over itself rather than deleted and re-added, which is the whole of order
            // preservation: assigning a key an object already has leaves it where it is, and a key
            // it does not have is appended. See the note on {@link mergePreservingOrder}.
            document.elements[id] = element as UIElement;
            written.add(id);
            result.elementsWritten += 1;
        }
    }
    // Only now, and only what the new trees really dropped: an id the file kept was written back
    // over itself above, so deleting the old tree first would have moved every one of them.
    for (const id of lifted) {
        if (written.has(id)) {
            continue;
        }
        delete document.elements[id];
        result.elementsRemoved += 1;
    }

    if (compiled.components.length > 0) {
        const components = document.components ?? [];
        for (const compiledComponent of compiled.components) {
            const index = components.findIndex(component => component.id === compiledComponent.component.id);
            if (index >= 0) {
                // The component's own element map gets the same treatment the document's does, for
                // the same reason: replacing it wholesale would reorder every element of a
                // definition whose only change was one added child.
                components[index] = {
                    ...compiledComponent.component,
                    elements: mergePreservingOrder(
                        components[index].elements ?? {},
                        compiledComponent.component.elements ?? {},
                    ),
                };
                result.componentsReplaced.push(compiledComponent.component.name);
            } else {
                components.push(compiledComponent.component);
                result.componentsAdded.push(compiledComponent.component.name);
            }
            result.elementsWritten += Object.keys(compiledComponent.component.elements ?? {}).length;
        }
        document.components = components;
    }

    if (Object.keys(compiled.structs).length > 0) {
        document.structs = { ...(document.structs ?? {}), ...compiled.structs };
        result.structsWritten = Object.keys(compiled.structs);
    }
    if (Object.keys(compiled.actions).length > 0) {
        document.actions = { ...(document.actions ?? {}), ...compiled.actions };
        result.actionsWritten = Object.keys(compiled.actions);
    }

    // The same pass the editor runs after every tree change: a child of a stack or a list holds no
    // absolute position, and leaving stale coordinates on one is how a document written by hand and
    // one written by Studio come apart.
    normalizeFlowChildLayouts(document);
    return result;
}

export function formatApplyResult(result: ApplyResult, written: boolean): string {
    const lines: string[] = [];
    const say = (label: string, items: readonly string[]): void => {
        if (items.length > 0) {
            lines.push(`${label}: ${items.join(", ")}`);
        }
    };
    say("Surfaces added", result.surfacesAdded);
    say("Surfaces replaced", result.surfacesReplaced);
    say("Components added", result.componentsAdded);
    say("Components replaced", result.componentsReplaced);
    say("Structs written", result.structsWritten);
    say("Actions written", result.actionsWritten);
    lines.push(`${result.elementsWritten} element(s) written, ${result.elementsRemoved} removed.`);
    lines.push(written ? "Written." : "Dry run - pass --write to save.");
    return lines.join("\n");
}
