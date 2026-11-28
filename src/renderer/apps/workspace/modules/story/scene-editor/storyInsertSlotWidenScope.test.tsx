// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterProfile } from "@/lib/workspace/services/character/CharacterProfile";
import type { EditorMode } from "./storySceneEditorTypes";
import { buildStoryCommandContext } from "./storyCommandContext";
import { InsertRow } from "./StorySceneEditorRows";

/**
 * The slot `@` opens on a speaker's empty line offers only what can be done to that speaker. Two ways
 * out of that narrowing: `@@` asks for every command, and a verb typed that the speaker's list does
 * not have (`@jump`) is shown from the whole vocabulary rather than as an empty menu - the line
 * commits it either way.
 */

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

afterEach(cleanup);

const ALICE = Character.fromJSON({ profile: CharacterProfile.create("char-alice", "Alice Hartley").toJSON() });
const context = buildStoryCommandContext({ assets: undefined, characters: [ALICE], document: null, sceneId: null, scene: null });

function renderScopedSlot(initialValue: string, slashAtAlias = true) {
    const noop = () => {};
    const draftRef = { current: initialValue };
    const mode: Extract<EditorMode, { kind: "insert" }> = {
        kind: "insert",
        slot: {
            afterBlockId: "row-1",
            focusToken: 1,
            replaceBlockId: "row-2",
            characterScope: { characterId: "char-alice", name: "Alice Hartley" },
        },
        initialValue,
    };
    const view = render(
        <InsertRow
            mode={mode}
            characters={[ALICE]}
            tempSpeakers={[]}
            commandContext={context}
            inputRef={createRef<HTMLTextAreaElement>()}
            draftRef={draftRef}
            onValueChange={value => { draftRef.current = value; }}
            onCommitNarration={noop}
            onDismissChooser={noop}
            onDiscardSlot={noop}
            onResolveLine={noop}
            onCommitInvalid={noop}
            onChooseCommand={noop}
            onChooseCharacter={noop}
            onChooseTempSpeaker={noop}
            onBackspaceEmpty={noop}
            slashAtAlias={slashAtAlias}
        />,
    );
    const field = () => view.container.querySelector("textarea")!;
    const text = () => view.baseElement.textContent ?? "";
    return { field, text, draftRef };
}

describe("a speaker's action slot", () => {
    it("offers only the speaker's verbs on a single @", () => {
        expect(renderScopedSlot("@").text()).not.toContain("Jump");
    });

    it("offers every command once the trigger is doubled, keeping one @ on the line", () => {
        const slot = renderScopedSlot("@");
        fireEvent.change(slot.field(), { target: { value: "@@" } });
        expect(slot.field().value).toBe("@");
        expect(slot.draftRef.current).toBe("@");
        expect(slot.text()).toContain("Jump");
    });

    it("narrows again once the line is emptied", () => {
        const slot = renderScopedSlot("@");
        fireEvent.change(slot.field(), { target: { value: "@@" } });
        fireEvent.change(slot.field(), { target: { value: "" } });
        fireEvent.change(slot.field(), { target: { value: "@" } });
        expect(slot.text()).not.toContain("Jump");
    });

    it("leaves // alone where / is the trigger, since that is the note command", () => {
        const slot = renderScopedSlot("/", false);
        fireEvent.change(slot.field(), { target: { value: "//" } });
        expect(slot.field().value).toBe("//");
    });

    it("shows a verb the speaker's list lacks from the whole vocabulary", () => {
        expect(renderScopedSlot("@jump").text()).toContain("Jump");
    });
});
