// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterProfile } from "@/lib/workspace/services/character/CharacterProfile";
import type { EditorMode } from "./storySceneEditorTypes";
import { buildStoryCommandContext } from "./storyCommandContext";
import { InsertRow } from "./StorySceneEditorRows";

/**
 * A slot that writes only certain commands - a character's behaviours, in the character's properties.
 * It is the story editor's own slot, so without the scope it brought the whole editor with it: a `#`
 * that opened the speaker picker for a line that can never be dialogue, and a menu of every command
 * in the project, most of which a behaviour refuses on Enter.
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

function renderSlot(initialValue: string, commandScope?: { commandIds: ReadonlySet<string> }) {
    const noop = () => {};
    const mode: Extract<EditorMode, { kind: "insert" }> = { kind: "insert", slot: { afterBlockId: null, focusToken: 1 }, initialValue };
    return render(
        <InsertRow
            mode={mode}
            characters={[ALICE]}
            tempSpeakers={[]}
            commandContext={context}
            inputRef={createRef<HTMLTextAreaElement>()}
            draftRef={{ current: initialValue }}
            onValueChange={noop}
            onCommitNarration={noop}
            onDismissChooser={noop}
            onDiscardSlot={noop}
            onResolveLine={noop}
            onCommitInvalid={noop}
            onChooseCommand={noop}
            onChooseCharacter={noop}
            onChooseTempSpeaker={noop}
            onBackspaceEmpty={noop}
            slashAtAlias={false}
            {...(commandScope ? { commandScope } : {})}
        />,
    );
}

const SCOPE = { commandIds: new Set(["transform", "front"]) };

describe("a command-only slot", () => {
    it("opens no speaker picker on #", () => {
        expect(renderSlot("#").baseElement.textContent).toContain("Alice Hartley");
        cleanup();
        expect(renderSlot("#", SCOPE).baseElement.textContent).not.toContain("Alice Hartley");
    });

    it("offers only the commands in its scope", () => {
        const open = renderSlot("/").baseElement.textContent ?? "";
        expect(open).toContain("Jump");
        cleanup();
        const scoped = renderSlot("/", SCOPE).baseElement.textContent ?? "";
        expect(scoped).toContain("Transform");
        expect(scoped).not.toContain("Jump");
    });
});
