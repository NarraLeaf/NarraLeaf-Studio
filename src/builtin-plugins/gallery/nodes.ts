/**
 * Gallery blueprint node definitions, shared by both plugin entries:
 * - main.tsx (studio entry) registers the full defs for the editor palette
 *   and in-editor preview execution.
 * - runtime.ts (runtime entry) registers the execute bindings for game
 *   execution environments (Dev Mode window, Preview, Production).
 *
 * The execute functions live here once so both targets ship the same logic.
 */

import type { BlueprintNodeDef } from "narraleaf-studio/plugin";

export const PLUGIN_ID = "narraleaf.gallery";
export const DYNAMIC_OPTIONS_SOURCE = `${PLUGIN_ID}.items`;
export const RUNTIME_UNLOCKED_KEY = `${PLUGIN_ID}.unlocked`;

export function createGalleryBlueprintNodes(): BlueprintNodeDef[] {
    return [
        {
            type: `${PLUGIN_ID}.add`,
            displayName: "Add Gallery Item",
            category: "Gallery",
            keywords: ["gallery", "unlock", "add", "cg"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            inspectorParams: [gallerySelectParam()],
            execute: async ctx => {
                await updateUnlockedGallery(ctx, "add");
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.remove`,
            displayName: "Remove Gallery Item",
            category: "Gallery",
            keywords: ["gallery", "lock", "remove", "cg"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            inspectorParams: [gallerySelectParam()],
            execute: async ctx => {
                await updateUnlockedGallery(ctx, "remove");
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.clear`,
            displayName: "Clear Gallery",
            category: "Gallery",
            keywords: ["gallery", "clear", "reset"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            execute: async ctx => {
                await getHostApi(ctx).persistence.set(RUNTIME_UNLOCKED_KEY, []);
                return { nextPort: "next" };
            },
        },
    ];
}

function gallerySelectParam() {
    return {
        key: "galleryItemId",
        label: "Gallery",
        kind: "select" as const,
        dynamicOptionsSource: DYNAMIC_OPTIONS_SOURCE,
    };
}

async function updateUnlockedGallery(ctx: Parameters<BlueprintNodeDef["execute"]>[0], mode: "add" | "remove") {
    const galleryItemId = String(ctx.params.galleryItemId ?? "").trim();
    if (!galleryItemId) {
        throw new Error("Pick a gallery item");
    }
    const persistence = getHostApi(ctx).persistence;
    const current = await persistence.get(RUNTIME_UNLOCKED_KEY);
    const unlocked = new Set(Array.isArray(current) ? current.filter((id): id is string => typeof id === "string") : []);
    if (mode === "add") {
        unlocked.add(galleryItemId);
    } else {
        unlocked.delete(galleryItemId);
    }
    await persistence.set(RUNTIME_UNLOCKED_KEY, Array.from(unlocked));
}

function getHostApi(ctx: Parameters<BlueprintNodeDef["execute"]>[0]) {
    const hostApi = ctx.hostAdapter.blueprintRuntime?.hostApi;
    if (!hostApi) {
        throw new Error("Gallery nodes require game host APIs");
    }
    return hostApi;
}
