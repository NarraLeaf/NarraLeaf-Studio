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
 * The two nulls are the whole of the loss, and both are deliberate:
 *  - `conditionIf` was a duplicate of `condition` down to the constructor (D3), removed by §6;
 *  - `narration` has no spec because narration is not a command - a bare line of text IS narration
 *    (bible §2 retired the token), so there is nothing for the entry to point at.
 * Typed as a total map over the id union so a future id cannot quietly skip this table.
 */
export const LEGACY_FAVORITE_TO_SPEC_ID: Readonly<Record<ActionCommandId | "conditionIf", string | null>> = {
    narration: null,
    conditionIf: null,

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
    characterMove: "move",
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
    displayableEffect: "fx",
    screenBlink: "blink",
    screenVignette: "vignette",

    bgm: "bgm",
    sound: "sound",
    stopSound: "stop",
    pauseSound: "pause",
    resumeSound: "resume",
    soundVolume: "volume",
    soundRate: "rate",
    muteSound: "mute",

    setVariable: "set",
    incrementVariable: "inc",
    decrementVariable: "dec",
    toggleVariable: "toggle",
    resetVariable: "reset",
    declareSceneVariable: "declareLocal",
    declareSavedVariable: "declareVar",
    declarePersistentVariable: "declarePersis",
    executeScript: "blueprint",
    code: "code",
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
