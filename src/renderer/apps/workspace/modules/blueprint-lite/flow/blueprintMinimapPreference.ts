/**
 * How large the graph overview is, and whether it is there at all.
 *
 * Both answers are the author's, and both are remembered: an overview closed on one visit that
 * comes back on the next has not been closed, it has been dismissed, and a size chosen once should
 * not have to be chosen again on every tab.
 *
 * Three sizes rather than a drag handle. The overview is read, not worked in - what changes between
 * "big enough to find a node in a wide graph" and "small enough to keep out of the corner" is a step,
 * not a continuum, and a resizable HUD would be one more thing to knock out of shape by accident.
 *
 * Comments in English per project convention.
 */

export type BlueprintMinimapSize = "small" | "medium" | "large";

/** 16:9, the shape of the canvas the overview summarises, so its letterbox stays thin. */
export const BLUEPRINT_MINIMAP_SIZES: Record<BlueprintMinimapSize, { width: number; height: number }> = {
    small: { width: 176, height: 99 },
    medium: { width: 240, height: 135 },
    large: { width: 320, height: 180 },
};

export const BLUEPRINT_MINIMAP_SIZE_ORDER: BlueprintMinimapSize[] = ["small", "medium", "large"];

export type BlueprintMinimapPreference = {
    visible: boolean;
    size: BlueprintMinimapSize;
};

export const DEFAULT_BLUEPRINT_MINIMAP_PREFERENCE: BlueprintMinimapPreference = {
    visible: true,
    size: "medium",
};

/**
 * A stored preference narrowed to one this canvas can draw.
 *
 * Total by design: this reads a panel-state record written by an older Studio, by a newer one, or
 * by nothing at all, and an unreadable one has to leave the author with a working overview rather
 * than a canvas missing its corner.
 */
export function normalizeBlueprintMinimapPreference(raw: unknown): BlueprintMinimapPreference {
    if (!raw || typeof raw !== "object") {
        return DEFAULT_BLUEPRINT_MINIMAP_PREFERENCE;
    }
    const record = raw as Partial<BlueprintMinimapPreference>;
    return {
        visible: typeof record.visible === "boolean" ? record.visible : DEFAULT_BLUEPRINT_MINIMAP_PREFERENCE.visible,
        size: isBlueprintMinimapSize(record.size) ? record.size : DEFAULT_BLUEPRINT_MINIMAP_PREFERENCE.size,
    };
}

function isBlueprintMinimapSize(value: unknown): value is BlueprintMinimapSize {
    return value === "small" || value === "medium" || value === "large";
}
