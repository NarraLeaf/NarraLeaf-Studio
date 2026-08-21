// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import React, { type ClipboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LocalizationUnit } from "@shared/types/localization";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import { STORY_PASTE_CONFIRM_THRESHOLD } from "@/lib/story/paste/storyPasteTypes";
import { STORY_ACTIONS_MIME } from "./storySceneClipboard";
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

function setup(options: {
    editorMode?: EditorMode;
    showConfirm?: () => Promise<boolean>;
    scene?: StoryScene;
    localizationService?: unknown;
} = {}) {
    const storyService = { insertBlock: vi.fn() };
    const frozen = { value: false };
    const showNotification = vi.fn();
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
        uiService: {
            showConfirm: options.showConfirm ?? (() => Promise.resolve(true)),
            showNotification,
        } as never,
        assetsService: null,
        fileSystemService: null,
        localizationService: (options.localizationService ?? null) as never,
        storyId: "story-1",
        sceneId: "scene-1",
        scene: options.scene ?? SCENE,
        scenes: undefined,
        characters: [],
        knownCharacterIds: new Set<string>(),
        projectPath: "D:/projects/here",
        projectName: "Here",
        projectIdentifier: "com.example.here",
        selectedBlockIds: new Set<string>(options.scene ? Object.keys(options.scene.blocks) : []),
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
    return { result, storyService, frozen, plainPasteRequestedRef, showNotification, ...spies };
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

/**
 * Copy and paste inside one project, driven end to end, because that is where the loss was invisible:
 * a row duplicated in the project that wrote it looks identical whether its translations came with it
 * or not, and nothing on screen says which happened.
 */
describe("translations travelling with copied rows", () => {
    const TRANSLATED_LINE: StoryBlock = {
        id: "block-1",
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: {
            action: "dialogue",
            characterId: "char-1",
            text: { textId: "text-1", role: "dialogue", value: "Hi" },
        },
    };
    const TRANSLATED_SCENE = {
        id: "scene-1",
        name: "One",
        blocks: { "block-1": TRANSLATED_LINE },
        rootBlockIds: ["block-1"],
    } as unknown as StoryScene;

    const JA_UNIT: LocalizationUnit = { target: "やあ", sourceHash: "fnv1a:older", status: "reviewed" };

    /** A localization service holding one translated line, whose languages the caller can change. */
    function localizationStub(locales: string[]) {
        const adopted: { locale: string; units: Record<string, LocalizationUnit> }[] = [];
        const declared = { locales };
        const documentFor = (locale: string) => ({
            schemaVersion: 1 as const,
            locale,
            units: locale === "ja" ? { "text-1": JA_UNIT } : {},
        });
        return {
            adopted,
            declared,
            service: {
                getConfiguration: () => ({
                    sourceLocale: "en",
                    locales: declared.locales.map(code => ({ code, displayName: code })),
                }),
                getDocumentIfLoaded: documentFor,
                loadDocument: async (locale: string) => documentFor(locale),
                onConfigChanged: () => () => undefined,
                adoptUnits: (locale: string, units: Record<string, LocalizationUnit>) => {
                    adopted.push({ locale, units });
                    return documentFor(locale);
                },
            },
        };
    }

    function copyEvent() {
        const written = new Map<string, string>();
        return {
            written,
            event: {
                preventDefault: () => undefined,
                clipboardData: { setData: (mime: string, value: string) => void written.set(mime, value) },
            } as unknown as ClipboardEvent<HTMLDivElement>,
        };
    }

    function blocksPasteEvent(payload: string): ClipboardEvent<HTMLDivElement> {
        return {
            target: document.body,
            preventDefault: () => undefined,
            nativeEvent: { shiftKey: false },
            clipboardData: { getData: (mime: string) => (mime === STORY_ACTIONS_MIME ? payload : "") },
        } as unknown as ClipboardEvent<HTMLDivElement>;
    }

    /** The text id the paste minted, read off the block it handed the story service. */
    function pastedTextId(storyService: { insertBlock: { mock: { calls: unknown[][] } } }): string {
        const block = storyService.insertBlock.mock.calls[0][2] as StoryBlock;
        return (block.payload as unknown as { text: { textId: string } }).text.textId;
    }

    it("re-keys a copied line's translation onto the row the paste created", async () => {
        const localization = localizationStub(["en", "ja"]);
        const handlers = setup({ scene: TRANSLATED_SCENE, localizationService: localization.service });

        const copied = copyEvent();
        handlers.result.current.copySelectionToClipboard(copied.event);
        handlers.result.current.handlePaste(blocksPasteEvent(copied.written.get(STORY_ACTIONS_MIME) ?? ""));
        await new Promise(resolve => setTimeout(resolve, 0));

        const textId = pastedTextId(handlers.storyService);
        expect(textId).not.toBe("text-1");
        expect(localization.adopted).toEqual([{
            locale: "ja",
            // The anchor travels, so a translation that was already out of date still reads that way;
            // the review does not, because nobody has looked at this line.
            units: { [textId]: { target: "やあ", sourceHash: "fnv1a:older", status: "translated" } },
        }]);
        // Nothing to tell the author: the rows came home and every language they carry is still here.
        expect(handlers.showNotification).not.toHaveBeenCalled();
    });

    it("says so when the language was removed between the copy and the paste", async () => {
        const localization = localizationStub(["en", "ja"]);
        const handlers = setup({ scene: TRANSLATED_SCENE, localizationService: localization.service });

        const copied = copyEvent();
        handlers.result.current.copySelectionToClipboard(copied.event);
        localization.declared.locales = ["en"];
        handlers.result.current.handlePaste(blocksPasteEvent(copied.written.get(STORY_ACTIONS_MIME) ?? ""));
        await new Promise(resolve => setTimeout(resolve, 0));

        // Adding the language back is the author's decision, not something a paste does for them.
        expect(localization.adopted).toEqual([]);
        expect(handlers.showNotification).toHaveBeenCalledTimes(1);
    });

    it("puts nothing on the clipboard for rows nobody has translated", () => {
        const localization = localizationStub(["en"]);
        const handlers = setup({ scene: TRANSLATED_SCENE, localizationService: localization.service });

        const copied = copyEvent();
        handlers.result.current.copySelectionToClipboard(copied.event);

        const payload = JSON.parse(copied.written.get(STORY_ACTIONS_MIME) ?? "{}") as Record<string, unknown>;
        expect(payload).not.toHaveProperty("translations");
    });
});
