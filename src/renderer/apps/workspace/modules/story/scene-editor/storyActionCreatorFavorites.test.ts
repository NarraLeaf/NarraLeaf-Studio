import { describe, expect, it } from "vitest";
import { getCommandSpec } from "./commands/registry";
import { LEGACY_FAVORITE_TO_SPEC_ID, migrateStarredActionIds } from "./storyActionCreatorFavorites";

/**
 * The favourites migration (WI-4) - A1's only real data migration.
 *
 * `story.actionCreator.starredActionIds` stores palette ids, and A1 deleted the catalogue those came
 * from. The requirement is blunt: do not silently empty a user's favourites. So every id the old
 * sidebar could star has to land on a live spec, and the only ones allowed to disappear are the two
 * whose commands genuinely no longer exist.
 */

/** The 57 ids `ACTION_COMMANDS` shipped - frozen here because the catalogue itself is gone. */
const LEGACY_STARRABLE_IDS = [
    "dialogue", "narration", "characterEnter", "characterMove", "characterExpression", "characterExit",
    "background", "jump", "choice", "condition", "repeat", "parallel", "race", "sequence",
    "waitDuration", "waitClick", "setVariable", "incrementVariable", "decrementVariable",
    "toggleVariable", "resetVariable", "declareSceneVariable", "declareSavedVariable",
    "declarePersistentVariable", "conditionIf", "executeScript", "imageCreate", "imageSetSource",
    "imageShow", "imageHide", "displayableTransform", "displayableShow", "displayableHide",
    "displayableEffect", "textCreate", "textSet", "textShow", "textHide", "textFont", "layerCreate",
    "layerZIndex", "videoCreate", "videoShow", "videoHide", "videoPlay", "nvl", "screenBlink",
    "screenVignette", "bgm", "sound", "stopSound", "pauseSound", "resumeSound", "soundVolume",
    "soundRate", "muteSound", "note",
] as const;

/** The only two allowed to vanish: a duplicate entry (D3) and a command that is no longer a command. */
const DROPPED = ["conditionIf", "narration"];

describe("starred favourites migration", () => {
    it("covers the whole legacy catalogue - no stored favourite falls through unmapped", () => {
        for (const id of LEGACY_STARRABLE_IDS) {
            expect(Object.hasOwn(LEGACY_FAVORITE_TO_SPEC_ID, id)).toBe(true);
        }
    });

    it("lands every legacy id on a live spec, except the two documented drops", () => {
        for (const id of LEGACY_STARRABLE_IDS) {
            const migrated = migrateStarredActionIds([id]);
            if (DROPPED.includes(id)) {
                expect(migrated).toEqual([]);
                continue;
            }
            expect(migrated).toHaveLength(1);
            expect(getCommandSpec(migrated[0])).toBeTruthy();
        }
    });

    it("loses nothing but the drops when the whole catalogue is starred", () => {
        const migrated = migrateStarredActionIds([...LEGACY_STARRABLE_IDS]);
        // Ten "object type × verb" entries collapse onto the generic verbs that replaced them, so the
        // set is smaller by construction - what must NOT happen is a survivor going missing.
        for (const id of LEGACY_STARRABLE_IDS) {
            if (DROPPED.includes(id)) {
                continue;
            }
            expect(migrated).toContain(LEGACY_FAVORITE_TO_SPEC_ID[id]);
        }
        expect(migrated.every(id => Boolean(getCommandSpec(id)))).toBe(true);
        expect(new Set(migrated).size).toBe(migrated.length);
    });

    it("folds the five old show entries onto one starred /show, keeping first-seen order", () => {
        expect(migrateStarredActionIds([
            "imageShow", "textShow", "videoShow", "displayableShow", "characterEnter", "bgm",
        ])).toEqual(["show", "bgm"]);
    });

    it("is idempotent - a migrated list migrates to itself", () => {
        const once = migrateStarredActionIds([...LEGACY_STARRABLE_IDS]);
        expect(migrateStarredActionIds(once)).toEqual(once);
    });

    it("keeps ids it does not own, so a plugin action stays starred", () => {
        expect(migrateStarredActionIds(["acme.confetti", "imageHide"])).toEqual(["acme.confetti", "hide"]);
    });
});
