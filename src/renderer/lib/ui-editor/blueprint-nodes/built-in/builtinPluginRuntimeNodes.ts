/**
 * Runtime-only node definitions for built-in plugins.
 * Editor palette entries stay owned by the plugin loaded in Workspace.
 */

import { behaviorNodeRegistry, type BehaviorNodeDefinition } from "../../behavior-graph/BehaviorNodeRegistry";

const GALLERY_PLUGIN_ID = "narraleaf.gallery";
const GALLERY_RUNTIME_UNLOCKED_KEY = `${GALLERY_PLUGIN_ID}.unlocked`;

const galleryRuntimeNodes: BehaviorNodeDefinition[] = [
    {
        type: `${GALLERY_PLUGIN_ID}.add`,
        displayName: "Add Gallery Item",
        execute: async ctx => {
            await updateUnlockedGallery(ctx, "add");
            return { nextPort: "next" };
        },
    },
    {
        type: `${GALLERY_PLUGIN_ID}.remove`,
        displayName: "Remove Gallery Item",
        execute: async ctx => {
            await updateUnlockedGallery(ctx, "remove");
            return { nextPort: "next" };
        },
    },
    {
        type: `${GALLERY_PLUGIN_ID}.clear`,
        displayName: "Clear Gallery",
        execute: async ctx => {
            await getHostApi(ctx).persistence.set(GALLERY_RUNTIME_UNLOCKED_KEY, []);
            return { nextPort: "next" };
        },
    },
];

export function registerBuiltinPluginRuntimeNodes(): void {
    for (const node of galleryRuntimeNodes) {
        if (!behaviorNodeRegistry.get(node.type)) {
            behaviorNodeRegistry.register(node);
        }
    }
}

async function updateUnlockedGallery(
    ctx: Parameters<BehaviorNodeDefinition["execute"]>[0],
    mode: "add" | "remove",
): Promise<void> {
    const galleryItemId = String(ctx.params.galleryItemId ?? "").trim();
    if (!galleryItemId) {
        throw new Error("Pick a gallery item");
    }
    const persistence = getHostApi(ctx).persistence;
    const current = await persistence.get(GALLERY_RUNTIME_UNLOCKED_KEY);
    const unlocked = new Set(Array.isArray(current) ? current.filter((id): id is string => typeof id === "string") : []);
    if (mode === "add") {
        unlocked.add(galleryItemId);
    } else {
        unlocked.delete(galleryItemId);
    }
    await persistence.set(GALLERY_RUNTIME_UNLOCKED_KEY, Array.from(unlocked));
}

function getHostApi(ctx: Parameters<BehaviorNodeDefinition["execute"]>[0]) {
    const hostApi = ctx.hostAdapter.blueprintRuntime?.hostApi;
    if (!hostApi) {
        throw new Error("Gallery nodes require Dev Mode host APIs");
    }
    return hostApi;
}
