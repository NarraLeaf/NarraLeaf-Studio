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

    // Ids the old trees held, so the report can count what actually stopped existing rather than
    // counting every id that was rewritten over itself.
    const lifted = new Set<string>();
    for (const compiledSurface of compiled.surfaces) {
        const index = document.surfaces.findIndex(surface => surface.id === compiledSurface.surface.id);
        if (index >= 0) {
            // Every element the old tree held goes, then the new tree lands. Ids the file kept are
            // written straight back over themselves, so anything pointing at one still resolves.
            for (const element of collectTree(document.elements, document.surfaces[index].rootElementId)) {
                delete document.elements[element.id];
                lifted.add(element.id);
            }
            document.surfaces[index] = compiledSurface.surface;
            result.surfacesReplaced.push(compiledSurface.surface.name);
        } else {
            document.surfaces.push(compiledSurface.surface);
            result.surfacesAdded.push(compiledSurface.surface.name);
        }
        for (const [id, element] of Object.entries(compiledSurface.elements)) {
            document.elements[id] = element as UIElement;
            result.elementsWritten += 1;
        }
    }
    for (const id of lifted) {
        if (!document.elements[id]) {
            result.elementsRemoved += 1;
        }
    }

    if (compiled.components.length > 0) {
        const components = document.components ?? [];
        for (const compiledComponent of compiled.components) {
            const index = components.findIndex(component => component.id === compiledComponent.component.id);
            if (index >= 0) {
                components[index] = compiledComponent.component;
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
