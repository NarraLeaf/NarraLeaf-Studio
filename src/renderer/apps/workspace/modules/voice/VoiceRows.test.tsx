// @vitest-environment jsdom
/**
 * A voice table row's way back to its line. The story row has long opened the voice table at the
 * line; the table had no way back, so a director who heard a wrong take had to find the line by hand.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceRow } from "./VoiceRows";

vi.mock("@/apps/workspace/components/ui/freezeGuard", async () => {
    const actual = await vi.importActual<typeof import("@/apps/workspace/components/ui/freezeGuard")>(
        "@/apps/workspace/components/ui/freezeGuard",
    );
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(false, "") };
});

afterEach(cleanup);

const STRINGS = {
    assign: "assign", replace: "replace", remove: "remove", play: "play", stop: "stop", approve: "approve",
    reject: "reject", clipMissing: "clipMissing", outdatedHint: "outdatedHint", dropHint: "dropHint",
    statusVoiced: "statusVoiced", statusApproved: "statusApproved", statusOutdated: "statusOutdated",
    notePlaceholder: "notePlaceholder", showInStory: "showInStory",
};

function row(onShowInStory?: () => void, state: "missing" | "linked" = "missing") {
    return render(
        <VoiceRow
            row={{ unitId: "u1", sourceText: "那就一起走吧。", sceneId: "s1", sceneName: "放学后", role: "dialogue" }}
            locale="zh"
            speaker="Narra"
            state={state}
            asset={null}
            duration=""
            note=""
            mode="assign"
            matcher={null}
            matchActive={false}
            isPlaying={false}
            strings={STRINGS}
            onTogglePlay={() => undefined}
            onAssign={() => undefined}
            onRemove={() => undefined}
            onApprove={() => undefined}
            onReturn={() => undefined}
            onDropAsset={() => undefined}
            onNoteChange={() => undefined}
            {...(onShowInStory ? { onShowInStory } : {})}
        />,
    );
}

describe("a voice table row", () => {
    it.each(["missing", "linked"] as const)("opens its line in the story, %s take or not", state => {
        const show = vi.fn();
        row(show, state);
        fireEvent.click(screen.getByRole("button", { name: "showInStory" }));
        expect(show).toHaveBeenCalledTimes(1);
    });

    it("offers no such button where the line has nothing to open", () => {
        row();
        expect(screen.queryByRole("button", { name: "showInStory" })).toBeNull();
    });
});
