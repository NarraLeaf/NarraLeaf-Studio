import { widgetModuleRegistry } from "./registryInstance";
import type { UIWidgetModule } from "./types";
import type { UIStageSlotId, UISurface, UISurfaceKind } from "@shared/types/ui-editor/document";

export type InsertPalettePlacement = "primary" | "overflow";

export type InsertPaletteConfigEntry = {
    readonly type: string;
    readonly placement?: InsertPalettePlacement;
    readonly surfaceKinds?: readonly UISurfaceKind[];
    readonly stageSlots?: readonly UIStageSlotId[];
};

export type InsertPaletteEntry = {
    readonly module: UIWidgetModule;
    readonly placement: InsertPalettePlacement;
    /**
     * The plugin this widget came from, as the plugin names itself. Absent for the built-in
     * widgets, which are Studio's own and belong to nobody.
     */
    readonly ownerPluginName?: string;
};

/**
 * Explicit user-insert palette order (decision 8: palette is not `registry.list()`).
 * Internal-only modules (e.g. `nl.root`) are omitted here.
 */
export const DEFAULT_INSERT_PALETTE_CONFIG = [
    { type: "nl.container" },
    { type: "nl.text" },
    { type: "nl.dialog.sentence", surfaceKinds: ["stageSurface"], stageSlots: ["dialog"] },
    { type: "nl.notification.list", surfaceKinds: ["stageSurface"], stageSlots: ["notification"] },
    { type: "nl.choice.list", surfaceKinds: ["stageSurface"], stageSlots: ["choice"] },
    { type: "nl.nvl.list", surfaceKinds: ["stageSurface"], stageSlots: ["nvl"] },
    { type: "nl.nvl.texts", surfaceKinds: ["stageSurface"], stageSlots: ["nvl"] },
    { type: "nl.image" },
    { type: "nl.button" },
    { type: "nl.textInput", placement: "overflow" },
    { type: "nl.switch", placement: "overflow" },
    { type: "nl.video", placement: "overflow" },
    { type: "nl.puppet", placement: "overflow" },
    { type: "nl.slider", placement: "overflow" },
    { type: "nl.list", placement: "overflow" },
    { type: "nl.frame", placement: "overflow", surfaceKinds: ["appSurface"] },
] as const satisfies readonly InsertPaletteConfigEntry[];

export type InsertPaletteSurfaceFilter = UISurfaceKind | UISurface | null | undefined;

function surfaceKindForFilter(surface: InsertPaletteSurfaceFilter): UISurfaceKind | undefined {
    return typeof surface === "string" ? surface : surface?.kind;
}

function stageSlotForFilter(surface: InsertPaletteSurfaceFilter): UIStageSlotId | undefined {
    return typeof surface === "string" || !surface || surface.kind !== "stageSurface"
        ? undefined
        : surface.mount.slotId;
}

export function resolveInsertPaletteEntries(
    config: readonly InsertPaletteConfigEntry[],
    resolveModule: (type: string) => UIWidgetModule | undefined = type => widgetModuleRegistry.get(type),
    surface?: InsertPaletteSurfaceFilter,
): InsertPaletteEntry[] {
    const surfaceKind = surfaceKindForFilter(surface);
    const stageSlot = stageSlotForFilter(surface);
    return config
        .filter(entry => !surfaceKind || !entry.surfaceKinds || entry.surfaceKinds.includes(surfaceKind))
        .filter(entry => !entry.stageSlots || (surfaceKind === "stageSurface" && stageSlot != null && entry.stageSlots.includes(stageSlot)))
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

/**
 * The widget types plugins currently contribute, as palette entries.
 *
 * Read from the module registry rather than from a second list, so a plugin switched off in the
 * plugins panel leaves the palette at the same moment it stops drawing. The order is the plugin's
 * name and then the widget's, which is the order the author reads them in; the registry's own
 * insertion order is the order plugins happened to load in, and says nothing.
 *
 * Always in the overflow menu. The primary row is icons with no labels - a widget nobody has seen
 * before cannot say what it is or where it came from there, and the overflow rows carry both.
 *
 * No surface filtering: `surfaceKinds` and `stageSlots` exist for the built-in widgets that only
 * make sense in one engine slot, and a plugin has no way to declare either.
 */
export function listPluginInsertPaletteEntries(): InsertPaletteEntry[] {
    const entries: InsertPaletteEntry[] = [];
    for (const module of widgetModuleRegistry.list()) {
        const ownerPluginName = widgetModuleRegistry.getOwnerName(module.type);
        if (!ownerPluginName) {
            continue;
        }
        entries.push({ module, placement: "overflow", ownerPluginName });
    }
    return entries.sort((left, right) =>
        (left.ownerPluginName ?? "").localeCompare(right.ownerPluginName ?? "")
        || left.module.displayName.localeCompare(right.module.displayName));
}

export function listInsertPaletteEntries(surface?: InsertPaletteSurfaceFilter): InsertPaletteEntry[] {
    return [
        ...resolveInsertPaletteEntries(DEFAULT_INSERT_PALETTE_CONFIG, undefined, surface),
        ...listPluginInsertPaletteEntries(),
    ];
}

export function listInsertPaletteModules(surface?: InsertPaletteSurfaceFilter): UIWidgetModule[] {
    return listInsertPaletteEntries(surface).map(entry => entry.module);
}
