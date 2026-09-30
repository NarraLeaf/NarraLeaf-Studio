/**
 * What is in `<project>/scripts/`, and which blueprint runs each file.
 *
 * The list a script has never had anywhere. Studio could say which file one layer pointed at, and
 * nothing could say the other direction - what the project holds, and which of it is bound to
 * something. Both halves are needed for a management surface: a file bound to nothing is as much a
 * fact as a layer whose file is gone.
 *
 * Two facts, joined here rather than in a panel, because both readings have to agree:
 *
 *  - The **disk** is authoritative for what exists (see `@shared/project/scriptsDirectory`), so the
 *    listing is a walk rather than anything Studio remembers.
 *  - The **blueprint document** is authoritative for what is bound, and it may name a file that is
 *    not there - an author renames one in their own editor, which Studio neither prevents nor
 *    notices. Such a reference is kept as a row rather than dropped, because it is the state the
 *    author has to be able to see in order to repair it.
 */

import { SCRIPTS_GENERATED_DIR, SCRIPTS_MODULES_DIR, isScriptSourcePath } from "@shared/project/scriptsDirectory";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import type { FileEntry } from "@shared/utils/fs";
import { listScriptLayers } from "@shared/blueprint/blueprintLayers";

/** One row of the scripts listing: a file, or a reference to one that is not there. */
export type ProjectScriptEntry = {
    /** Project-relative path, always under `scripts/`. The row's identity. */
    scriptRef: string;
    /** Just the file name, for a list that is read rather than parsed. */
    fileName: string;
    /** Whether the file is on disk. False for a layer pointing at a file that was moved away. */
    exists: boolean;
    /** Every layer bound to this file. Two may share one script; most files have exactly one. */
    boundTo: readonly ProjectScriptBinding[];
};

export type ProjectScriptBinding = {
    blueprintId: string;
    /** The layer inside that blueprint, which is what actually runs the file. */
    layerId: string;
    /** The blueprint's own name, which is what the editor tab and the layer list show. */
    name: string;
    owner: Blueprint["owner"];
};

/** How the walk reads a directory. Injected so the model can be tested without a file system. */
export type ScriptDirectoryReader = (relativePath: string) => Promise<FileEntry[] | null>;

/**
 * Every script source under `scripts/`, in a stable order.
 *
 * The two reserved names are not descended into. `node_modules` is the author's own install and can
 * hold tens of thousands of files; `.narraleaf` is Studio's generated declarations, which are not
 * scripts anyone can bind an event to. Both are stated by `scriptsDirectory.ts` and read from there
 * rather than spelled again.
 */
export async function walkProjectScripts(read: ScriptDirectoryReader): Promise<string[]> {
    const found: string[] = [];
    const visit = async (relative: string, depth: number): Promise<void> => {
        // A guard rather than a limit anyone should reach: a symlink loop inside the author's own
        // folder would otherwise walk forever, and no real script tree is this deep.
        if (depth > 12) {
            return;
        }
        const entries = await read(relative);
        for (const entry of entries ?? []) {
            const child = `${relative}/${entry.fileName}`;
            if (entry.type === "directory") {
                if (entry.fileName === SCRIPTS_MODULES_DIR || entry.fileName === SCRIPTS_GENERATED_DIR) {
                    continue;
                }
                await visit(child, depth + 1);
                continue;
            }
            if (isScriptSourcePath(child)) {
                found.push(child);
            }
        }
    };
    await visit("scripts", 0);
    return found.sort();
}

/** Every layer that runs a script, by the file it runs. */
export function scriptBindingsByRef(document: BlueprintDocument | undefined): Map<string, ProjectScriptBinding[]> {
    const byRef = new Map<string, ProjectScriptBinding[]>();
    for (const blueprint of Object.values(document?.blueprints ?? {})) {
        if (!blueprint) {
            continue;
        }
        for (const { layerId, script } of listScriptLayers(blueprint.graphs)) {
            const bindings = byRef.get(script.scriptRef) ?? [];
            bindings.push({
                blueprintId: blueprint.id,
                layerId,
                name: blueprint.name,
                owner: blueprint.owner,
            });
            byRef.set(script.scriptRef, bindings);
        }
    }
    return byRef;
}

/**
 * The listing: every file on disk, plus every file a layer names that is not.
 *
 * Sorted by path so the order is the folder's own and does not move when a binding changes.
 */
export function buildProjectScriptListing(
    filesOnDisk: readonly string[],
    bindingsByRef: ReadonlyMap<string, ProjectScriptBinding[]>,
): ProjectScriptEntry[] {
    const refs = new Set<string>([...filesOnDisk, ...bindingsByRef.keys()]);
    return [...refs]
        .sort()
        .map(scriptRef => ({
            scriptRef,
            fileName: scriptRef.slice(scriptRef.lastIndexOf("/") + 1),
            exists: filesOnDisk.includes(scriptRef),
            boundTo: bindingsByRef.get(scriptRef) ?? [],
        }));
}
