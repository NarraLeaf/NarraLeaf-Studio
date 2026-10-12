/**
 * The blueprint tool's view of a project, as functions of documents rather than of a directory.
 *
 * `project.ts` reads `uigraphs.json`, `uidoc.json`, the variable registry and the save schema off
 * disk and hands the parsed documents to the functions here; Studio's agent bridge hands in the live
 * documents its services hold. Both then judge a graph against the same targets, variables and
 * asset names, so the terminal and the open project cannot disagree about a blueprint.
 *
 * Nothing in this file may import a Node module (`agent-core/bundle.test.ts` enforces it).
 *
 * Comments in English per project convention.
 */

import { normalizeUIStructLibrary } from "@shared/types/ui-editor/structLibrary";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import type { Blueprint, BlueprintDocument, BlueprintPrivateOwnerRecord } from "@shared/types/blueprint/document";
import { listSaveSchemaFields, migrateSaveSchemaToLatest } from "@shared/saves/saveSchemaModel";
import { setActiveSaveSchemaFields } from "@shared/saves/saveSchemaRegistry";
import { setActiveUIPageParams } from "@shared/types/ui-editor/pageParams";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { StoryDocument } from "@shared/types/story";
import { extractStoryVariableWrites, type StoryVariableWrite } from "@services/references/assetNameGaps";

/** A project document that cannot be read or written. The command line leaves with 2 on one. */
export class ProjectIoError extends Error {}

// ---------------------------------------------------------------------------
// The blueprint document
// ---------------------------------------------------------------------------

/**
 * The stored blueprint document, migrated the way the editor migrates it on read and with its
 * optional tables filled in. A document below the migration floor throws, from the migration itself.
 */
export function readableBlueprintDocument(stored: BlueprintDocument): BlueprintDocument {
    const document = migrateBlueprintDocumentToLatest(stored);
    return {
        schemaVersion: document.schemaVersion,
        blueprints: document.blueprints ?? {},
        ownerRecords: document.ownerRecords ?? {},
        meta: document.meta,
    };
}

export type ApplyResult = {
    added: string[];
    replaced: string[];
};

/** Put compiled blueprints into `document` in place, replacing whatever occupied the same owner. */
export function applyBlueprintsToDocument(
    document: BlueprintDocument,
    blueprints: readonly Blueprint[],
    ownerRecords: Record<string, BlueprintPrivateOwnerRecord>,
): ApplyResult {
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
        document.ownerRecords[ownerKey] = { blueprintId: record.blueprintId };
    }
    return result;
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
    /** The page's declared parameters as stored; read through `getUIPageParams`. */
    params?: unknown;
};

/** A component definition, which owns an element tree of its own. */
export type ComponentTarget = {
    id: string;
    name: string;
    rootElementId?: string;
    /** The params each instance supplies, which a `Get Component Param` node picks from. */
    params: { id: string; name: string; defaultValue: string }[];
};

export type ElementTarget = {
    id: string;
    type: string;
    name: string;
    /** The surface this element sits on; null when it belongs to a component definition. */
    surfaceId: string | null;
    /** The component definition this element belongs to; null when it sits on a surface. */
    componentId: string | null;
    /** Ancestor names from the tree's root down, for telling two "Button" apart. */
    path: string;
};

type UiDocumentElement = {
    id: string;
    type: string;
    name?: string;
    parentId?: string | null;
    childrenIds?: string[];
};

type UiDocumentComponent = {
    id: string;
    name?: string;
    rootElementId?: string;
    elements?: Record<string, UiDocumentElement>;
    params?: { id?: string; name?: string; defaultValue?: string }[];
};

export type UiDocumentTargets = {
    surfaces: SurfaceTarget[];
    components: ComponentTarget[];
    /** Every element in the document, whether a surface or a component definition owns it. */
    elements: ElementTarget[];
    /** The raw element records, which the graph validator wants whole. */
    raw: Record<string, UiDocumentElement>;
    /** The document's list shapes, by id - what a field reader in a list row reads. */
    structs: Record<string, UIStructDef>;
};

