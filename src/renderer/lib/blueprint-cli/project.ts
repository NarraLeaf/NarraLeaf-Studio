/**
 * Reading and writing the two project documents this tool touches.
 *
 * `editor/ui/uigraphs.json` is plain JSON on disk and is written back exactly the way
 * `UIGraphService` writes it - two-space JSON with a refreshed `meta.updatedAt` - so a file this
 * tool wrote and a file Studio wrote are the same shape, and version control sees one change rather
 * than a reformat.
 *
 * The blueprint schema version is checked before anything is written. The migration that lifts an
 * older document to the current shape needs a service to seed the variable registry as it runs, so
 * it cannot happen here; writing an unmigrated document back under the current version number would
 * be the migration silently not having run.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Blueprint, BlueprintDocument, BlueprintPrivateOwnerRecord } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { listSaveSchemaFields, migrateSaveSchemaToLatest } from "@shared/saves/saveSchemaModel";
import { setActiveSaveSchemaFields } from "@shared/saves/saveSchemaRegistry";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";

export const UI_GRAPHS_RELATIVE_PATH = path.join("editor", "ui", "uigraphs.json");
export const UI_DOCUMENT_RELATIVE_PATH = path.join("editor", "ui", "uidoc.json");
export const SAVE_SCHEMA_RELATIVE_PATH = path.join("editor", "save-schema.json");

export type UiGraphsFile = {
    filePath: string;
    /** The whole document, including the parts this tool does not understand. */
    raw: Record<string, unknown>;
    blueprintDocument: BlueprintDocument;
};

export class ProjectIoError extends Error {}

export function resolveProjectDir(input: string): string {
    const resolved = path.resolve(input);
    if (!fs.existsSync(path.join(resolved, UI_GRAPHS_RELATIVE_PATH))) {
        throw new ProjectIoError(
            `"${resolved}" does not look like a NarraLeaf project: no ${UI_GRAPHS_RELATIVE_PATH}.`,
        );
    }
    return resolved;
}

export function readUiGraphs(projectDir: string): UiGraphsFile {
    const filePath = path.join(projectDir, UI_GRAPHS_RELATIVE_PATH);
    let raw: Record<string, unknown>;
    try {
        raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    } catch (error) {
        throw new ProjectIoError(`Cannot read ${filePath}: ${(error as Error).message}`);
    }
    const document = raw.blueprintDocument as BlueprintDocument | undefined;
    if (!document || typeof document !== "object") {
        throw new ProjectIoError(`${filePath} has no "blueprintDocument".`);
    }
    return {
        filePath,
        raw,
        blueprintDocument: {
            schemaVersion: document.schemaVersion,
            blueprints: document.blueprints ?? {},
            ownerRecords: document.ownerRecords ?? {},
            meta: document.meta,
        },
    };
}

export function assertWritableSchema(file: UiGraphsFile): void {
    if (file.blueprintDocument.schemaVersion === BLUEPRINT_DOCUMENT_SCHEMA_VERSION) {
        return;
    }
    throw new ProjectIoError(
        `${file.filePath} carries blueprint schema v${file.blueprintDocument.schemaVersion}, and this `
            + `Studio writes v${BLUEPRINT_DOCUMENT_SCHEMA_VERSION}. Open the project in Studio once so it `
            + "migrates, then run this again.",
    );
}

export type ApplyResult = {
    added: string[];
    replaced: string[];
};

/** Put compiled blueprints into the document, replacing whatever occupied the same owner. */
export function applyBlueprints(
    file: UiGraphsFile,
    blueprints: readonly Blueprint[],
    ownerRecords: Record<string, BlueprintPrivateOwnerRecord>,
): ApplyResult {
    const document = file.blueprintDocument;
    const result: ApplyResult = { added: [], replaced: [] };
    for (const blueprint of blueprints) {
        if (document.blueprints[blueprint.id]) {
            result.replaced.push(blueprint.name);
        } else {
            result.added.push(blueprint.name);
        }
        document.blueprints[blueprint.id] = blueprint;
    }
    for (const [ownerKey, record] of Object.entries(ownerRecords)) {
        const previous = document.ownerRecords[ownerKey];
        const others = (previous?.privateBlueprintIds ?? []).filter(
            id => id !== record.activeBlueprintId && document.blueprints[id],
        );
        document.ownerRecords[ownerKey] = {
            ...previous,
            activeBlueprintId: record.activeBlueprintId,
            privateBlueprintIds: [record.activeBlueprintId, ...others],
        };
    }
    return result;
}

