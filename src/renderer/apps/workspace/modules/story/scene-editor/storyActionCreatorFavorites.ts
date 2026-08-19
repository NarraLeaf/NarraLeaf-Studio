import { getCommandSpec } from "./commands/registry";
import type { ActionCommandId } from "./storyActionCommands";

/**
 * The sidebar's starred-commands setting, and the one-time migration A1 owes it.
 *
 * `story.actionCreator.starredActionIds` persists **palette command ids**, and until A1 those were
 * `ACTION_COMMANDS` ids. Deleting that catalogue orphaned every stored favourite at once, so the read
 * path rewrites legacy ids onto their spec equivalents. The rule the table encodes is the same one the
 * whole card is about: ten "object type × verb" entries collapse onto the generic verb that replaced
 * them (`imageShow` `textShow` `videoShow` `displayableShow` `characterEnter` → `show`), which is why
 * the migrated set can be SMALLER than the stored one without anything having been lost.
 *
 * Only ids this table knows are ever rewritten or dropped. An id that is already a spec id passes
 * through (the migration is idempotent), and an unknown id - a plugin action, namespaced and beyond
 * this file's knowledge - is kept untouched rather than treated as stale.
 */

export const FAVORITES_SETTING_KEY = "story.actionCreator.starredActionIds";

/**
 * Legacy palette id → spec id, or `null` for "this command no longer exists as a menu entry".
 *
 * The five nulls are the whole of the loss, and all five are deliberate:
 *  - `conditionIf` was a duplicate of `condition` down to the constructor (D3), removed by §6;
 *  - `narration` has no spec because narration is not a command - a bare line of text IS narration
 *    (the token was retired), so there is nothing for the entry to point at;
 *  - `code` was deleted outright in schema v13 (the block never ran), and its token is reserved, so
 *    there is deliberately nothing for a starred `/code` to land on;
 *  - `declareSavedVariable` / `declarePersistentVariable` went with `/save` and `/global`. A saved or
 *    persistent variable is declared in the project variable registry now, and the registry is not a
 *    row the creator can insert - so there is no spec to land on, and unstarring is the honest
 *    outcome rather than pointing the author at `/local`, which declares a *different* variable.
 * Typed as a total map over the id union so a future id cannot quietly skip this table. The three
 * spelled explicitly beside the union are no longer members of it, and a stored favourite still
 * carrying one has to be recognised rather than kept as an unknown plugin action.
 */
export const LEGACY_FAVORITE_TO_SPEC_ID: Readonly<
    Record<ActionCommandId | "conditionIf" | "code" | "declareSavedVariable" | "declarePersistentVariable" | "screenBlink" | "screenVignette", string | null>
> = {
    narration: null,
    conditionIf: null,
    code: null,
    declareSavedVariable: null,
    declarePersistentVariable: null,

    dialogue: "say",
    choice: "menu",
    choiceOption: "menu",
    condition: "if",
    conditionBranch: "if",
    repeat: "repeat",
    parallel: "parallel",
    race: "race",
    sequence: "sequence",
    background: "background",
    jump: "jump",
    nvl: "nvl",
    waitDuration: "wait",
    waitClick: "wait",

    characterEnter: "show",
    characterExit: "hide",
    // M2: a move is a position, which is a prop of the one bag - `/transform <who> pos=`.
    characterMove: "transform",
    characterExpression: "face",

    imageCreate: "image",
    imageSetSource: "swap",
    imageShow: "show",
    imageHide: "hide",
    textCreate: "text",
    textSet: "swap",
    textShow: "show",
    textHide: "hide",
    textFont: "font",
    layerCreate: "layer",
    layerZIndex: "layer",
    videoCreate: "video",
    videoShow: "show",
    videoHide: "hide",
    videoPlay: "play",
    displayableShow: "show",
    displayableHide: "hide",
    displayableTransform: "transform",
    // M2: an "effect" was one prop of the one bag. v19 finished the job: the two screen gestures are
    // lens props on the camera, so they are a `/transform camera lens=` row like any other.
    displayableEffect: "transform",
    // The two retired screen gestures, and the lens row that replaced them: all three are the one
    // `/transform` verb, because a blink is a prop of the camera's bag now.
    screenBlink: "transform",
    screenVignette: "transform",
    cameraBlink: "transform",

    bgm: "bgm",
    sound: "sound",
    stopSound: "stop",
    pauseSound: "pause",
    resumeSound: "resume",
    soundVolume: "volume",
    soundRate: "rate",
    muteSound: "mute",
    seekSound: "seek",

    setVariable: "set",
    incrementVariable: "inc",
    decrementVariable: "dec",
    toggleVariable: "toggle",
    resetVariable: "reset",
    declareSceneVariable: "declareLocal",
    executeScript: "blueprint",
    note: "note",
};

/**
 * The stored favourites, rewritten onto spec ids: order preserved, duplicates folded (five old
 * `show` entries are one starred `/show`), unknown ids kept.
 */
export function migrateStarredActionIds(stored: readonly string[]): string[] {
    const migrated: string[] = [];
    for (const id of stored) {
        if (typeof id !== "string" || !id) {
            continue;
        }
        // A live spec id is already migrated - checked first so a legacy id that happens to spell a
        // spec id (`note`, `jump`, `bgm`…) cannot be rewritten twice or dropped on a second pass.
        const next = getCommandSpec(id) ? id : id in LEGACY_FAVORITE_TO_SPEC_ID
            ? LEGACY_FAVORITE_TO_SPEC_ID[id as keyof typeof LEGACY_FAVORITE_TO_SPEC_ID]
            : id;
        if (next && !migrated.includes(next)) {
            migrated.push(next);
        }
    }
    return migrated;
}