/** The shape of the interface document this reads; anything else in it is ignored. */
export type UiDocumentTargetSource = {
    surfaces?: SurfaceTarget[];
    components?: UiDocumentComponent[];
    elements?: Record<string, UiDocumentElement>;
    structs?: unknown;
};

/**
 * The surfaces, the component definitions, and every element either of them owns. A missing
 * document has none of any.
 *
 * Component elements are read from the component's **own** element table rather than from the
 * document's, because that is where they live: a definition is a tree apart, instantiated wherever
 * somebody places it. Leaving them out is not a smaller answer but a wrong one - a
 * `componentWidgetMain` blueprint would have no element type to check its event heads against, and
 * every head on it would be refused as out of scope for a widget nobody could identify.
 */
export function uiDocumentTargetsOf(raw: UiDocumentTargetSource | UIDocument | null | undefined): UiDocumentTargets {
    if (!raw) {
        return { surfaces: [], components: [], elements: [], raw: {}, structs: {} };
    }
    const source = raw as UiDocumentTargetSource;
    const surfaces = source.surfaces ?? [];
    const elements = source.elements ?? {};
    const out: ElementTarget[] = [];
    for (const surface of surfaces) {
        if (!surface.rootElementId) {
            continue;
        }
        walkElements(surface.rootElementId, { surfaceId: surface.id, componentId: null }, [], elements, out);
    }
    const components: ComponentTarget[] = [];
    // One flat pool, so a resolver can answer about any element by id alone. Ids are unique across
    // the document - the editor mints them the same way for both tables - so the merge cannot hide
    // a surface element behind a component one.
    const pool: Record<string, UiDocumentElement> = { ...elements };
    for (const component of source.components ?? []) {
        if (!component?.id) {
            continue;
        }
        components.push({
            id: component.id,
            name: component.name ?? component.id,
            rootElementId: component.rootElementId,
            params: (component.params ?? []).map(param => ({
                id: String(param?.id ?? ""),
                name: String(param?.name ?? ""),
                defaultValue: String(param?.defaultValue ?? ""),
            })).filter(param => param.id),
        });
        const own = component.elements ?? {};
        Object.assign(pool, own);
        if (component.rootElementId) {
            walkElements(component.rootElementId, { surfaceId: null, componentId: component.id }, [], own, out);
        }
    }
    return { surfaces, components, elements: out, raw: pool, structs: normalizeUIStructLibrary(source.structs) };
}