export function writeUiGraphs(file: UiGraphsFile): void {
    const meta = (file.raw.meta ?? {}) as Record<string, unknown>;
    const updated = {
        ...file.raw,
        blueprintDocument: file.blueprintDocument,
        meta: { ...meta, updatedAt: new Date().toISOString() },
    };
    fs.writeFileSync(file.filePath, JSON.stringify(updated, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// The interface document, read only to answer "what surfaces and elements exist"
// ---------------------------------------------------------------------------

export type SurfaceTarget = {
    id: string;
    name: string;
    kind?: string;
    host?: string;
    rootElementId?: string;
};

export type ElementTarget = {
    id: string;
    type: string;
    name: string;
    surfaceId: string;
    /** Ancestor names from the surface root down, for telling two "Button" apart. */
    path: string;
};

type UiDocumentElement = {
    id: string;
    type: string;
    name?: string;
    parentId?: string | null;
    childrenIds?: string[];
};

export type UiDocumentTargets = {
    surfaces: SurfaceTarget[];
    elements: ElementTarget[];
    /** The raw element records, which the graph validator wants whole. */
    raw: Record<string, UiDocumentElement>;
};

export function readUiDocumentTargets(projectDir: string): UiDocumentTargets {
    const filePath = path.join(projectDir, UI_DOCUMENT_RELATIVE_PATH);
    if (!fs.existsSync(filePath)) {
        return { surfaces: [], elements: [], raw: {} };
    }
    let raw: {
        surfaces?: SurfaceTarget[];
        elements?: Record<string, UiDocumentElement>;
    };
    try {
        raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        throw new ProjectIoError(`Cannot read ${filePath}: ${(error as Error).message}`);
    }
    const surfaces = raw.surfaces ?? [];
    const elements = raw.elements ?? {};
    const out: ElementTarget[] = [];
    for (const surface of surfaces) {
        if (!surface.rootElementId) {
            continue;
        }
        walkElements(surface.rootElementId, surface.id, [], elements, out);
    }
    return { surfaces, elements: out, raw: elements };
}

function walkElements(
    elementId: string,
    surfaceId: string,
    ancestors: string[],
    pool: Record<string, UiDocumentElement>,
    out: ElementTarget[],
    depth = 0,
): void {
    const element = pool[elementId];
    if (!element || depth > 64) {
        return;
    }
    const name = element.name ?? element.type;
    out.push({
        id: element.id,
        type: element.type,
        name,
        surfaceId,
        path: [...ancestors, name].join(" / "),
    });
    for (const childId of element.childrenIds ?? []) {
        walkElements(childId, surfaceId, [...ancestors, name], pool, out, depth + 1);
    }
}

// ---------------------------------------------------------------------------
// Save schema
// ---------------------------------------------------------------------------

/**
 * Publish the project's save fields before any pin is resolved.
 *
 * `Save Game` and `Get Save Metadata` grow one pin per declared field, and they read them from a
 * module-level registry rather than from anything threaded through. Without this, a graph that
 * wires a save field looks to the checker like a graph wiring a pin that does not exist.
 */
export function loadSaveSchema(projectDir: string): number {
    const filePath = path.join(projectDir, SAVE_SCHEMA_RELATIVE_PATH);
    if (!fs.existsSync(filePath)) {
        setActiveSaveSchemaFields([]);
        return 0;
    }
    try {
        const schema = migrateSaveSchemaToLatest(JSON.parse(fs.readFileSync(filePath, "utf8")));
        const fields = listSaveSchemaFields(schema);
        setActiveSaveSchemaFields(fields);
        return fields.length;
    } catch {
        setActiveSaveSchemaFields([]);
        return 0;
    }
}

/**
 * What kind of element a `widgetMain` / `componentWidgetMain` blueprint hangs off.
 *
 * Which event heads a widget blueprint may carry depends on it - `Item Click` belongs to a list,
 * `Mouse Click` to a button - so the scope check is only real when the interface document is at
 * hand to answer this.
 */
export function widgetElementTypeResolver(
    targets: UiDocumentTargets,
): (owner: { kind: string; elementId?: string }) => string | undefined {
    const byId = new Map(targets.elements.map(element => [element.id, element.type]));
    return owner => (owner.elementId ? byId.get(owner.elementId) : undefined);
}

/**
 * The whole element record and the surface it sits on, which is what the graph validator needs to
 * judge a widget blueprint: which event heads that widget carries, and which of its UI slots point
 * at the layer being validated.
 */
export function widgetElementResolver(
    targets: UiDocumentTargets,
): (owner: { kind: string; surfaceId?: string; elementId?: string }) =>
    { element: unknown; surfaceId: string } | undefined {
    return owner => {
        if (owner.kind !== "widgetMain" || !owner.elementId || !owner.surfaceId) {
            return undefined;
        }
        const element = targets.raw[owner.elementId];
        return element ? { element, surfaceId: owner.surfaceId } : undefined;
    };
}

// ---------------------------------------------------------------------------
// Project-level variables
// ---------------------------------------------------------------------------

export const VARIABLE_REGISTRY_RELATIVE_PATH = path.join("editor", "variables.json");

export type ProjectVariables = {
    persistent: VariableRegistryEntry[];
    saved: VariableRegistryEntry[];
};

/**
 * The project-level variable registry, which is what a `Get Persistent` / `Get Saved` node's id is
 * checked against.
 *
 * Only the registry: the same two scopes can also be declared by a `/save` or `/global` row inside a
 * story document, and reading those means parsing (and migrating) every story in the project. A node
 * pointing at one of those is reported as an unresolved variable here - a warning, never a refusal.
 */
export function readVariableRegistry(projectDir: string): ProjectVariables {
    const filePath = path.join(projectDir, VARIABLE_REGISTRY_RELATIVE_PATH);
    if (!fs.existsSync(filePath)) {
        return { persistent: [], saved: [] };
    }
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
            entries?: Record<string, VariableRegistryEntry>;
        };
        const entries = Object.values(raw.entries ?? {});
        return {
            persistent: entries.filter(entry => entry.scope === "persistent"),
            saved: entries.filter(entry => entry.scope === "saved"),
        };
    } catch {
        return { persistent: [], saved: [] };
    }
}
