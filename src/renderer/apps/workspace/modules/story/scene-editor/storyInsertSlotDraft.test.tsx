// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorMode } from "./storySceneEditorTypes";
import { EMPTY_STORY_COMMAND_CONTEXT } from "./storyCommandResolution";
import { InsertRow } from "./StorySceneEditorRows";

/**
 * The open slot's line lives in the slot, and the slot lives inside the windowed row list. A hidden
 * tab measures 0 px and renders no rows, so switching to another tab unmounted the slot while it was
 * still open: coming back, the field was empty - and Enter committed the line it no longer showed,
 * because the controller still held it.
 *
 * Remounting now starts from the controller's copy, so what the field shows is what Enter commits.
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

type InsertMode = Extract<EditorMode, { kind: "insert" }>;

function renderSlot(mode: InsertMode, draft: string) {
    const draftRef = { current: draft };
    const noop = () => {};
    const view = render(
        <InsertRow
            mode={mode}
            characters={[]}
            tempSpeakers={[]}
            commandContext={EMPTY_STORY_COMMAND_CONTEXT}
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
            slashAtAlias
        />,
    );
    const field = () => view.container.querySelector("textarea")!;
    return { ...view, field, draftRef };
}

describe("an open slot that is unmounted and mounted again", () => {
    // The slot a tab comes back to: the menu was dismissed when the tab went hidden.
    const slot = { afterBlockId: "row-1", focusToken: 1 };
    const returning: InsertMode = { kind: "insert", slot, initialValue: "", chooserDismissed: true };

    it("shows the line the controller still holds, not the empty line it opened with", () => {
        const { field } = renderSlot(returning, "@显示 ");
        expect(field().value).toBe("@显示 ");
    });

    it("opens a new slot with its own seed, which is also the controller's copy", () => {
        const { field } = renderSlot({ kind: "insert", slot, initialValue: "" }, "");
        expect(field().value).toBe("");
        cleanup();
        const seeded = renderSlot({ kind: "insert", slot, initialValue: "/jump scene" }, "/jump scene");
        expect(seeded.field().value).toBe("/jump scene");
    });

    it("re-seeds when a different slot replaces it", () => {
        const view = renderSlot(returning, "@显示 ");
        view.draftRef.current = "";
        view.rerender(
            <InsertRow
                mode={{ kind: "insert", slot: { afterBlockId: "row-2", focusToken: 2 }, initialValue: "" }}
                characters={[]}
                tempSpeakers={[]}
                commandContext={EMPTY_STORY_COMMAND_CONTEXT}
                inputRef={createRef<HTMLTextAreaElement>()}
                draftRef={view.draftRef}
                onValueChange={() => {}}
                onCommitNarration={() => {}}
                onDismissChooser={() => {}}
                onDiscardSlot={() => {}}
                onResolveLine={() => {}}
                onCommitInvalid={() => {}}
                onChooseCommand={() => {}}
                onChooseCharacter={() => {}}
                onChooseTempSpeaker={() => {}}
                onBackspaceEmpty={() => {}}
                slashAtAlias
            />,
        );
        expect(view.field().value).toBe("");
    });
});
