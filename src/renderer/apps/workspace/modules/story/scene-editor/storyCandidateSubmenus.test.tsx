// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCandidateTree, type StoryCandidateItem } from "./StoryCommandCandidateMenu";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterProfile } from "@/lib/workspace/services/character/CharacterProfile";
import { EMPTY_STORY_COMMAND_CONTEXT } from "./storyCommandResolution";
import type { StoryCommandContext } from "./storyCommandValues";
import { InsertRow } from "./StorySceneEditorRows";

/**
 * The argument menu's folders as submenus: an asset library filed the way the asset browser files
 * it, each folder one line whose contents open in a column beside it, as deep as the folders go.
 */

let submenus = true;

vi.mock("./StoryCommandLineView", async importOriginal => ({
    ...await importOriginal<typeof import("./StoryCommandLineView")>(),
    useStoryCommandLineContext: () => ({ trigger: "/", groupSubmenus: submenus, characterGroupNames: new Map([["g-extras", "Extras"]]) }),
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

// Thumbnails read workspace services no test has; nothing here depends on them.
vi.mock("./storyCandidateMark", () => ({
    StoryCandidateMarkView: () => null,
    StoryCandidateSpeakerMark: () => null,
}));

const OUTDOOR = { id: "f-out", name: "Outdoor" };
const INDOOR = { id: "f-in", name: "Indoor" };
const BEDROOMS = { id: "f-bed", name: "Bedrooms" };

const CONTEXT: StoryCommandContext = {
    ...EMPTY_STORY_COMMAND_CONTEXT,
    images: [
        { id: "black", name: "black" },
        { id: "forest", name: "forest", folders: [OUTDOOR] },
        { id: "hall", name: "hall", folders: [INDOOR] },
        { id: "attic", name: "attic", folders: [INDOOR, BEDROOMS] },
    ],
    characters: [{ id: "lead", name: "Lead" }, { id: "clerk", name: "Clerk" }],
};

function character(id: string, name: string, groupId?: string): Character {
    const profile = CharacterProfile.create(id, name);
    profile.setGroupId(groupId);
    return Character.fromJSON({ profile: profile.toJSON() });
}

const CAST = [character("lead", "Lead"), character("clerk", "Clerk", "g-extras")];

beforeEach(() => {
    submenus = true;
});

afterEach(cleanup);

function renderSlot(line: string) {
    const onValueChange = vi.fn<(value: string) => void>();
    const noop = () => {};
    const view = render(
        <InsertRow
            mode={{ kind: "insert", slot: { afterBlockId: "row-1", focusToken: 1 }, initialValue: line }}
            characters={CAST}
            tempSpeakers={[]}
            commandContext={CONTEXT}
            inputRef={createRef<HTMLTextAreaElement>()}
            draftRef={{ current: line }}
            onValueChange={onValueChange}
            onCommitNarration={noop}
            onDismissChooser={noop}
            onDiscardSlot={noop}
            onResolveLine={noop}
            onCommitInvalid={noop}
            onChooseCommand={noop}
            onChooseCharacter={noop}
            onChooseTempSpeaker={noop}
            onBackspaceEmpty={noop}
            slashAtAlias
        />,
    );
    const slot = view.container.querySelector("textarea")!;
    const press = (key: string) => fireEvent.keyDown(slot, { key });
    return { slot, press, onValueChange };
}

/** Each open column's lines, root first, by what they read. */
const columns = () => [...document.body.querySelectorAll("[role=listbox]")]
    .map(column => [...column.querySelectorAll("[data-candidate-key]")].map(line => line.querySelector(".text-sm")?.textContent));
const highlighted = () => document.body.querySelector("[data-candidate-key].bg-primary\\/15 .text-sm")?.textContent;

describe("folders in the candidate tree", () => {
    const item = (key: string, ...folders: { id: string; name: string }[]): StoryCandidateItem => ({ key, value: key, label: key, folders });

    it("lists folders first, then what is filed directly there, and counts everything inside", () => {
        const tree = buildCandidateTree([item("black"), item("attic", INDOOR, BEDROOMS), item("hall", INDOOR)], true);

        expect(tree.map(node => node.kind === "folder" ? `[${node.folder.name} ${node.count}]` : node.key)).toEqual(["[Indoor 2]", "black"]);
        const indoor = tree[0].kind === "folder" ? tree[0].children : [];
        expect(indoor.map(node => node.kind === "folder" ? `[${node.folder.name} ${node.count}]` : node.key)).toEqual(["[Bedrooms 1]", "hall"]);
    });

    it("stays one flat list with submenus off", () => {
        expect(buildCandidateTree([item("attic", INDOOR)], false).map(node => node.kind)).toEqual(["item"]);
    });
});

describe("the argument menu's folders as submenus", () => {
    it("lists the library's top level, folders first", () => {
        renderSlot("/bg ");

        expect(columns()).toEqual([["Outdoor", "Indoor", "black"]]);
    });

    it("opens a folder's column as the arrows reach it, and goes in and out with → and ←", () => {
        const { press } = renderSlot("/bg ");
        press("ArrowDown");
        press("ArrowDown");
        expect(highlighted()).toBe("Indoor");
        expect(columns()).toEqual([["Outdoor", "Indoor", "black"], ["Bedrooms", "hall"]]);

        press("ArrowRight");
        expect(highlighted()).toBe("Bedrooms");
        expect(columns()).toEqual([["Outdoor", "Indoor", "black"], ["Bedrooms", "hall"], ["attic"]]);

        press("ArrowLeft");
        expect(highlighted()).toBe("Indoor");
    });

    it("takes Enter on a folder as going in, and Enter on a file as the choice", () => {
        const { press, onValueChange } = renderSlot("/bg ");
        press("ArrowDown");
        press("Enter");
        expect(highlighted()).toBe("forest");

        press("Enter");
        expect(onValueChange).toHaveBeenLastCalledWith(expect.stringContaining("forest"));
    });

    it("lists the matches with where they are filed once a name is typed", () => {
        renderSlot("/bg at");

        expect(columns()).toEqual([["attic"]]);
        expect(document.body.querySelector("[data-candidate-key]")?.textContent).toContain("Indoor / Bedrooms");
    });

    it("lists everything in one column with the preference off", () => {
        submenus = false;
        renderSlot("/bg ");

        expect(columns()).toEqual([["black", "forest", "hall", "attic"]]);
    });

    it("files a character argument under its cast group", () => {
        const { press } = renderSlot("/show ");
        const root = columns()[0];
        expect(root).toContain("Extras");
        expect(root).toContain("Lead");
        expect(root).not.toContain("Clerk");

        while (highlighted() !== "Extras") {
            press("ArrowDown");
        }
        expect(columns()[1]).toEqual(["Clerk"]);
    });
});
