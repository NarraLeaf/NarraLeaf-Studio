import { widgetModuleRegistry } from "./registryInstance";
import type { UIWidgetModule } from "./types";

export type InsertPalettePlacement = "primary" | "overflow";

export type InsertPaletteConfigEntry = {
    readonly type: string;
    readonly placement?: InsertPalettePlacement;
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
    { type: "nl.list" },
] as const satisfies readonly InsertPaletteConfigEntry[];

export function resolveInsertPaletteEntries(
    config: readonly InsertPaletteConfigEntry[],
    resolveModule: (type: string) => UIWidgetModule | undefined = type => widgetModuleRegistry.get(type),
): InsertPaletteEntry[] {
    return config.map(entry => {
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

export function listInsertPaletteEntries(): InsertPaletteEntry[] {
    return resolveInsertPaletteEntries(DEFAULT_INSERT_PALETTE_CONFIG);
}

export function listInsertPaletteModules(): UIWidgetModule[] {
    return listInsertPaletteEntries().map(entry => entry.module);
}
