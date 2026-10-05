/**
 * Reading and writing `editor/ui/uidoc.json`, and reading the blueprint document beside it.
 *
 * The interface document is written back exactly the way `UIDocumentService` writes it - two-space
 * JSON with a refreshed `meta.updatedAt` - so a file this tool wrote and a file Studio wrote are the
 * same shape.
 *
 * The key order of the flat `elements` map is kept as the file already had it, with elements this
 * apply adds appended after them (see `mergePreservingOrder` in `apply.ts`). Nothing reads that
 * order - every element is addressed by id, and the semantic diff walks the tree - but a text diff
 * does, and rewriting the map in tree order turned a five-element change into twenty thousand lines
 * of churn that hid it and collided with every other branch touching the same document.
 *
 * The schema version is checked before anything is written. The migration lives on the renderer's
 * `UIDocumentService` and needs a service to run; writing an unmigrated document back under the
 * current version number would be the migration silently not having run. This is the same refusal
 * `blueprint apply` makes, and for the same reason. A v12 document is still *read* as v13, through
 * the shared text-source step, so `show` and `check` answer for the project as Studio will open it;
 * it is only the write that waits for Studio, because that step also edits the translation files.
 *
 * `uigraphs.json` is only read here: attaching a graph to a widget is `blueprint apply`'s job. It is
 * read so that a value binding can be checked against the blueprint it names, and so that replacing a
 * surface can say which blueprints it is about to orphan. The one command that writes it, `remove`,
 * goes through the blueprint tool's own reader and writer (see `remove.ts`), so there is still one
 * place that knows how that file is written.
 *
 * Comments in English per project convention.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BlueprintDocument, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { normalizeLocalizationConfiguration, normalizeLocalizationKeysDocument } from "@shared/types/localization";
import { decodeProjectConfig, findProjectConfigFileName } from "@shared/utils/nlproj";
import { resolveBlueprintFile } from "../blueprint-cli/project";
import {
    UI_DOCUMENT_MIN_SUPPORTED_VERSION,
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIComponentDefinition,
    type UIDocument,
    type UIElement,
    type UIElementId,
    type UISurface,
} from "@shared/types/ui-editor/document";
import { migrateUITextSourcesV13, UI_TEXT_SOURCES_SCHEMA_VERSION } from "@shared/types/ui-editor/textSourceMigration";

export const UI_DOCUMENT_RELATIVE_PATH = path.join("editor", "ui", "uidoc.json");
export const UI_GRAPHS_RELATIVE_PATH = path.join("editor", "ui", "uigraphs.json");

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
    /**
     * The version on disk, when the document was brought to the current one in memory to be read.
     * Such a document is never written back: see {@link assertWritableSchema}.
     */
    migratedFrom?: number;
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
    // A document from before v13 is read the way Studio will read it once it is opened: through the
    // same step, against the project's keys (`textSourceMigration.ts`). Only the document is needed to
    // read it - the translation edits that step makes are Studio's to write when it opens the project.
    if (
        typeof raw.schemaVersion === "number"
        && raw.schemaVersion >= UI_DOCUMENT_MIN_SUPPORTED_VERSION
        && raw.schemaVersion < UI_TEXT_SOURCES_SCHEMA_VERSION
    ) {
        const textKeys = readTextKeys(projectDir);
        const migrated = migrateUITextSourcesV13(raw, {
            keys: Object.fromEntries(textKeys?.keys ?? []),
            sourceLocale: textKeys?.sourceLocale ?? "",
            translations: {},
        });
        return { filePath, document: migrated.document, migratedFrom: raw.schemaVersion };
    }
    return { filePath, document: raw };
}

export function assertWritableSchema(file: UiDocumentFile): void {
    if (file.migratedFrom === undefined && file.document.schemaVersion === UI_DOCUMENT_SCHEMA_VERSION) {
        return;
    }
    if (file.migratedFrom !== undefined) {
        throw new ProjectIoError(
            `${file.filePath} carries interface schema v${file.migratedFrom}, and this Studio writes `
                + `v${UI_DOCUMENT_SCHEMA_VERSION}. Open the project in Studio once so it migrates - its translation `
                + "files change with it - then run this again.",
        );
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
// The translation keys, read only
// ---------------------------------------------------------------------------

/** The project's named translation keys, and its source language. */
export type TextKeys = {
    /** The project's source language, or "" when it has none. Keys are read either way. */
    sourceLocale: string;
    /** Key name to source-language text, from `editor/localization/keys.json`. */
    keys: ReadonlyMap<string, string>;
};

/**
 * Read the key registry and the project's source language. Null when the project config cannot be
 * read, which is not the same as a project with no keys.
 */
export function readTextKeys(projectDir: string): TextKeys | null {
    let config: Record<string, unknown>;
    try {
        const entries = fs.readdirSync(projectDir, { withFileTypes: true }).map(entry => ({
            name: path.parse(entry.name).name,
            ext: path.extname(entry.name) || null,
            type: entry.isFile() ? ("file" as const) : entry.isDirectory() ? ("directory" as const) : ("other" as const),
        }));
        const configFileName = findProjectConfigFileName(entries);
        if (!configFileName) {
            return null;
        }
        config = decodeProjectConfig(fs.readFileSync(path.join(projectDir, configFileName))) as unknown as Record<string, unknown>;
    } catch {
        return null;
    }
    const app = config.app && typeof config.app === "object" ? (config.app as Record<string, unknown>) : undefined;
    const localization = normalizeLocalizationConfiguration(app?.localization);
    const keys = new Map<string, string>();
    const keysPath = path.join(projectDir, "editor", "localization", "keys.json");
    if (fs.existsSync(keysPath)) {
        try {
            const document = normalizeLocalizationKeysDocument(JSON.parse(fs.readFileSync(keysPath, "utf8")));
            for (const [name, definition] of Object.entries(document.keys)) {
                keys.set(name, definition.sourceText);
            }
        } catch {
            return null;
        }
    }
    return { sourceLocale: localization.sourceLocale, keys };
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
