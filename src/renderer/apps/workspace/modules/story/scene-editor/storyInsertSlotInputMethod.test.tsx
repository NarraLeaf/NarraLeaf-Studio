// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorMode } from "./storySceneEditorTypes";
import { EMPTY_STORY_COMMAND_CONTEXT } from "./storyCommandResolution";
import { InsertRow } from "./StorySceneEditorRows";

/**
 * A Japanese input method that is switched on types "・" for the "/" key and "＃" for "#", so an
 * author writing in Japanese could not open the action creator or the speaker menu without switching
 * the input method off first. The slot now reads those characters as the trigger - but only when the
 * author confirms one on an empty line (or with a whole command word or speaker name behind it), so a
 * line of prose that opens with "・" stays prose, and Escape gives the character back.
 *
 * The events are the ones Chromium sends for a conversion: `compositionstart`, an `input` for each
 * candidate with `isComposing` set, then `compositionend` once the author presses Enter.
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

const slot = { afterBlockId: "row-1", focusToken: 1 };

function renderSlot(mode: InsertMode = { kind: "insert", slot, initialValue: "" }) {
    const draftRef = { current: mode.initialValue };
    const onDiscardSlot = vi.fn<(lineBack?: string) => void>();
    const onDismissChooser = vi.fn();
    const noop = () => {};
    const view = render(
        <InsertRow
            mode={mode}
            characters={[]}
            tempSpeakers={[{ name: "アリス", blockIds: [] }]}
            commandContext={EMPTY_STORY_COMMAND_CONTEXT}
            inputRef={createRef<HTMLTextAreaElement>()}
            draftRef={draftRef}
            onValueChange={value => { draftRef.current = value; }}
            onCommitNarration={noop}
            onDismissChooser={onDismissChooser}
            onDiscardSlot={onDiscardSlot}
            onResolveLine={noop}
            onCommitInvalid={noop}
            onChooseCommand={noop}
            onChooseCharacter={noop}
            onChooseTempSpeaker={noop}
            onBackspaceEmpty={noop}
            slashAtAlias={false}
        />,
    );
    const field = () => view.container.querySelector("textarea")!;
    return { field, draftRef, onDiscardSlot, onDismissChooser };
}

/** One conversion, confirmed: each candidate arrives composing, then the composition ends. */
function convert(field: HTMLTextAreaElement, ...candidates: string[]) {
    fireEvent.compositionStart(field);
    for (const candidate of candidates) {
        fireEvent.input(field, { target: { value: candidate }, isComposing: true });
    }
    fireEvent.compositionEnd(field);
}

describe("an input method's trigger in the insert slot", () => {
    it("reads a confirmed 「・」 on an empty line as the action trigger", () => {
        const { field, draftRef } = renderSlot();
        convert(field(), "・");
        expect(field().value).toBe("/");
        expect(draftRef.current).toBe("/");
    });

    it("reads 「＃」 as the speaker trigger", () => {
        const { field } = renderSlot();
        convert(field(), "＃");
        expect(field().value).toBe("#");
    });

    it("decides nothing while the conversion is still open", () => {
        const { field } = renderSlot();
        fireEvent.compositionStart(field());
        fireEvent.input(field(), { target: { value: "・" }, isComposing: true });
        expect(field().value).toBe("・");
    });

    it("reads a command word or speaker name typed in the same conversion", () => {
        const { field } = renderSlot();
        convert(field(), "・b", "・bg");
        expect(field().value).toBe("/bg");
        cleanup();
        const speaker = renderSlot();
        convert(speaker.field(), "＃あ", "＃アリス");
        expect(speaker.field().value).toBe("#アリス");
    });

    it("leaves a line of prose that opens with one of those characters alone", () => {
        const { field } = renderSlot();
        convert(field(), "・", "・・", "・・・");
        expect(field().value).toBe("・・・");
        cleanup();
        const prose = renderSlot();
        convert(prose.field(), "・り", "・りんご");
        expect(prose.field().value).toBe("・りんご");
    });

    it("reads it only on an empty line", () => {
        const { field } = renderSlot();
        fireEvent.change(field(), { target: { value: "あ" } });
        convert(field(), "あ・");
        expect(field().value).toBe("あ・");
    });

    it("reads one an input method puts down without a conversion", () => {
        const { field } = renderSlot();
        fireEvent.change(field(), { target: { value: "／" } });
        expect(field().value).toBe("/");
    });

    it("gives the character back on Escape, and then keeps it as text", () => {
        const { field, draftRef, onDismissChooser, onDiscardSlot } = renderSlot();
        convert(field(), "・");
        act(() => {
            fireEvent.keyDown(field(), { key: "Escape" });
        });
        expect(field().value).toBe("・");
        expect(draftRef.current).toBe("・");
        expect(onDismissChooser).not.toHaveBeenCalled();
        expect(onDiscardSlot).not.toHaveBeenCalled();
        // The line is no longer empty, so the next "・" is text too.
        convert(field(), "・・");
        expect(field().value).toBe("・・");
    });

    it("leaves Escape to the menu once the line has moved on from the trigger", () => {
        const { field, onDismissChooser } = renderSlot();
        convert(field(), "・");
        fireEvent.change(field(), { target: { value: "/b" } });
        fireEvent.change(field(), { target: { value: "/" } });
        act(() => {
            fireEvent.keyDown(field(), { key: "Escape" });
        });
        expect(field().value).toBe("/");
        expect(onDismissChooser).toHaveBeenCalledTimes(1);
    });

    it("hands the character back to the speaker's line a scoped slot stands on", () => {
        const { field, onDiscardSlot } = renderSlot({
            kind: "insert",
            slot: { ...slot, replaceBlockId: "row-2", characterScope: { characterId: "c1", name: "アリス" } },
            initialValue: "/",
            inputMethodLine: "・",
        });
        expect(field().value).toBe("/");
        act(() => {
            fireEvent.keyDown(field(), { key: "Escape" });
        });
        expect(onDiscardSlot).toHaveBeenCalledWith("・");
    });
});
