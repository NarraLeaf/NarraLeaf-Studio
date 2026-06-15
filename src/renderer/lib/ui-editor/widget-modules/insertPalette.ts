import { widgetModuleRegistry } from "./registryInstance";
import type { UIWidgetModule } from "./types";

/**
 * Explicit user-insert palette order (decision 8: palette is not `registry.list()`).
 * Internal-only modules (e.g. `nl.root`) are omitted here.
 */
const INSERT_PALETTE_TYPES = ["nl.container", "nl.text", "nl.image", "nl.button", "nl.list"] as const;

export function listInsertPaletteModules(): UIWidgetModule[] {
    return INSERT_PALETTE_TYPES.map(type => {
        const mod = widgetModuleRegistry.get(type);
        if (!mod) {
            throw new Error(`[insertPalette] Missing widget module for palette type: ${type}`);
        }
        return mod;
    });
}
