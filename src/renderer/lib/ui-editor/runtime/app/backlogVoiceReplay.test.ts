/**
 * Whether a backlog row says it can be heard again.
 *
 * A list row decides whether one of its elements is drawn from a boolean field of the row, so a
 * backlog's replay button shows itself by `hasVoice`. It is true exactly when Play Voice would play
 * the row's take now: the line carries a voice unit id and the dub language in force has a take for
 * it. A line voiced only in another language, a line with no take, a resolved choice and a host that
 * cannot play a take all say no - a button there would press to silence.
 */

import { describe, expect, it } from "vitest";
import type { LiveGame } from "narraleaf-react";
import type { BlueprintGameHistoryEntry } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { createChoiceMenus } from "./choiceMenus";
import { createDialogClickTargets } from "./dialogClickTargets";
import { createLiveGameUiCallbacks } from "./gameUiSlots";

function sayEntry(token: string, voiceId: string | null): unknown {
    return { token, element: { type: "say", text: token, voice: voiceId ? `url-${voiceId}` : null, voiceId, character: "Narra" } };
}

const menuEntry = { token: "menu", element: { type: "menu", text: "Pick one", selected: "Left" } };

function rowsOf(history: unknown[], future: unknown[], canReplayVoice?: (unitId: string) => boolean) {
    const liveGame = { getHistory: () => history, getFuture: () => future } as unknown as LiveGame;
    const callbacks = createLiveGameUiCallbacks({
        requireLiveGame: () => liveGame,
        getLiveGame: () => liveGame,
        choiceMenus: createChoiceMenus(),
        currentDialogNametagRef: { current: null },
        dialogClickTargets: createDialogClickTargets(),
        ...(canReplayVoice ? { canReplayVoice } : {}),
    });
    return {
        history: callbacks.onGetHistory() as BlueprintGameHistoryEntry[],
        future: callbacks.onGetFuture() as BlueprintGameHistoryEntry[],
    };
}

describe("a backlog row's hasVoice", () => {
    const takes = new Set(["unit-a"]);
    const canReplayVoice = (unitId: string) => takes.has(unitId);

    it("is true only for a line whose take plays in the dub language in force", () => {
        const { history } = rowsOf(
            [sayEntry("voiced", "unit-a"), sayEntry("other-language", "unit-b"), sayEntry("silent", null), menuEntry],
            [],
            canReplayVoice,
        );
        expect(history.map(row => [row.id, row.voiceId, row.hasVoice])).toEqual([
            ["voiced", "unit-a", true],
            ["other-language", "unit-b", false],
            ["silent", null, false],
            ["menu", null, false],
        ]);
    });

    it("answers the same for the lines ahead of the play head", () => {
        const { future } = rowsOf([], [sayEntry("ahead", "unit-a")], canReplayVoice);
        expect(future.map(row => row.hasVoice)).toEqual([true]);
    });

    it("is false everywhere on a host that cannot play a take", () => {
        const { history } = rowsOf([sayEntry("voiced", "unit-a")], []);
        expect(history.map(row => [row.voiceId, row.hasVoice])).toEqual([["unit-a", false]]);
    });
});
