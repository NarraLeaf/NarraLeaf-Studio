/**
 * Reading and writing `editor/ui/uidoc.json`, and reading the blueprint document beside it.
 *
 * The interface document is written back exactly the way `UIDocumentService` writes it - two-space
 * JSON with a refreshed `meta.updatedAt` - so a file this tool wrote and a file Studio wrote are the
 * same shape.
 *
 * One thing does move: the keys of the flat `elements` map come out in tree order, surface by
 * surface, rather than in whatever order a project's editing history left them. Nothing reads that
 * order - every element is addressed by id, and the semantic diff does too - so this is a one-off
 * reshuffle of the JSON text on the first apply and nothing after it.
 *
 * The schema version is checked before anything is written. Eleven versions' worth of migration live
 * on the renderer's `UIDocumentService` and need a service to run; writing an unmigrated document
 * back under the current version number would be the migration silently not having run. This is the
 * same refusal `blueprint apply` makes, and for the same reason.
 *
 * `uigraphs.json` is read and never written: attaching a graph to a widget is `blueprint apply`'s
 * job. It is read so that a value binding can be checked against the blueprint it names, and so that
 * replacing a surface can say which blueprints it is about to orphan.
 *
 * Comments in English per project convention.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BlueprintDocument, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { resolveBlueprintFile } from "../blueprint-cli/project";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIComponentDefinition,
    type UIDocument,
    type UIElement,
    type UIElementId,
    type UISurface,
} from "@shared/types/ui-editor/document";

export const UI_DOCUMENT_RELATIVE_PATH = path.join("editor", "ui", "uidoc.json");
export const UI_GRAPHS_RELATIVE_PATH = path.join("editor", "ui", "uigraphs.json");

/**
 * The surface every shipped game boots into.
 *
 * It cannot be deleted and no other surface can be given this id, so a title page authored anywhere
 * else is a title page the game never shows.
 */
export const MAIN_SURFACE_ID = "narraleaf-studio:main-surface";

export class ProjectIoError extends Error {}

/**
 * A `.ui` path as given on the command line.
 *
 * A bare filename means the scratch directory - the same `.ignored/` at the root of the checkout
 * that `.bp` files go to, because the two tools are used on the same task and their working files
 * belong in the same place. The resolution is the blueprint tool's, which is about where a file
 * lives rather than about what is in it.
 */
export function resolveUiFile(input: string, options: { forWriting: boolean }): string {
    return resolveBlueprintFile(input, options);
}

/** A surface or component name as a filename: `Save slot` -> `save-slot.ui`. */
export function scratchFileNameFor(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `${slug || "interface"}.ui`;
}

export type UiDocumentFile = {
    filePath: string;
    document: UIDocument;
};

export function resolveProjectDir(input: string): string {
    const resolved = path.resolve(input);
    if (!fs.existsSync(path.join(resolved, UI_DOCUMENT_RELATIVE_PATH))) {
        throw new ProjectIoError(
            `"${resolved}" does not look like a NarraLeaf project: no ${UI_DOCUMENT_RELATIVE_PATH}.`,
        );
    }
    return resolved;
}

export function readUiDocument(projectDir: string): UiDocumentFile {
    const filePath = path.join(projectDir, UI_DOCUMENT_RELATIVE_PATH);
    let raw: UIDocument;
    try {
        raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as UIDocument;
    } catch (error) {
        throw new ProjectIoError(`Cannot read ${filePath}: ${(error as Error).message}`);
    }
    if (!Array.isArray(raw.surfaces) || typeof raw.elements !== "object" || raw.elements == null) {
        throw new ProjectIoError(`${filePath} has no "surfaces" / "elements": it is not an interface document.`);
    }
    return { filePath, document: raw };
}

export function assertWritableSchema(file: UiDocumentFile): void {
    if (file.document.schemaVersion === UI_DOCUMENT_SCHEMA_VERSION) {
        return;
    }
    throw new ProjectIoError(
        `${file.filePath} carries interface schema v${file.document.schemaVersion}, and this Studio writes `
            + `v${UI_DOCUMENT_SCHEMA_VERSION}. Open the project in Studio once so it migrates, then run this again.`,
    );
}

