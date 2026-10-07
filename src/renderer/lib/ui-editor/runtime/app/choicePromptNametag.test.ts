/**
 * A choice menu's prompt on the name plate: said by nobody.
 *
 * The engine shows a menu's prompt in the dialogue box as narration, but records no line for it - its
 * last-dialog record, and the speaker in it, still belong to the line before the menu. The name plate
 * read that record, so a prompt after a character's line wore that character's name. What is pinned
 * here is that `Get Nametag` answers "no one" while the play head is on a menu, and the speaker again
 * once the story says its next line.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import type { LiveGame } from "narraleaf-react";
import type { BlueprintGameHistoryEntry } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { createChoiceMenus } from "./choiceMenus";
import { createDialogClickTargets } from "./dialogClickTargets";
import { createLiveGameUiCallbacks } from "./gameUiSlots";

function sayEntry(token: string, character: string | null, text: string): unknown {
    return { token, element: { type: "say", text, voice: null, voiceId: null, character } };
}

function menuEntry(token: string, prompt: string | null, selected: string | null = null): unknown {
    return { token, element: { type: "menu", text: prompt, selected }, isPending: selected === null };
}

function callbacks(options: { history: unknown[]; lastSpeaker: string | null; prompt?: string | null; throws?: boolean }) {
    const liveGame = {
        getHistory: () => {
            if (options.throws) {
                throw new Error("Game state not initialized");
            }
            return options.history;
        },
        getFuture: () => [],
        lastDialog: { speaker: options.lastSpeaker },
    } as unknown as LiveGame;
    return createLiveGameUiCallbacks({
        requireLiveGame: () => liveGame,
        getLiveGame: () => liveGame,
        choiceMenus: createChoiceMenus(),
        currentDialogNametagRef: { current: options.prompt ?? options.lastSpeaker },
        dialogClickTargets: createDialogClickTargets(),
    });
}

describe("the name plate over a choice menu's prompt", () => {
    it("names no one while the menu is up, though the line before it was a character's", () => {
        const history = [sayEntry("t1", "Narra", "你想好了吗？"), menuEntry("t2", "我们做什么？")];
        expect(callbacks({ history, lastSpeaker: "Narra" }).onGetNametag()).toBeNull();
    });

    it("names no one after the pick until the story says its next line", () => {
        const history = [sayEntry("t1", "Narra", "你想好了吗？"), menuEntry("t2", "我们做什么？", "做点真心的东西。")];
        expect(callbacks({ history, lastSpeaker: "Narra" }).onGetNametag()).toBeNull();
    });

    it("names the speaker again on the line after the menu", () => {
        const history = [
            sayEntry("t1", "Narra", "你想好了吗？"),
            menuEntry("t2", "我们做什么？", "做点真心的东西。"),
            sayEntry("t3", "Aoi", "做点真心的东西。"),
        ];
        expect(callbacks({ history, lastSpeaker: "Aoi" }).onGetNametag()).toBe("Aoi");
    });

    it("reads the speaker as before when no menu is on the play head, or no game state is there to ask", () => {
        expect(callbacks({ history: [sayEntry("t1", "Narra", "你迟到了。")], lastSpeaker: "Narra" }).onGetNametag()).toBe("Narra");
        expect(callbacks({ history: [], lastSpeaker: null, prompt: "Narra" }).onGetNametag()).toBe("Narra");
        expect(callbacks({ history: [], lastSpeaker: "Narra", throws: true }).onGetNametag()).toBe("Narra");
    });

    it("leaves the prompt's backlog row without a speaker", () => {
        const rows = callbacks({
            history: [sayEntry("t1", "Narra", "你想好了吗？"), menuEntry("t2", "我们做什么？")],
            lastSpeaker: "Narra",
        }).onGetHistory() as BlueprintGameHistoryEntry[];
        expect(rows.map(row => [row.type, row.character, row.text])).toEqual([
            ["say", "Narra", "你想好了吗？"],
            ["menu", null, "我们做什么？"],
        ]);
    });
});
