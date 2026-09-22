/**
 * The picture a backlog row carries, and the two absences that are not the same as a blank one.
 *
 * A backlog line records a speaker's *name* and nothing else about them, so the portrait is resolved
 * rather than read: the name is joined against the project's characters and the character answers
 * with its dialog avatar. What is worth pinning is where that join must not produce a picture -
 * narration, a resolved choice, a speaker this build has no character for - because each of those
 * would otherwise show whichever face the join happened to land on, and a face against a line nobody
 * spoke is a lie a test written only on the happy path does not catch.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import type { LiveGame } from "narraleaf-react";
import type { BlueprintGameHistoryEntry } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { toBlueprintImageAsset } from "@shared/types/blueprint/valueTypes";
import { resolveDefaultCharacterAvatarAssetId } from "@shared/utils/characterAvatar";
import type { DevModeCharacterSummary } from "@shared/types/devMode";
import { createChoiceMenus } from "./choiceMenus";
import { createDialogClickTargets } from "./dialogClickTargets";
import { createLiveGameUiCallbacks } from "./gameUiSlots";

/** One backlog entry in the shape `LiveGame.getHistory()` hands out. */
function sayEntry(token: string, character: string | null, text: string): unknown {
    return { token, element: { type: "say", text, voice: null, voiceId: null, character } };
}

function menuEntry(token: string, prompt: string, selected: string): unknown {
    return { token, element: { type: "menu", text: prompt, selected } };
}

/**
 * A preset character whose default pose has a baked avatar - the shape the shipped skeleton's own
 * character has, and the one a profile field alone would answer `null` for.
 */
const BAKED: DevModeCharacterSummary = {
    id: "char-narra",
    name: "Narra",
    appearance: {
        kind: "preset",
        defaultPoseId: "p1",
        poses: [{ id: "p1", name: "Default", assetId: "sprite-1" }],
        avatars: { p1: { baked: "hash" } },
    },
} as unknown as DevModeCharacterSummary;

/** A character with nothing to show: no pose, no avatar entry, no profile default. */
const FACELESS: DevModeCharacterSummary = {
    id: "char-aoi",
    name: "Aoi",
    appearance: { kind: "preset", defaultPoseId: null, poses: [] },
} as unknown as DevModeCharacterSummary;

const CHARACTERS = [BAKED, FACELESS];

/** The two readers, already narrowed: this host answers synchronously, the capability type allows either. */
function rows(value: BlueprintGameHistoryEntry[] | Promise<BlueprintGameHistoryEntry[]>): BlueprintGameHistoryEntry[] {
    return value as BlueprintGameHistoryEntry[];
}

function callbacks(history: unknown[], future: unknown[] = []) {
    const liveGame = {
        getHistory: () => history,
        getFuture: () => future,
    } as unknown as LiveGame;
    return createLiveGameUiCallbacks({
        requireLiveGame: () => liveGame,
        getLiveGame: () => liveGame,
        choiceMenus: createChoiceMenus(),
        currentDialogNametagRef: { current: null },
        dialogClickTargets: createDialogClickTargets(),
        resolveSpeakerAvatar: sourceName => toBlueprintImageAsset(
            resolveDefaultCharacterAvatarAssetId(CHARACTERS.find(entry => entry.name === sourceName)),
        ),
    });
}

describe("the picture on a backlog row", () => {
    it("is the speaker's dialog avatar, baked differentials included", () => {
        const [row] = rows(callbacks([sayEntry("t1", "Narra", "Morning.")]).onGetHistory());
        // The id a baked avatar is addressed by, not the profile's own field - which this character
        // does not have, and which is what "the character's avatar" used to mean.
        expect(row?.avatar).toEqual({
            kind: "imageAsset",
            assetId: "character-avatar:char-narra:p1",
        });
    });

    it("is nothing for narration", () => {
        const [row] = rows(callbacks([sayEntry("t1", null, "The corridor was empty.")]).onGetHistory());
        expect(row?.character).toBeNull();
        expect(row?.avatar).toBeNull();
    });

    it("is nothing for a resolved choice", () => {
        const [row] = rows(callbacks([menuEntry("t1", "Which way?", "Left")]).onGetHistory());
        expect(row?.type).toBe("menu");
        expect(row?.avatar).toBeNull();
    });

    it("is nothing for a speaker this build has no character for", () => {
        const [row] = rows(callbacks([sayEntry("t1", "A passer-by", "Watch it.")]).onGetHistory());
        expect(row?.character).toBe("A passer-by");
        expect(row?.avatar).toBeNull();
    });

    it("is nothing for a character with no avatar of any kind", () => {
        const [row] = rows(callbacks([sayEntry("t1", "Aoi", "...")]).onGetHistory());
        expect(row?.character).toBe("Aoi");
        expect(row?.avatar).toBeNull();
    });

    it("answers the same on both sides of the play head", () => {
        const live = callbacks([sayEntry("t1", "Narra", "Behind.")], [sayEntry("t2", "Narra", "Ahead.")]);
        expect(rows(live.onGetFuture())[0]?.avatar).toEqual(rows(live.onGetHistory())[0]?.avatar);
    });

    it("has no picture at all on a host that cannot resolve one", () => {
        const liveGame = { getHistory: () => [sayEntry("t1", "Narra", "Morning.")] } as unknown as LiveGame;
        const read = rows(createLiveGameUiCallbacks({
            requireLiveGame: () => liveGame,
            getLiveGame: () => liveGame,
            choiceMenus: createChoiceMenus(),
            currentDialogNametagRef: { current: null },
            dialogClickTargets: createDialogClickTargets(),
        }).onGetHistory());
        expect(read[0]?.character).toBe("Narra");
        expect(read[0]?.avatar).toBeNull();
    });
});
