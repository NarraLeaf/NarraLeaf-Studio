// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import React, { type ClipboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import type { StoryScene } from "@shared/types/story";
import { STORY_PASTE_CONFIRM_THRESHOLD } from "@/lib/story/paste/storyPasteTypes";
import { useStorySceneClipboardHandlers } from "./useStorySceneClipboardHandlers";
import type { EditorMode } from "./storySceneEditorTypes";

/**
 * The paste router, driven the way a paste actually arrives: one clipboard event, one editor mode.
 *
 * Both cases here are about what happens AROUND the rows - a popover left open underneath the wizard,
 * and a freeze that lands while a confirm dialog is up - which is precisely the part no model test can
 * see, because neither of them is about the pasted text at all.
 */

const SCENE = { id: "scene-1", blocks: {}, rootBlockIds: [] } as unknown as StoryScene;

function uuidFactory(): { generate: () => string } {
    let issued = 0;
    return { generate: () => `00000000-0000-4000-8000-${(issued += 1).toString(16).padStart(12, "0")}` };
}

function pasteEvent(text: string, target?: EventTarget): ClipboardEvent<HTMLDivElement> {
    return {
        target: target ?? document.body,
        preventDefault: () => undefined,
        nativeEvent: { shiftKey: false },
        clipboardData: { getData: (mime: string) => (mime === "text/plain" ? text : "") },
    } as unknown as ClipboardEvent<HTMLDivElement>;
}

function setup(options: { editorMode?: EditorMode; showConfirm?: () => Promise<boolean> } = {}) {
    const storyService = { insertBlock: vi.fn() };
    const frozen = { value: false };
    const spies = {
        dismissInsertChooser: vi.fn(),
        requestPasteWizard: vi.fn(),
        suspendInsertSlotCommit: vi.fn(),
        resumeInsertSlotCommit: vi.fn(),
        recordHistory: vi.fn(() => true),
    };
    const plainPasteRequestedRef = { current: false };
    const params = {
        storyService: storyService as never,
        uuidService: uuidFactory() as never,
        uiService: { showConfirm: options.showConfirm ?? (() => Promise.resolve(true)) } as never,
        storyId: "story-1",
        sceneId: "scene-1",
        scene: SCENE,
        scenes: undefined,
        characters: [],
        selectedBlockIds: new Set<string>(),
        activeBlockId: null,
        visibleRows: [],
        editorMode: options.editorMode ?? ({ kind: "idle" } as EditorMode),
        insertInputRef: { current: null },
        plainPasteRequestedRef,
        setActiveBlockId: vi.fn(),
        setSelectedBlockIds: vi.fn(),
        setEditorMode: vi.fn(),
        isFrozen: () => frozen.value,
        ...spies,
    };
    const { result } = renderHook(() => useStorySceneClipboardHandlers(params));
    return { result, storyService, frozen, plainPasteRequestedRef, ...spies };
}

/** An insert slot with a line in it, which is what has a candidate popover open over the editor. */
const INSERT_MODE: EditorMode = {
    kind: "insert",
    slot: { afterBlockId: null } as never,
    initialValue: "/bg for",
};

describe("paste routing and the insert slot", () => {
    /**
     * The slot's candidate menu is portalled, so it sits outside the modal's stacking context and drew
     * *over* the wizard - a "No matches." popover covering the first mapping row. It has to be closed
     * by the thing that opens the wizard, because the slot itself never learns the wizard exists (the
     * wizard takes focus, so no keystroke ever reaches the slot to clear the menu the usual way).
     */
    it("closes the slot's candidate menu when a paste opens the wizard", () => {
        const handlers = setup({ editorMode: INSERT_MODE });

        handlers.result.current.handlePaste(pasteEvent("林：走吧。\n早苗：等一下。\n外面还在下雨。"));

        expect(handlers.requestPasteWizard).toHaveBeenCalledTimes(1);
        expect(handlers.dismissInsertChooser).toHaveBeenCalledTimes(1);
        expect(handlers.suspendInsertSlotCommit).toHaveBeenCalledTimes(1);
    });
});

describe("plain paste over the confirm threshold", () => {
    const BULK = Array.from({ length: STORY_PASTE_CONFIRM_THRESHOLD + 10 }, (_, index) => `line ${index}`).join("\n");

    function deferredConfirm() {
        let release: (value: boolean) => void = () => undefined;
        const promise = new Promise<boolean>(resolve => { release = resolve; });
        return { showConfirm: () => promise, release };
    }

    it("inserts the rows when the confirm comes back yes", async () => {
        const { showConfirm, release } = deferredConfirm();
        const handlers = setup({ showConfirm });
        handlers.plainPasteRequestedRef.current = true;

        handlers.result.current.handlePaste(pasteEvent(BULK));
        release(true);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(handlers.storyService.insertBlock).toHaveBeenCalledTimes(STORY_PASTE_CONFIRM_THRESHOLD + 10);
    });

    /**
     * A freeze during the dialog is not a corner: the dialog is modal and the author froze the
     * workspace deliberately (they went to look at a version). Continuing would insert into the
     * in-memory scene, the fs boundary would then refuse the save, and the thaw's re-read would throw
     * the rows away - a paste that looked like it worked until the workspace came back.
     */
    it("refuses to insert when a freeze lands while the confirm is open", async () => {
        const { showConfirm, release } = deferredConfirm();
        const handlers = setup({ showConfirm });
        handlers.plainPasteRequestedRef.current = true;

        handlers.result.current.handlePaste(pasteEvent(BULK));
        handlers.frozen.value = true;
        release(true);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(handlers.storyService.insertBlock).not.toHaveBeenCalled();
        expect(handlers.recordHistory).not.toHaveBeenCalled();
    });
});
