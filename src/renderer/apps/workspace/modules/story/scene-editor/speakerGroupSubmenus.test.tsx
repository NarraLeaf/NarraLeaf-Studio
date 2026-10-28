// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterProfile } from "@/lib/workspace/services/character/CharacterProfile";
import { EMPTY_STORY_COMMAND_CONTEXT } from "./storyCommandResolution";
import { CharacterSelectTrigger, InsertRow } from "./StorySceneEditorRows";

/**
 * The speaker picker's cast groups as submenus: one entry per group in the list, its members in a
 * column beside it.
 *
 * Rendered through the nametag rather than called as a function: the keys, the list and the column
 * are one piece of state, and only a render shows that the arrows reach a group, that → and ← cross
 * between the list and the column, and that Enter in the column chooses.
 */

let submenus = true;

vi.mock("./StoryCommandLineView", async importOriginal => ({
    ...await importOriginal<typeof import("./StoryCommandLineView")>(),
    useStoryCommandLineContext: () => ({
        characterGroupNames: new Map([["g-extras", "Extras"]]),
        groupSubmenus: submenus,
    }),
}));

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: null, isInitialized: false }),
    useOptionalWorkspace: () => null,
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        app: {
            state: {
                getGlobalState: async () => ({ success: true, data: { value: undefined } }),
                setGlobalState: async () => ({ success: true, data: undefined }),
                onGlobalStateChanged: () => ({ cancel: () => {} }),
            },
        },
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
    submenus = true;
});

afterEach(cleanup);

function openPicker() {
    const onChoose = vi.fn();
    render(
        <CharacterSelectTrigger
            characters={CAST}
            tempSpeakers={[]}
            characterId={undefined}
            speakerName={undefined}
            onChoose={onChoose}
            onCreateCharacter={vi.fn()}
        />,
    );
    fireEvent.click(screen.getByRole("button"));
    return { onChoose };
}

const field = () => screen.getByRole("textbox");
const press = (key: string) => fireEvent.keyDown(field(), { key });
/** Keys drawn in the list, groups included. */
const listed = () => [...document.body.querySelectorAll(".max-h-72.w-\\[320px\\] [data-character-id]")].map(node => node.getAttribute("data-character-id"));
/** Keys drawn in the group column, or null when no column is open. */
const column = () => {
    const panel = document.body.querySelector("[role=listbox]");
    return panel ? [...panel.querySelectorAll("[data-character-id]")].map(node => node.getAttribute("data-character-id")) : null;
};
const highlighted = () => [...document.body.querySelectorAll("[data-character-id].bg-primary\\/15")].map(node => node.getAttribute("data-character-id"));

describe("the speaker picker's cast groups as submenus", () => {
    it("list each group as one entry, with no column until it is reached", () => {
        openPicker();

        expect(listed()).toEqual(["lead", "group:g-extras"]);
        expect(column()).toBeNull();
        expect(highlighted()).toEqual(["lead"]);
    });

    it("show a group's members beside the list when the arrows reach it", () => {
        openPicker();
        press("ArrowDown");

        expect(highlighted()).toEqual(["group:g-extras"]);
        expect(column()).toEqual(["clerk", "guard"]);
    });

    it("cross into the column with →, walk it, come back with ←", () => {
        openPicker();
        press("ArrowDown");
        press("ArrowRight");
        expect(highlighted()).toEqual(["clerk"]);

        press("ArrowDown");
        expect(highlighted()).toEqual(["guard"]);

        press("ArrowLeft");
        expect(highlighted()).toEqual(["group:g-extras"]);
        expect(column()).toEqual(["clerk", "guard"]);
    });

    it("take Enter on a group as entering it, and Enter in the column as the choice", () => {
        const { onChoose } = openPicker();
        press("ArrowDown");
        press("Enter");
        expect(onChoose).not.toHaveBeenCalled();
        expect(highlighted()).toEqual(["clerk"]);

        press("Enter");
        expect(onChoose).toHaveBeenCalledWith({ characterId: "clerk" });
    });

    it("open the column on a click on the group", () => {
        openPicker();
        fireEvent.mouseDown(document.body.querySelector("[data-character-id=\"group:g-extras\"]")!);

        expect(highlighted()).toEqual(["clerk"]);
    });

    it("list every match under its group's name once a name is typed", () => {
        openPicker();
        fireEvent.change(field(), { target: { value: "gua" } });

        // The typed name itself trails as a bare speaker, as it always has.
        expect(listed()).toEqual(["guard", "name:gua"]);
        expect(column()).toBeNull();
    });

    it("list members under their group's name when the preference is off", () => {
        submenus = false;
        openPicker();

        expect(listed()).toEqual(["lead", "clerk", "guard"]);
        expect(column()).toBeNull();
    });
});

describe("the same submenus in the # slot", () => {
    it("walk to a group, cross into it with →, and choose with Enter", () => {
        const onChooseCharacter = vi.fn();
        const noop = () => {};
        const view = render(
            <InsertRow
                mode={{ kind: "insert", slot: { afterBlockId: "row-1", focusToken: 1 }, initialValue: "#" }}
                characters={CAST}
                tempSpeakers={[]}
                commandContext={EMPTY_STORY_COMMAND_CONTEXT}
                inputRef={createRef<HTMLTextAreaElement>()}
                draftRef={{ current: "#" }}
                onValueChange={noop}
                onCommitNarration={noop}
                onDismissChooser={noop}
                onDiscardSlot={noop}
                onResolveLine={noop}
                onCommitInvalid={noop}
                onChooseCommand={noop}
                onChooseCharacter={onChooseCharacter}
                onChooseTempSpeaker={noop}
                onBackspaceEmpty={noop}
                slashAtAlias
            />,
        );
        const slot = view.container.querySelector("textarea")!;
        expect(listed()).toEqual(["lead", "group:g-extras"]);

        fireEvent.keyDown(slot, { key: "ArrowDown" });
        expect(column()).toEqual(["clerk", "guard"]);
        fireEvent.keyDown(slot, { key: "ArrowRight" });
        fireEvent.keyDown(slot, { key: "ArrowDown" });
        fireEvent.keyDown(slot, { key: "Enter" });

        expect(onChooseCharacter).toHaveBeenCalledWith("guard");
    });
});
