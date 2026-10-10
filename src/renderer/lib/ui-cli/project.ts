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

import * as fs from "node:fs";
import * as path from "node:path";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { decodeProjectConfig, findProjectConfigFileName } from "@shared/utils/nlproj";
import { resolveBlueprintFile } from "../blueprint-cli/project";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { indexBlueprintDocument, needsTextSourceStep, readableUiDocument, textKeysOf, type BlueprintIndex, type TextKeys } from "./model";

// The walkers and the id derivation are pure and live in `model.ts`, where the renderer can reach
// them; they are re-exported so the command line and its tests keep one place to import from.
export {
    collectTree,
    deriveElementId,
    elementPath,
    elementPathSegments,
    findComponent,
    findSurface,
    indexBlueprintDocument,
    type BlueprintIndex,
    type TextKeys,
} from "./model";

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
    // same step, against the project's keys (`readableUiDocument` in `model.ts`). Only the document is
    // needed to read it - the translation edits that step makes are Studio's to write when it opens
    // the project. The keys are read only when the step will run.
    const readable = readableUiDocument(raw, needsTextSourceStep(raw) ? readTextKeys(projectDir) : null);
    return readable.migratedFrom === undefined
        ? { filePath, document: readable.document }
        : { filePath, document: readable.document, migratedFrom: readable.migratedFrom };
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
    const keysPath = path.join(projectDir, "editor", "localization", "keys.json");
    let keysDocument: unknown = null;
    if (fs.existsSync(keysPath)) {
        try {
            keysDocument = JSON.parse(fs.readFileSync(keysPath, "utf8"));
        } catch {
            return null;
        }
    }
    return textKeysOf({ localization: app?.localization, keysDocument });
}

// ---------------------------------------------------------------------------
// The blueprint document, read only
// ---------------------------------------------------------------------------

export function readBlueprintIndex(projectDir: string): BlueprintIndex {
    const filePath = path.join(projectDir, UI_GRAPHS_RELATIVE_PATH);
    if (!fs.existsSync(filePath)) {
        return indexBlueprintDocument(null);
    }
    let document: BlueprintDocument | undefined;
    try {
        document = (JSON.parse(fs.readFileSync(filePath, "utf8")) as { blueprintDocument?: BlueprintDocument })
            .blueprintDocument;
    } catch (error) {
        throw new ProjectIoError(`Cannot read ${filePath}: ${(error as Error).message}`);
    }
    return indexBlueprintDocument(document);
}

// ---------------------------------------------------------------------------
// The shipped skeleton, which `usage` reads when given no project
// ---------------------------------------------------------------------------

export const SKELETON_UI_DOCUMENT_RELATIVE_PATH = path.join(
    "resources",
    "templates",
    "skeleton",
    "content",
    "editor",
    "ui",
    "uidoc.json",
);

/**
 * The checkout this tool was run from.
 *
 * The wrapper knows it and says so, because the working directory does not have to be inside the
 * repository - the CLI is often run from a project directory. The walk up is for tests, which import
 * these functions without going through the wrapper.
 */
export function repoRoot(): string {
    const told = process.env.NLS_UI_CLI_ROOT;
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

/** The template that ships with Studio, which is what "how is this normally done" means here. */
export function readSkeletonDocument(repoRoot: string): UIDocument | null {
    const filePath = path.join(repoRoot, SKELETON_UI_DOCUMENT_RELATIVE_PATH);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8")) as UIDocument;
    } catch {
        return null;
    }
}
