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
import type { StoryDocument } from "@shared/types/story";
import { listStories, readStoryDocument, readUiDocument } from "@/lib/story-cli/project";
import {
    applyBlueprintsToDocument,
    assetNameContextOf,
    ProjectIoError,
    projectVariablesOf,
    publishPageParams,
    publishSaveSchema,
    readableBlueprintDocument,
    uiDocumentTargetsOf,
    type ApplyResult,
    type AssetNameContext,
    type ProjectVariables,
    type UiDocumentTargets,
} from "./model";

// Everything that is a function of the documents rather than of the directory lives in `model.ts`,
// where the renderer can reach it; re-exported so the command line and its tests keep one import.
export {
    elementTypeResolver,
    ProjectIoError,
    widgetElementResolver,
    widgetElementTypeResolver,
    type ApplyResult,
    type ComponentTarget,
    type ElementTarget,
    type ProjectVariables,
    type SurfaceTarget,
    type UiDocumentTargets,
} from "./model";

export const UI_GRAPHS_RELATIVE_PATH = path.join("editor", "ui", "uigraphs.json");
export const UI_DOCUMENT_RELATIVE_PATH = path.join("editor", "ui", "uidoc.json");
export const SAVE_SCHEMA_RELATIVE_PATH = path.join("editor", "save-schema.json");

export type UiGraphsFile = {
    filePath: string;
    /** The whole document, including the parts this tool does not understand. */
    raw: Record<string, unknown>;
    blueprintDocument: BlueprintDocument;
};

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
    let blueprintDocument: BlueprintDocument;
    try {
        blueprintDocument = readableBlueprintDocument(stored);
    } catch (error) {
        throw new ProjectIoError(`${filePath}: ${(error as Error).message}`);
    }
    return { filePath, raw, blueprintDocument };
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

/** Put compiled blueprints into the document, replacing whatever occupied the same owner. */
export function applyBlueprints(
    file: UiGraphsFile,
    blueprints: readonly Blueprint[],
    ownerRecords: Record<string, BlueprintPrivateOwnerRecord>,
): ApplyResult {
    return applyBlueprintsToDocument(file.blueprintDocument, blueprints, ownerRecords);
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

/** The surfaces, the component definitions, and every element either of them owns (see `uiDocumentTargetsOf`). */
export function readUiDocumentTargets(projectDir: string): UiDocumentTargets {
    const filePath = path.join(projectDir, UI_DOCUMENT_RELATIVE_PATH);
    if (!fs.existsSync(filePath)) {
        return uiDocumentTargetsOf(null);
    }
    let raw: Parameters<typeof uiDocumentTargetsOf>[0];
    try {
        raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        throw new ProjectIoError(`Cannot read ${filePath}: ${(error as Error).message}`);
    }
    return uiDocumentTargetsOf(raw);
}

// ---------------------------------------------------------------------------
// Page parameters
// ---------------------------------------------------------------------------

/** Publish the parameters the project's pages declare (see `publishPageParams`). */
export function loadPageParams(projectDir: string): void {
    const filePath = path.join(projectDir, UI_DOCUMENT_RELATIVE_PATH);
    let raw: { surfaces?: unknown } | null = null;
    try {
        raw = fs.existsSync(filePath) ? (JSON.parse(fs.readFileSync(filePath, "utf8")) as { surfaces?: unknown }) : {};
    } catch {
        raw = null;
    }
    publishPageParams(raw as Parameters<typeof publishPageParams>[0]);
}

// ---------------------------------------------------------------------------
// Save schema
// ---------------------------------------------------------------------------

/** Publish the project's save fields (see `publishSaveSchema`). Returns how many it declares. */
export function loadSaveSchema(projectDir: string): number {
    const filePath = path.join(projectDir, SAVE_SCHEMA_RELATIVE_PATH);
    if (!fs.existsSync(filePath)) {
        return publishSaveSchema(null);
    }
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        // Unreadable is published as no fields, the same answer an unmigratable one gets.
        return publishSaveSchema(null);
    }
    return publishSaveSchema(raw);
}

// ---------------------------------------------------------------------------
// Project-level variables
// ---------------------------------------------------------------------------

export const VARIABLE_REGISTRY_RELATIVE_PATH = path.join("editor", "variables.json");

/** The project-level variable registry (see `projectVariablesOf`). Unreadable reads as empty. */
export function readVariableRegistry(projectDir: string): ProjectVariables {
    const filePath = path.join(projectDir, VARIABLE_REGISTRY_RELATIVE_PATH);
    if (!fs.existsSync(filePath)) {
        return projectVariablesOf(null);
    }
    try {
        return projectVariablesOf(JSON.parse(fs.readFileSync(filePath, "utf8")));
    } catch {
        return projectVariablesOf(null);
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

/**
 * What the asset-name judgement needs from the project besides its graphs (see `assetNameContextOf`),
 * read the way the story tool reads it. A story that will not read is left out.
 */
export function readAssetNameContext(projectDir: string): AssetNameContext {
    const stories: { name: string; document: StoryDocument }[] = [];
    for (const story of listStories(projectDir)) {
        try {
            stories.push({ name: story.name, document: readStoryDocument(projectDir, story.id).document });
        } catch {
            // Reported by the story tool, not here.
        }
    }
    return assetNameContextOf(readUiDocument(projectDir), stories);
}
