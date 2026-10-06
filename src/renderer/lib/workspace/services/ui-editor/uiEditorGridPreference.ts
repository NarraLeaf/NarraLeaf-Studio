import {
    DEFAULT_UI_EDITOR_GRID_SPACING,
    normalizeUiEditorGridSpacing,
} from "../../../ui-editor/snapping/gridSnap";

/**
 * Where the UI editor keeps the canvas grid's spacing: one entry in the project's panel state store.
 *
 * That store lives in the project's `.nlstudio/services/` (see `SERVICE_STORE_LOCATIONS`), so the
 * spacing is remembered per project and never enters the versioned tree or the game - it is how this
 * author lays out this project's screens, not something the screens are. Not global settings: two
 * projects with different design sizes want different grids.
 */
export const UI_EDITOR_GRID_PANEL_STATE_ID = "uiEditor.canvasGrid";

type StoredGridPreference = {
    spacing?: unknown;
};

/** The part of `PanelStateService` the grid preference needs. */
export type GridPreferenceStore = {
    getPanelState<T extends Record<string, any>>(panelId: string): T | undefined;
    setPanelState<T extends Record<string, any>>(panelId: string, partial: Partial<T>): void;
};

/** The stored spacing, or the default when there is none or it is not a usable number. */
export function readUiEditorGridSpacing(store: GridPreferenceStore | null): number {
    const stored = store?.getPanelState<StoredGridPreference>(UI_EDITOR_GRID_PANEL_STATE_ID);
    return normalizeUiEditorGridSpacing(stored?.spacing) ?? DEFAULT_UI_EDITOR_GRID_SPACING;
}

export function writeUiEditorGridSpacing(store: GridPreferenceStore | null, spacing: number): void {
    store?.setPanelState<StoredGridPreference>(UI_EDITOR_GRID_PANEL_STATE_ID, { spacing });
}