export function writeUiDocument(file: UiDocumentFile): void {
    const updated: UIDocument = {
        ...file.document,
        meta: { ...file.document.meta, updatedAt: new Date().toISOString() },
    };
    fs.writeFileSync(file.filePath, JSON.stringify(updated, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// The blueprint document, read only
// ---------------------------------------------------------------------------

export type BlueprintIndex = {
    /** Every blueprint by id, with the owner it claims. */
    byId: Map<string, { name: string; owner: BlueprintOwnerRef }>;
    /** Blueprint ids by the element they hang off, whether as a widget's own graph or a value. */
    byElement: Map<string, { id: string; name: string; owner: BlueprintOwnerRef }[]>;
};

export function readBlueprintIndex(projectDir: string): BlueprintIndex {
    const index: BlueprintIndex = { byId: new Map(), byElement: new Map() };
    const filePath = path.join(projectDir, UI_GRAPHS_RELATIVE_PATH);
    if (!fs.existsSync(filePath)) {
        return index;
    }
    let document: BlueprintDocument | undefined;
    try {
        document = (JSON.parse(fs.readFileSync(filePath, "utf8")) as { blueprintDocument?: BlueprintDocument })
            .blueprintDocument;
    } catch (error) {
        throw new ProjectIoError(`Cannot read ${filePath}: ${(error as Error).message}`);
    }
    for (const blueprint of Object.values(document?.blueprints ?? {})) {
        index.byId.set(blueprint.id, { name: blueprint.name, owner: blueprint.owner });
        const owner = blueprint.owner as { elementId?: string };
        if (typeof owner.elementId === "string") {
            const list = index.byElement.get(owner.elementId) ?? [];
            list.push({ id: blueprint.id, name: blueprint.name, owner: blueprint.owner });
            index.byElement.set(owner.elementId, list);
        }
    }
    return index;
}

// ---------------------------------------------------------------------------
// Walking the document
// ---------------------------------------------------------------------------

/** Every element reachable from `rootId` in `pool`, root first, cycles and missing ids survived. */
export function collectTree(pool: Record<UIElementId, UIElement>, rootId: string | undefined): UIElement[] {
    const out: UIElement[] = [];
    if (!rootId) {
        return out;
    }
    const seen = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
        const id = stack.pop() as string;
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        const element = pool[id];
        if (!element) {
            continue;
        }
        out.push(element);
        for (const childId of [...(element.childrenIds ?? [])].reverse()) {
            stack.push(childId);
        }
    }
    return out;
}

export function findSurface(document: UIDocument, nameOrId: string): UISurface | undefined {
    return document.surfaces.find(surface => surface.id === nameOrId)
        ?? document.surfaces.find(surface => surface.name === nameOrId);
}

export function findComponent(document: UIDocument, nameOrId: string): UIComponentDefinition | undefined {
    const components = document.components ?? [];
    return components.find(component => component.id === nameOrId)
        ?? components.find(component => component.name === nameOrId);
}

/** The names from the tree's root down to this element, which is what tells two "Button" apart. */
export function elementPathSegments(pool: Record<UIElementId, UIElement>, element: UIElement): string[] {
    const names: string[] = [];
    let current: UIElement | undefined = element;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        names.unshift(current.name ?? current.type);
        current = current.parentId ? pool[current.parentId] : undefined;
    }
    return names;
}

/** The same path as one readable line. */
export function elementPath(pool: Record<UIElementId, UIElement>, element: UIElement): string {
    return elementPathSegments(pool, element).join(" / ");
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

const UI_CLI_ID_NAMESPACE = "narraleaf-studio:ui-cli";

/**
 * A stable id for an element the file did not name one for.
 *
 * Derived from where the element sits rather than drawn at random, so writing the same file into two
 * fresh projects produces the same ids - which is what makes a template a template. It is a real
 * v5-shaped UUID, so nothing downstream can tell it from one the editor minted.
 */
export function deriveElementId(scope: string, elementPathKey: string): string {
    const digest = createHash("sha1").update(`${UI_CLI_ID_NAMESPACE}\u0000${scope}\u0000${elementPathKey}`).digest();
    const bytes = Buffer.from(digest.subarray(0, 16));
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
