import { isUsableSectionSize, type SectionStackSpec } from "@/apps/workspace/components/ui/sectionStackLayout";

/**
 * The UI rail's three sections, and the per-project record of how the author left them.
 *
 * The record lives in the project's panel state (`.nlstudio/services/panel_state.json`) under
 * {@link UI_RAIL_PANEL_STATE_ID}: one boolean per section that has ever been opened or closed, and
 * since the rail became a stack of sections, the body heights the author dragged them to under
 * `sizes`. A record written before that has no `sizes` and reads as "never sized".
 */

/** The panel-state record's id. */
export const UI_RAIL_PANEL_STATE_ID = "ui.rail.sections";

export type UIRailSection = "surfaces" | "componentLibrary" | "inputActions";

/** The section that takes up the slack: the interface list is what the rail is for. */
export const UI_RAIL_FILL_SECTION: UIRailSection = "surfaces";

/**
 * The sections top to bottom, and how small each body may be made while there is room.
 *
 * The interface list's floor holds its kind switch, the create row and one row of cards. The two
 * libraries' floors hold the start of a card - enough to see what is there and scroll to the rest -
 * and they open at a height that leaves the interface list most of a default window.
 */
export const UI_RAIL_SECTIONS: readonly (SectionStackSpec & { id: UIRailSection })[] = [
    { id: "surfaces", minSize: 200, defaultSize: 320 },
    { id: "componentLibrary", minSize: 120, defaultSize: 200 },
    { id: "inputActions", minSize: 120, defaultSize: 200 },
];

export type UIRailSectionSizes = Partial<Record<UIRailSection, number>>;

export type UIRailSectionsState = {
    open: Record<UIRailSection, boolean>;
    sizes: UIRailSectionSizes;
};

/** What the panel state holds for the rail. Every field is optional: records are written piecemeal. */
export type UIRailSectionsRecord = Partial<Record<UIRailSection, boolean>> & { sizes?: UIRailSectionSizes };

/** Only the sizes worth keeping: known sections, positive whole pixels. */
export function cleanUIRailSizes(sizes: unknown): UIRailSectionSizes {
    const clean: UIRailSectionSizes = {};
    if (!sizes || typeof sizes !== "object") {
        return clean;
    }
    for (const { id } of UI_RAIL_SECTIONS) {
        const value = (sizes as Record<string, unknown>)[id];
        if (isUsableSectionSize(value)) {
            clean[id] = Math.round(value);
        }
    }
    return clean;
}

/**
 * The rail as a project left it.
 *
 * The interface list is open unless the author closed it. The two libraries are closed until the
 * author opens them: on a new project they are empty tables, and a fresh rail should show the pages.
 * Anything malformed reads as the default, never as an error - this is a layout preference.
 */
export function readUIRailSections(record: unknown): UIRailSectionsState {
    const stored = record && typeof record === "object" ? (record as Record<string, unknown>) : {};
    return {
        open: {
            surfaces: stored.surfaces !== false,
            componentLibrary: stored.componentLibrary === true,
            inputActions: stored.inputActions === true,
        },
        sizes: cleanUIRailSizes(stored.sizes),
    };
}
