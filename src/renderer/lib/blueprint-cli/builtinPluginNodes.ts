/**
 * The node types the plugins bundled with Studio contribute, registered beside the core catalogue.
 *
 * Without this the CLI knows only the nodes the host defines, and a blueprint using one of a
 * bundled plugin's nodes cannot be written at all: `compile.unknown_node_type` is an error, and
 * `apply` writes nothing when anything is at error severity. The screens that need those nodes
 * would then have to be built by hand-editing `uigraphs.json`, which is the one thing this tool
 * exists to make unnecessary.
 *
 * The definitions come from each plugin's own `nodes` module - the same array its studio entry
 * registers when the plugin loads - so there is no second catalogue here either. What is dropped is
 * the half the CLI has no use for: a node's `execute` needs a live `game` object, and nothing here
 * ever runs a graph. The stub below therefore throws rather than pretending to run, which is the
 * honest answer if a future command ever tries.
 *
 * These nodes are deliberately NOT marked built-in. A plugin's node is absent from a project whose
 * author has not installed and enabled the plugin, and the registry's built-in set drives checks
 * that only hold for nodes the host itself defines.
 *
 * Comments in English per project convention.
 */

import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes";
import type { BlueprintNodeDef } from "@/lib/ui-editor/blueprint-nodes/types";
import { createGalleryBlueprintNodes } from "../../../builtin-plugins/gallery/nodes";
import { createQuickSaveBlueprintNodes } from "../../../builtin-plugins/quick-save/nodes";

/** Plugin id to the node definitions it contributes, in the order the palette would show them. */
export function listBuiltInPluginBlueprintNodes(): { pluginId: string; defs: BlueprintNodeDef[] }[] {
    return [
        {
            pluginId: "narraleaf.gallery",
            // The catalog reader answers for the authored gallery, which only a running Studio
            // holds. Nothing here executes, so an empty catalog is the whole of what it needs.
            defs: asHostDefs(createGalleryBlueprintNodes(() => null)),
        },
        {
            pluginId: "narraleaf.quick-save",
            defs: asHostDefs(createQuickSaveBlueprintNodes()),
        },
    ];
}

/** The plugin that owns a node type, or undefined for a host node or an unknown one. */
export function builtInPluginOwnerOf(type: string): string | undefined {
    return ownersByType().get(type);
}

let owners: Map<string, string> | null = null;

function ownersByType(): Map<string, string> {
    if (!owners) {
        owners = new Map();
        for (const { pluginId, defs } of listBuiltInPluginBlueprintNodes()) {
            for (const def of defs) {
                owners.set(def.type, pluginId);
            }
        }
    }
    return owners;
}

/**
 * Register them all. Idempotent, because every command calls it and the registry refuses a
 * duplicate type.
 */
export function registerBuiltInPluginBlueprintNodes(): void {
    for (const { defs } of listBuiltInPluginBlueprintNodes()) {
        for (const def of defs) {
            if (!blueprintNodeRegistry.get(def.type)) {
                blueprintNodeRegistry.register(def);
            }
        }
    }
}

/**
 * A plugin definition as the host's registry wants it.
 *
 * The two types agree on everything the CLI reads - type, pins, fields, graph kinds - and differ
 * only in the context `execute` receives, which is why the cast is confined to this one function
 * with the stub written out beside it.
 */
function asHostDefs(defs: readonly { type: string }[]): BlueprintNodeDef[] {
    return defs.map(def => ({
        ...(def as unknown as BlueprintNodeDef),
        execute: () => {
            throw new Error(`[blueprint] ${def.type} belongs to a plugin and cannot run here`);
        },
    }));
}
