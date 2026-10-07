/**
 * A character's name where the player reads it - the name plate and a backlog row - in the game's
 * language.
 *
 * The engine records a speaker by the name it was given and hands that string back everywhere; the
 * name plate once preferred the engine's copy of the last line's speaker over the translated prompt,
 * so a game read in English showed English lines under a Chinese name. What is pinned here is that
 * every reader goes through the one translation, and what a name no character is written with (a
 * `/rename` row's own words) does.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import type { LiveGame } from "narraleaf-react";
import type { BlueprintGameHistoryEntry } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { resolveLocalizedSpeakerName, type GameLocalizationBundle } from "@shared/types/localization";
import { createChoiceMenus } from "./choiceMenus";
import { createDialogClickTargets } from "./dialogClickTargets";
import { createLiveGameUiCallbacks } from "./gameUiSlots";

const CHARACTERS = [
    { id: "char-aoi", name: "葵" },
    { id: "char-narra", name: "Narra" },
];

const BUNDLE: GameLocalizationBundle = {
    sourceLocale: "zh-CN",
    locales: [
        { code: "zh-CN", displayName: "简体中文" },
        { code: "en", displayName: "English" },
        { code: "en-GB", displayName: "English (UK)", fallback: "en" },
        { code: "ko", displayName: "한국어" },
    ],
    tables: { en: { "char:char-aoi": "Aoi", "char:char-narra": "Narra-EN" } },
};

function sayEntry(token: string, character: string | null, text: string): unknown {
    return { token, element: { type: "say", text, voice: null, voiceId: null, character } };
}

function callbacks(locale: string, options: { history?: unknown[]; lastSpeaker?: string | null; prompt?: string | null } = {}) {
    const liveGame = {
        getHistory: () => options.history ?? [],
        getFuture: () => [],
        lastDialog: options.lastSpeaker === undefined ? null : { speaker: options.lastSpeaker },
    } as unknown as LiveGame;
    return createLiveGameUiCallbacks({
        requireLiveGame: () => liveGame,
        getLiveGame: () => liveGame,
        choiceMenus: createChoiceMenus(),
        currentDialogNametagRef: { current: options.prompt ?? null },
        dialogClickTargets: createDialogClickTargets(),
        displaySpeakerName: name => resolveLocalizedSpeakerName(BUNDLE, locale, CHARACTERS, name),
    });
}

describe("a speaker's name in the game's language", () => {
    it("is the character's translation, falling back along the language chain as a line does", () => {
        expect(resolveLocalizedSpeakerName(BUNDLE, "en", CHARACTERS, "葵")).toBe("Aoi");
        expect(resolveLocalizedSpeakerName(BUNDLE, "en-GB", CHARACTERS, "葵")).toBe("Aoi");
        expect(resolveLocalizedSpeakerName(BUNDLE, "ko", CHARACTERS, "葵")).toBe("葵");
        expect(resolveLocalizedSpeakerName(BUNDLE, "zh-CN", CHARACTERS, "葵")).toBe("葵");
    });

    it("shows a name no character is written with as recorded - a /rename row's own words", () => {
        expect(resolveLocalizedSpeakerName(BUNDLE, "en", CHARACTERS, "？？？")).toBe("？？？");
        // Renamed back to the character's own name, it is that character's name again.
        expect(resolveLocalizedSpeakerName(BUNDLE, "en", CHARACTERS, "Narra")).toBe("Narra-EN");
    });

    it("is what the name plate reads, from the engine's last line as much as from the prompt", () => {
        expect(callbacks("en", { lastSpeaker: "葵" }).onGetNametag()).toBe("Aoi");
        // The prompt's copy is translated where it is captured; it is read as it stands.
        expect(callbacks("en", { lastSpeaker: undefined, prompt: "Aoi" }).onGetNametag()).toBe("Aoi");
        expect(callbacks("en", { lastSpeaker: undefined, prompt: null }).onGetNametag()).toBeNull();
    });

    it("is what a backlog row hands out, and narration stays without a speaker", () => {
        const rows = callbacks("en", {
            history: [sayEntry("t1", "葵", "It has two."), sayEntry("t2", null, "The bell rang.")],
        }).onGetHistory() as BlueprintGameHistoryEntry[];
        expect(rows.map(row => row.character)).toEqual(["Aoi", null]);
    });
});
