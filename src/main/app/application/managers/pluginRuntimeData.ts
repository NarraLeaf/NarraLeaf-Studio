/**
 * Reads the plugin storage a plugin declared as publishable, so game execution
 * environments can see authored plugin data.
 *
 * Plugin stores live in the project's `editor/` directory, which is deliberately
 * never packaged (see ProjectNameConvention). A plugin whose runtime needs
 * authored data - a gallery catalog, a lookup table - would otherwise have no
 * way to reach it: the runtime entry is a prebundled static file and the runtime
 * host API exposes no project file access.
 *
 * `contributes.runtimeData` is that bridge, and it is an allowlist rather than a
 * blanket copy so editor-only plugin state never leaks into a shipped game.
 *
 * Both consumers are main-process: the Dev Mode descriptor handler reads the
 * live project, and the pack compiler inlines the same data into the bundle.
 */

import fs from "fs/promises";
import path from "path";
import type { NormalizedPluginManifestV2 } from "@shared/types/plugins";
import { pluginStoreNamespace } from "@shared/utils/pluginStorage";

/** Mirrors ProjectNameConvention.EditorServices, which lives in renderer-land. */
const EDITOR_SERVICES_SEGMENTS = ["editor", "services"] as const;

/**
 * Collect a plugin's publishable stores from a project directory.
 *
 * Missing or unreadable stores are omitted rather than fatal: a project may
 * legitimately never have written one (the user never opened the plugin's
 * panel), and a malformed store must not block a build or a Dev Mode session.
 * Returns undefined when nothing was collected, so callers can leave the
 * descriptor field absent instead of shipping an empty object.
 */
export async function readPublishedPluginData(input: {
    projectPath: string;
    manifest: NormalizedPluginManifestV2;
    /** Reports a store that exists but could not be parsed. */
    onWarning?: (message: string) => void;
}): Promise<Record<string, unknown> | undefined> {
    const namespaces = input.manifest.contributes.runtimeData;
    if (namespaces.length === 0) {
        return undefined;
    }

    const collected: Record<string, unknown> = {};
    for (const namespace of namespaces) {
        const fileName = `${pluginStoreNamespace(input.manifest.id, namespace)}.json`;
        const storePath = path.join(input.projectPath, ...EDITOR_SERVICES_SEGMENTS, fileName);
        let raw: string;
        try {
            raw = await fs.readFile(storePath, "utf-8");
        } catch {
            continue; // never written - the plugin must tolerate absent data
        }
        try {
            collected[namespace] = JSON.parse(raw) as unknown;
        } catch (error) {
            input.onWarning?.(
                `[plugin:${input.manifest.id}] skipped unreadable runtime data "${namespace}" ` +
                `(${storePath}): ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    return Object.keys(collected).length > 0 ? collected : undefined;
}
