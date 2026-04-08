import path from "path";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import { parseSharedBlueprintAssetJson } from "@shared/blueprint/parseSharedBlueprintAsset";
import type { SharedBlueprintAsset } from "@shared/types/blueprint/document";
import type { DevModeBundle } from "@shared/types/devMode";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIGraphDocument } from "@shared/types/ui-editor/graph";
import { Fs } from "@shared/utils/fs";
import type { DevModeBundleLoadContext, DevModeBundleSource } from "./types";

/**
 * Assemble a DevModeBundle by reading `editor/ui/uidoc.json` and `uigraphs.json` from disk.
 */
export async function assembleDevModeBundleFromProjectPath(context: DevModeBundleLoadContext): Promise<DevModeBundle> {
    const uidocPath = path.join(context.projectPath, "editor", "ui", "uidoc.json");
    const uigraphsPath = path.join(context.projectPath, "editor", "ui", "uigraphs.json");
    const uidoc = await readJsonFile<UIDocument>(uidocPath);
    const uigraphsRaw = await readJsonFile<UIGraphDocument>(uigraphsPath);
    const uigraphs: UIGraphDocument = {
        ...uigraphsRaw,
        blueprintDocument: migrateBlueprintDocumentToLatest(uigraphsRaw.blueprintDocument),
    };
    const localBlueprints = uigraphs.blueprintDocument;
    const sharedBlueprints = await loadSharedBlueprints(context.projectPath);
    return {
        bundleId: context.bundleId,
        revision: context.revision,
        timestamp: new Date().toISOString(),
        ui: {
            uidoc,
            uigraphs,
            localBlueprints,
            sharedBlueprints,
        },
        compiled: context.compiled,
        blueprintCompiledScripts: context.blueprintCompiledScripts,
        blueprintScriptsCompileOk: context.blueprintScriptsCompileOk ?? true,
        blueprintScriptsCompileErrors: context.blueprintScriptsCompileErrors,
    };
}

async function readJsonFile<T>(filePath: string): Promise<T> {
    const result = await Fs.read(filePath, "utf-8");
    if (!result.ok) {
        throw new Error(result.error?.message ?? `Failed to read ${filePath}`);
    }
    try {
        return JSON.parse(result.data) as T;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Invalid JSON in ${filePath}: ${msg}`);
    }
}

/**
 * Load blueprint-type assets from metadata shard + content shards (same layout as renderer Assets pipeline).
 */
async function loadSharedBlueprints(projectPath: string): Promise<SharedBlueprintAsset[]> {
    const shardPath = path.join(projectPath, "assets", "assets.metadata.blueprint.json");
    const shardResult = await Fs.read(shardPath, "utf-8");
    if (!shardResult.ok) {
        return [];
    }
    let record: Record<string, unknown>;
    try {
        record = JSON.parse(shardResult.data) as Record<string, unknown>;
    } catch {
        return [];
    }
    const out: SharedBlueprintAsset[] = [];
    for (const assetId of Object.keys(record)) {
        const filePath = resolveAssetContentPath(projectPath, assetId);
        const body = await Fs.read(filePath, "utf-8");
        if (!body.ok) {
            continue;
        }
        try {
            out.push(parseSharedBlueprintAssetJson(body.data));
        } catch {
            // Skip invalid entries so Dev Mode still runs
        }
    }
    return out;
}

function resolveAssetContentPath(projectPath: string, assetId: string): string {
    const [a, b, rest] = splitIdForAssetContent(assetId);
    return path.join(projectPath, "assets", "content", a, b, rest);
}

/** Mirrors `ProjectNameConvention.splitId` for main-process file reads */
function splitIdForAssetContent(id: string): [string, string, string] {
    const cleanId = id.replace(/-/g, "");
    if (cleanId.length < 4) {
        const padded = cleanId.padEnd(4, "0");
        return [padded.slice(0, 2), padded.slice(2, 4), id];
    }
    const charsA = cleanId.slice(0, 2);
    const charsB = cleanId.slice(2, 4);
    const rest = cleanId.slice(4);
    return [charsA, charsB, rest || id];
}

/** Default bundle source: project files on disk. */
export const devModeDiskBundleSource: DevModeBundleSource = {
    kind: "disk",
    load(context) {
        return assembleDevModeBundleFromProjectPath(context);
    },
};
