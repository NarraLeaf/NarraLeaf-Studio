import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import type { CharacterDiagnosticTarget } from "@/lib/workspace/services/character/characterDiagnostics";
import type { CharacterTagSelection } from "@/lib/workspace/services/character/types";

/**
 * What the character editor remembers between mounts.
 *
 * Two different lifetimes, so two keys. How the workbench is laid out — the inspector's width, how
 * tall a puppet is previewed — is the same for every character, the way the story editor's preview
 * pane works. What the
 * author was *looking at* (which pose, which tags, what was selected) is per character, and it is
 * the thing that used to be thrown away every time the tab was closed: reopening a character with
 * eight poses put you back on the default pose with the tag selection reset, which on a layered
 * character means re-picking one tag per axis before the picture is the one you were working on.
 *
 * Deliberately NOT stored: which layers are hidden and which are locked. Those are a way of looking
 * at a stack in the moment, not a state of the work — the same reason they are kept off the
 * character itself.
 */

const INSPECTOR_STATE_KEY = "character:editor:inspector";

export const CHARACTER_INSPECTOR_MIN_WIDTH = 260;
export const CHARACTER_INSPECTOR_DEFAULT_WIDTH = 360;
/** The inspector may take at most this fraction of the editor's width. */
export const CHARACTER_INSPECTOR_MAX_FRACTION = 0.7;

export const PUPPET_PREVIEW_MIN_HEIGHT = 120;
export const PUPPET_PREVIEW_DEFAULT_HEIGHT = 168;
/**
 * The ceiling on the puppet preview.
 *
 * The preview shares a scrolling column with the controls that change what it shows, so a preview
 * free to take the whole column would let an author drag the motion and expression pickers out of
 * sight — and then have nothing left on screen to drag back with.
 */
export const PUPPET_PREVIEW_MAX_HEIGHT = 560;

type CharacterInspectorState = { width: number; puppetPreviewHeight: number };

export function getCharacterInspectorWidth(panelState: PanelStateService): number {
    const stored = panelState.getPanelState<Partial<CharacterInspectorState>>(INSPECTOR_STATE_KEY);
    return typeof stored?.width === "number" && Number.isFinite(stored.width)
        ? Math.max(CHARACTER_INSPECTOR_MIN_WIDTH, stored.width)
        : CHARACTER_INSPECTOR_DEFAULT_WIDTH;
}

export function setCharacterInspectorWidth(panelState: PanelStateService, width: number): void {
    panelState.setPanelState<CharacterInspectorState>(INSPECTOR_STATE_KEY, { width });
}

/**
 * How tall the puppet preview is drawn.
 *
 * The same lifetime as the inspector's width and stored beside it: how big a picture an author wants
 * of a model is a fact about their screen and how they work, not about the character being edited.
 * Clamped on read as well as on write, because the stored number outlives the bounds it was written
 * under.
 */
export function getPuppetPreviewHeight(panelState: PanelStateService): number {
    const stored = panelState.getPanelState<Partial<CharacterInspectorState>>(INSPECTOR_STATE_KEY);
    const height = stored?.puppetPreviewHeight;
    return typeof height === "number" && Number.isFinite(height)
        ? Math.min(PUPPET_PREVIEW_MAX_HEIGHT, Math.max(PUPPET_PREVIEW_MIN_HEIGHT, height))
        : PUPPET_PREVIEW_DEFAULT_HEIGHT;
}

export function setPuppetPreviewHeight(panelState: PanelStateService, height: number): void {
    panelState.setPanelState<CharacterInspectorState>(INSPECTOR_STATE_KEY, { puppetPreviewHeight: height });
}

export type CharacterEditorViewState = {
    /** Layered: which tag each axis is previewing. Never stored on the character. */
    previewTags: CharacterTagSelection;
    onionAxisId: string | null;
    /**
     * What was selected. For a preset character this is also which pose the big preview shows — the
     * two are one idea, which is why previewing a pose does not need (and must not have) a second
     * piece of state that could disagree with the selection a diagnostic row jumps to.
     */
    focus: CharacterDiagnosticTarget | null;
};

export const EMPTY_CHARACTER_EDITOR_VIEW_STATE: CharacterEditorViewState = {
    previewTags: {},
    onionAxisId: null,
    focus: null,
};

function viewStateKey(characterId: string): string {
    return `character:editor:view:${characterId}`;
}

/**
 * Read back what this character was last being looked at as.
 *
 * Every field is checked rather than trusted: a stored pose or axis may have been deleted since, and
 * the editor resolves ids against the live appearance anyway, so an id that no longer exists degrades
 * to the default instead of blanking the pane.
 */
export function getCharacterEditorViewState(
    panelState: PanelStateService,
    characterId: string,
): CharacterEditorViewState {
    const stored = panelState.getPanelState<Partial<CharacterEditorViewState>>(viewStateKey(characterId));
    if (!stored) {
        return EMPTY_CHARACTER_EDITOR_VIEW_STATE;
    }
    const tags: CharacterTagSelection = {};
    for (const [axisId, tagId] of Object.entries(stored.previewTags ?? {})) {
        if (typeof axisId === "string" && typeof tagId === "string") {
            tags[axisId] = tagId;
        }
    }
    const focus = stored.focus;
    // The selection's `tags` are deliberately dropped on the way back in: `previewTags` above is the
    // authority on what is being looked at, and a selection carrying a second, stale copy of it would
    // be a second answer to the same question the next time something read the focus.
    return {
        previewTags: tags,
        onionAxisId: typeof stored.onionAxisId === "string" ? stored.onionAxisId : null,
        focus: focus && typeof focus.id === "string"
            && (focus.kind === "layer" || focus.kind === "axis" || focus.kind === "pose"
                || focus.kind === "combination")
            ? { kind: focus.kind, id: focus.id }
            : null,
    };
}

export function patchCharacterEditorViewState(
    panelState: PanelStateService,
    characterId: string,
    patch: Partial<CharacterEditorViewState>,
): void {
    panelState.setPanelState<Partial<CharacterEditorViewState>>(viewStateKey(characterId), patch);
}
