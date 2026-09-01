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
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";

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
    const stored = raw.blueprintDocument as BlueprintDocument | undefined;
    if (!stored || typeof stored !== "object") {
        throw new ProjectIoError(`${filePath} has no "blueprintDocument".`);
    }
    // Migrated on read, the same way the editor migrates it on read - so the tools and the editor
    // are looking at one shape, and an older project is something this can work on rather than
    // something it refuses. A document below the floor still throws, from the migration itself,
    // which is the one case nothing here can convert.
    let document: BlueprintDocument;
    try {
        document = migrateBlueprintDocumentToLatest(stored);
    } catch (error) {
        throw new ProjectIoError(`${filePath}: ${(error as Error).message}`);
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

/**
 * The document is at the version this build writes, or nothing may be written into it.
 *
 * A backstop rather than a gate the author can trip: `readUiGraphs` migrates on the way in, so the
 * only way to reach this is a conversion that did not raise the version, which is a bug here rather
 * than something the author can act on.
 *
 * It used to be the gate, and it told the author to open the project in Studio once so it migrates.
 * That does not work: Studio migrates on read and writes the file only when something next saves
 * it, so opening the project and running the command again produced the same refusal. Doing the
 * conversion here is both shorter and the same code the editor runs.
 */
export function assertWritableSchema(file: UiGraphsFile): void {
    if (file.blueprintDocument.schemaVersion === BLUEPRINT_DOCUMENT_SCHEMA_VERSION) {
        return;
    }
    throw new ProjectIoError(
        `${file.filePath} is at blueprint schema v${file.blueprintDocument.schemaVersion} after `
            + `migration, and this build writes v${BLUEPRINT_DOCUMENT_SCHEMA_VERSION}.`,
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
};

/**
 * The surfaces, the component definitions, and every element either of them owns.
 *
 * Component elements are read from the component's **own** element table rather than from the
 * document's, because that is where they live: a definition is a tree apart, instantiated wherever
 * somebody places it. Leaving them out is not a smaller answer but a wrong one - a
 * `componentWidgetMain` blueprint would have no element type to check its event heads against, and
 * every head on it would be refused as out of scope for a widget nobody could identify.
 */
export function readUiDocumentTargets(projectDir: string): UiDocumentTargets {
    const filePath = path.join(projectDir, UI_DOCUMENT_RELATIVE_PATH);
    if (!fs.existsSync(filePath)) {
        return { surfaces: [], components: [], elements: [], raw: {} };
    }
    let raw: {
        surfaces?: SurfaceTarget[];
        components?: UiDocumentComponent[];
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
        walkElements(surface.rootElementId, { surfaceId: surface.id, componentId: null }, [], elements, out);
    }
    const components: ComponentTarget[] = [];
    // One flat pool, so a resolver can answer about any element by id alone. Ids are unique across
    // the document - the editor mints them the same way for both tables - so the merge cannot hide
    // a surface element behind a component one.
    const pool: Record<string, UiDocumentElement> = { ...elements };
    for (const component of raw.components ?? []) {
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
    return { surfaces, components, elements: out, raw: pool };
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

// ---------------------------------------------------------------------------
// Scratch space
// ---------------------------------------------------------------------------

/**
 * Where a `.bp` file goes when nobody said where.
 *
 * Editing a blueprint means dumping it, changing two lines and applying it back, and the file in the
 * middle is worth nothing once the change has landed. Left to invent a path for it, each run picks a
 * different one and the checkout collects `quit.bp`, `quit2.bp`, `tmp.bp` at its root. One directory,
 * ignored by git, is the whole answer: `show --out quit.bp` writes there and `apply quit.bp` reads
 * from there, so the loop is three commands that all name the same short filename.
 */
export const SCRATCH_DIR_NAME = ".ignored";

/**
 * The checkout this tool was run from.
 *
 * The wrapper knows it and says so, because the working directory does not have to be inside the
 * repository - an agent may run the CLI from a project directory. The walk up is for tests, which
 * import these functions without going through the wrapper.
 */
function repoRoot(): string {
    const told = process.env.NLS_BLUEPRINT_REPO_ROOT;
    if (told && fs.existsSync(told)) {
        return path.resolve(told);
    }
    let dir = process.cwd();
    for (;;) {
        if (fs.existsSync(path.join(dir, "package.json"))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return process.cwd();
        }
        dir = parent;
    }
}

/** The scratch directory itself, whether or not it exists yet. */
export function scratchDir(): string {
    return path.join(repoRoot(), SCRATCH_DIR_NAME);
}

/**
 * A file path as given on the command line.
 *
 * A bare filename - no slash, no drive - means the scratch directory. Anything that names a
 * directory, `./x.bp` included, is taken literally, so a path that looks like a path always is one.
 * Reading falls back to the working directory when the scratch copy is not there, because a file
 * someone already had is not worth an error.
 */
export function resolveBlueprintFile(input: string, options: { forWriting: boolean }): string {
    if (path.isAbsolute(input) || /[\/]/.test(input)) {
        return path.resolve(input);
    }
    const inScratch = path.join(scratchDir(), input);
    if (options.forWriting) {
        fs.mkdirSync(scratchDir(), { recursive: true });
        return inScratch;
    }
    if (fs.existsSync(inScratch)) {
        return inScratch;
    }
    const inCwd = path.resolve(input);
    return fs.existsSync(inCwd) ? inCwd : inScratch;
}

/** A blueprint name as a filename: `Quit confirm` -> `quit-confirm.bp`. */
export function scratchFileNameFor(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `${slug || "blueprint"}.bp`;
}
