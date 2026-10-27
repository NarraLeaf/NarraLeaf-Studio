// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterProfile } from "@/lib/workspace/services/character/CharacterProfile";
import { CharacterSelectTrigger } from "./StorySceneEditorRows";

/**
 * The speaker picker's cast groups, folded to their headers.
 *
 * Rendered through the nametag rather than called as a function: the folding lives in the hook that
 * feeds both the drawn list and the arrow keys, and only a render shows that a folded member is gone
 * from both, and that a click on the header brings it back.
 */

let collapsedByDefault = true;

vi.mock("./StoryCommandLineView", async importOriginal => ({
    ...await importOriginal<typeof import("./StoryCommandLineView")>(),
    useStoryCommandLineContext: () => ({
        characterGroupNames: new Map([["g-extras", "Extras"]]),
        characterGroupsCollapsed: collapsedByDefault,
    }),
}));

vi.mock("@/apps/workspace/hooks/useWorkspaceFrozen", () => ({
    useWorkspaceFreeze: () => null,
}));

// The avatar reads workspace services no test has; nothing here depends on it.
vi.mock("./storyCandidateMark", () => ({
    StoryCandidateSpeakerMark: () => null,
}));

function character(id: string, name: string, groupId?: string): Character {
    const profile = CharacterProfile.create(id, name);
    profile.setGroupId(groupId);
    return Character.fromJSON({ profile: profile.toJSON() });
}

const CAST = [character("lead", "Lead"), character("clerk", "Clerk", "g-extras"), character("guard", "Guard", "g-extras")];

beforeEach(() => {
    collapsedByDefault = true;
});

afterEach(cleanup);

function renderNametag() {
    render(
        <CharacterSelectTrigger
            characters={CAST}
            tempSpeakers={[]}
            characterId={undefined}
            speakerName={undefined}
            onChoose={vi.fn()}
            onCreateCharacter={vi.fn()}
        />,
    );
}

const shown = () => [...document.body.querySelectorAll("[data-character-id]")].map(node => node.getAttribute("data-character-id"));
const header = () => document.body.querySelector<HTMLButtonElement>("button[aria-expanded]")!;

describe("the speaker picker's cast groups", () => {
    it("open folded, with the header naming the group and its size", () => {
        renderNametag();
        fireEvent.click(screen.getByRole("button"));

        expect(shown()).toEqual(["lead"]);
        expect(header().getAttribute("aria-expanded")).toBe("false");
        expect(header().textContent).toContain("Extras");
        expect(header().textContent).toContain("2");
    });

    it("unfold on a header click, and fold again on the next", () => {
        renderNametag();
        fireEvent.click(screen.getByRole("button"));

        fireEvent.mouseDown(header());
        expect(shown()).toEqual(["lead", "clerk", "guard"]);
        fireEvent.mouseDown(header());
        expect(shown()).toEqual(["lead"]);
    });

    it("unfold for a typed name, so a search reaches a folded member", () => {
        renderNametag();
        fireEvent.click(screen.getByRole("button"));

        fireEvent.change(screen.getByRole("textbox"), { target: { value: "gua" } });
        expect(shown()).toContain("guard");
    });

    it("open unfolded when the preference says so", () => {
        collapsedByDefault = false;
        renderNametag();
        fireEvent.click(screen.getByRole("button"));

        expect(shown()).toEqual(["lead", "clerk", "guard"]);
    });
});