function walkElements(
    elementId: string,
    owner: { surfaceId: string | null; componentId: string | null },
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
        surfaceId: owner.surfaceId,
        componentId: owner.componentId,
        path: [...ancestors, name].join(" / "),
    });
    for (const childId of element.childrenIds ?? []) {
        walkElements(childId, owner, [...ancestors, name], pool, out, depth + 1);
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

/** The type of any element in the document, by id, for filling in element references. */
export function elementTypeResolver(targets: UiDocumentTargets): (elementId: string) => string | undefined {
    const byId = new Map(targets.elements.map(element => [element.id, element.type]));
    return elementId => byId.get(elementId);
}

/**
 * The element record behind a widget owner, and the surface it sits on when it sits on one.
 *
 * A `componentWidgetMain` owner answers with the element and **no surface**, which is the honest
 * answer rather than a missing one: a definition is instantiated wherever somebody places it, so
 * there is no single surface its elements are on. The validator uses the element for the scope
 * check and the surface id only for the checks that are about a surface - which are exactly the
 * ones that cannot be asked here.
 */
export function widgetElementResolver(
    targets: UiDocumentTargets,
): (owner: { kind: string; surfaceId?: string; elementId?: string }) =>
    { element: unknown; surfaceId?: string } | undefined {
    return owner => {
        if (!owner.elementId) {
            return undefined;
        }
        if (owner.kind === "componentWidgetMain") {
            const element = targets.raw[owner.elementId];
            return element ? { element } : undefined;
        }
        if (owner.kind !== "widgetMain" || !owner.surfaceId) {
            return undefined;
        }
        const element = targets.raw[owner.elementId];
        return element ? { element, surfaceId: owner.surfaceId } : undefined;
    };
}

// ---------------------------------------------------------------------------
// The module-level tables a node's pins are read from
// ---------------------------------------------------------------------------

/**
 * Publish the parameters the project's pages declare before any pin is resolved.
 *
 * `Go Page` and the other nodes that open a page grow an input per parameter the picked page
 * declares, and `Get Page Param` reads one by id - both through the module-level table the editor
 * fills (`setActiveUIPageParams`). Without this a graph that gives a page its parameters looks to the
 * checker like one wiring inputs that do not exist.
 *
 * A running Studio publishes this table itself (`UIDocumentService` on every document change), so
 * only a headless caller - the command line - calls this.
 */
export function publishPageParams(uiDocument: { surfaces?: SurfaceTarget[] } | null | undefined): void {
    try {
        setActiveUIPageParams(
            (uiDocument?.surfaces ?? []).filter(surface => typeof surface?.id === "string").map(surface => ({
                id: surface.id,
                kind: surface.kind === "stageSurface" ? "stageSurface" : "appSurface",
                params: surface.params,
            })),
        );
    } catch {
        setActiveUIPageParams([]);
    }
}

/**
 * Publish the project's save fields before any pin is resolved, from the parsed
 * `editor/save-schema.json` (null when the project has none). Returns how many fields it declares.
 *
 * `Save Game` and `Get Save Metadata` grow one pin per declared field, and they read them from a
 * module-level registry rather than from anything threaded through. Without this, a graph that
 * wires a save field looks to the checker like a graph wiring a pin that does not exist. A running
 * Studio publishes it itself (`SaveSchemaService`), so only a headless caller calls this.
 */
export function publishSaveSchema(rawSchema: unknown): number {
    if (rawSchema == null) {
        setActiveSaveSchemaFields([]);
        return 0;
    }
    try {
        const fields = listSaveSchemaFields(migrateSaveSchemaToLatest(rawSchema));
        setActiveSaveSchemaFields(fields);
        return fields.length;
    } catch {
        setActiveSaveSchemaFields([]);
        return 0;
    }
}

// ---------------------------------------------------------------------------
// Project-level variables
// ---------------------------------------------------------------------------

export type ProjectVariables = {
    persistent: VariableRegistryEntry[];
    saved: VariableRegistryEntry[];
};

/**
 * The project-level variable registry, which is what a `Get Persistent` / `Get Saved` node's id is
 * checked against. Takes the parsed `editor/variables.json` (`{ entries }`), or the entries as a list.
 *
 * Only the registry: the same two scopes can also be declared by a `/save` or `/global` row inside a
 * story document, and reading those means parsing (and migrating) every story in the project. A node
 * pointing at one of those is reported as an unresolved variable here - a warning, never a refusal.
 */
export function projectVariablesOf(
    registry: { entries?: Record<string, VariableRegistryEntry> } | readonly VariableRegistryEntry[] | null | undefined,
): ProjectVariables {
    const entries = Array.isArray(registry)
        ? [...registry]
        : Object.values((registry as { entries?: Record<string, VariableRegistryEntry> } | null | undefined)?.entries ?? {});
    return {
        persistent: entries.filter(entry => entry.scope === "persistent"),
        saved: entries.filter(entry => entry.scope === "saved"),
    };
}

// ---------------------------------------------------------------------------
// Asset names
// ---------------------------------------------------------------------------

export type AssetNameContext = {
    uiDocument: UIDocument | null;
    storyWrites: StoryVariableWrite[];
};

/**
 * What the asset-name judgement needs from the project besides its graphs: the interface, and every
 * variable a story row writes. `stories` are the project's story documents, already migrated.
 *
 * A story whose rows cannot be read is left out rather than stopping the check - `story check` is
 * the tool that says so, and a blueprint check that refused to run over it would say nothing about
 * the graphs instead.
 */
export function assetNameContextOf(
    uiDocument: UIDocument | null,
    stories: readonly { name: string; document: StoryDocument }[],
): AssetNameContext {
    const storyWrites: StoryVariableWrite[] = [];
    for (const story of stories) {
        try {
            storyWrites.push(...extractStoryVariableWrites(story.document, story.name));
        } catch {
            // See above: reported by the story tool, not here.
        }
    }
    return { uiDocument, storyWrites };
}
