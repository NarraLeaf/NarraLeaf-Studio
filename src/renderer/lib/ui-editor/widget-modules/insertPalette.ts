import { widgetModuleRegistry } from "./registryInstance";
import type { UIWidgetModule } from "./types";
import type { UISurfaceKind } from "@shared/types/ui-editor/document";

export type InsertPalettePlacement = "primary" | "overflow";

export type InsertPaletteConfigEntry = {
    readonly type: string;
    readonly placement?: InsertPalettePlacement;
    readonly surfaceKinds?: readonly UISurfaceKind[];
};

export type InsertPaletteEntry = {
    readonly module: UIWidgetModule;
    readonly placement: InsertPalettePlacement;
};

/**
 * Explicit user-insert palette order (decision 8: palette is not `registry.list()`).
 * Internal-only modules (e.g. `nl.root`) are omitted here.
 */
export const DEFAULT_INSERT_PALETTE_CONFIG = [
    { type: "nl.container" },
    { type: "nl.text" },
    { type: "nl.image" },
    { type: "nl.button" },
    { type: "nl.slider", placement: "overflow" },
    { type: "nl.list", placement: "overflow" },
    { type: "nl.frame", placement: "overflow", surfaceKinds: ["appSurface"] },
] as const satisfies readonly InsertPaletteConfigEntry[];

export function resolveInsertPaletteEntries(
    config: readonly InsertPaletteConfigEntry[],
    resolveModule: (type: string) => UIWidgetModule | undefined = type => widgetModuleRegistry.get(type),
    surfaceKind?: UISurfaceKind,
): InsertPaletteEntry[] {
    return config
        .filter(entry => !surfaceKind || !entry.surfaceKinds || entry.surfaceKinds.includes(surfaceKind))
        .map(entry => {
            const mod = resolveModule(entry.type);
            if (!mod) {
                throw new Error(`[insertPalette] Missing widget module for palette type: ${entry.type}`);
            }
            return {
                module: mod,
                placement: entry.placement ?? "primary",
            };
        });
}

export function listInsertPaletteEntries(surfaceKind?: UISurfaceKind): InsertPaletteEntry[] {
    return resolveInsertPaletteEntries(DEFAULT_INSERT_PALETTE_CONFIG, undefined, surfaceKind);
}

export function listInsertPaletteModules(surfaceKind?: UISurfaceKind): UIWidgetModule[] {
    return listInsertPaletteEntries(surfaceKind).map(entry => entry.module);
}
