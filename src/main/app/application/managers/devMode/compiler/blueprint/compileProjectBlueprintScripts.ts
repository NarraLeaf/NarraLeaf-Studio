import path from "path";
import esbuild from "esbuild";
import { Fs } from "@shared/utils/fs";
import { migrateBlueprintDocumentToLatest } from "@shared/blueprint/migrateBlueprintDocument";
import { parseSharedBlueprintAssetJson } from "@shared/blueprint/parseSharedBlueprintAsset";
import type { Blueprint } from "@shared/types/blueprint/document";
import type { UIGraphDocument } from "@shared/types/ui-editor/graph";
import type { SharedBlueprintAsset } from "@shared/types/blueprint/document";

export type BlueprintScriptsCompileResult = {
    ok: boolean;
    errors: string[];
    /** blueprintId -> IIFE JS that registers into globalThis.__NL_BP_MODULES__ */
    scripts: Record<string, string>;
};

const NARRALEAF_STUDIO_SHIM = `
const sink = { events: {}, bound: {} };
export const bound = {
  bindSymbol(name, fn) {
    sink.bound[name] = fn;
  },
};
export const events = {
  on(name, fn) {
    sink.events[name] = fn;
  },
};
export function __getSink() {
  return sink;
}
`;

function narraleafStudioPlugin(): esbuild.Plugin {
    return {
        name: "narraleaf-studio-shim",
        setup(build) {
            build.onResolve({ filter: /^narraleaf-studio$/ }, args => ({
                path: args.path,
                namespace: "nl-shim",
            }));
            build.onLoad({ filter: /.*/, namespace: "nl-shim" }, () => ({
                contents: NARRALEAF_STUDIO_SHIM,
                loader: "js",
            }));
        },
    };
}

function userEntryPlugin(userSource: string): esbuild.Plugin {
    return {
        name: "nl-user-blueprint",
        setup(build) {
            build.onResolve({ filter: /^nl-user-entry$/ }, () => ({
                path: "nl-user-entry",
                namespace: "nl-user",
            }));
            build.onLoad({ filter: /.*/, namespace: "nl-user" }, () => ({
                contents: userSource,
                loader: "ts",
            }));
        },
    };
}

async function compileBlueprintScript(
    blueprintId: string,
    source: string,
): Promise<{ ok: true; js: string } | { ok: false; error: string }> {
    const entry = `
import { __getSink } from "narraleaf-studio";
import "nl-user-entry";
const _s = __getSink();
globalThis.__NL_BP_MODULES__ = globalThis.__NL_BP_MODULES__ || {};
globalThis.__NL_BP_MODULES__[${JSON.stringify(blueprintId)}] = _s;
`;
    try {
        const r = await esbuild.build({
            stdin: {
                contents: entry,
                resolveDir: process.cwd(),
                loader: "ts",
                sourcefile: `blueprint-${blueprintId}.ts`,
            },
            bundle: true,
            write: false,
            format: "iife",
            platform: "neutral",
            plugins: [narraleafStudioPlugin(), userEntryPlugin(source)],
        });
        const text = r.outputFiles?.[0]?.text;
        if (!text) {
            return { ok: false, error: "esbuild produced no output" };
        }
        return { ok: true, js: text };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
    }
}

function collectScriptBlueprintsFromLocal(doc: { blueprints: Record<string, Blueprint> }): Blueprint[] {
    const out: Blueprint[] = [];
    for (const bp of Object.values(doc.blueprints)) {
        if (bp.program.kind === "scriptModule") {
            out.push(bp);
        }
    }
    return out;
}

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

function resolveAssetContentPath(projectPath: string, assetId: string): string {
    const [a, b, rest] = splitIdForAssetContent(assetId);
    return path.join(projectPath, "assets", "content", a, b, rest);
}

async function loadSharedBlueprintAssets(projectPath: string): Promise<SharedBlueprintAsset[]> {
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
            // skip invalid
        }
    }
    return out;
}

/**
 * Compile every TypeScript blueprint (local instance + shared assets) for Dev Mode.
 * Strict: any failure marks the whole result as not ok.
 */
export async function compileAllBlueprintScriptsForProject(projectPath: string): Promise<BlueprintScriptsCompileResult> {
    const errors: string[] = [];
    const scripts: Record<string, string> = {};

    const uigraphsPath = path.join(projectPath, "editor", "ui", "uigraphs.json");
    const uigraphsResult = await Fs.read(uigraphsPath, "utf-8");
    if (uigraphsResult.ok) {
        try {
            const raw = JSON.parse(uigraphsResult.data) as UIGraphDocument;
            const bpDoc = migrateBlueprintDocumentToLatest(raw.blueprintDocument);
            for (const bp of collectScriptBlueprintsFromLocal(bpDoc)) {
                const code = bp.program.kind === "scriptModule" ? bp.program.source.code : "";
                const res = await compileBlueprintScript(bp.id, code || "");
                if (!res.ok) {
                    errors.push(`[local ${bp.id}] ${res.error}`);
                } else {
                    scripts[bp.id] = res.js;
                }
            }
        } catch (e) {
            errors.push(`[local uigraphs] ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    const shared = await loadSharedBlueprintAssets(projectPath);
    for (const asset of shared) {
        const bp = asset.blueprint;
        if (bp.program.kind !== "scriptModule") {
            continue;
        }
        const res = await compileBlueprintScript(bp.id, bp.program.source.code || "");
        if (!res.ok) {
            errors.push(`[shared ${bp.id}] ${res.error}`);
        } else {
            scripts[bp.id] = res.js;
        }
    }

    return {
        ok: errors.length === 0,
        errors,
        scripts,
    };
}
