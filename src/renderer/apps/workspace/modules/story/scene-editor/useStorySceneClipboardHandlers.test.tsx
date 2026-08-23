// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import React, { type ClipboardEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalizationUnit } from "@shared/types/localization";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import type { VoiceUnit } from "@shared/types/voice";
import { freezeProjectWrites, thawProjectWrites } from "@/lib/app/writeFreeze";
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
    /** Where the rows land. A second editor on a second scene is what moving a line looks like. */
    sceneId?: string;
    localizationService?: unknown;
    voiceService?: unknown;
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
        voiceService: (options.voiceService ?? null) as never,
        storyId: "story-1",
        sceneId: options.sceneId ?? "scene-1",
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

/**
 * A recorded line moved into another scene, driven end to end - which is the shape the loss actually
 * had.
 *
 * There is no operation that moves rows between scenes, so restructuring a script means copying the
 * rows, pasting them where they now belong, and deleting the originals. The paste mints a fresh
 * `textId` for every line it writes, and a take is keyed by exactly that id, so an already-recorded
 * script silently lost every take on the lines that moved: the voice table put them back to
 * `missing` and the imported audio became an orphan. Nothing on screen said so - a moved line looks
 * the same either way, and the loss surfaces in a language nobody is reading at the time.
 */
describe("takes travelling with moved rows", () => {
    const VOICED_LINE: StoryBlock = {
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
    const CHAPTER_ONE = {
        id: "scene-1",
        name: "One",
        blocks: { "block-1": VOICED_LINE },
        rootBlockIds: ["block-1"],
    } as unknown as StoryScene;
    const CHAPTER_TWO = {
        id: "scene-2",
        name: "Two",
        blocks: {},
        rootBlockIds: [],
    } as unknown as StoryScene;

    const JA_TAKE: VoiceUnit = { assetId: "clip-1", sourceHash: "fnv1a:older", status: "approved", note: "softer" };

    /** A voice service holding one approved take, in a library nothing has opened yet. */
    function voiceStub(units: Record<string, VoiceUnit> = { "text-1": JA_TAKE }) {
        const adopted: { locale: string; units: Record<string, VoiceUnit> }[] = [];
        const loaded = new Set<string>();
        return {
            adopted,
            loaded,
            service: {
                getConfiguration: () => ({ voicedLocales: [{ code: "ja", displayName: "日本語" }] }),
                getDocumentIfLoaded: (locale: string) =>
                    (loaded.has(locale) ? { schemaVersion: 1 as const, locale, units } : undefined),
                loadDocument: async (locale: string) => {
                    loaded.add(locale);
                    return { schemaVersion: 1 as const, locale, units };
                },
                adoptUnits: (locale: string, adoptedUnits: Record<string, VoiceUnit>) => {
                    adopted.push({ locale, units: adoptedUnits });
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

    function pastedTextId(storyService: { insertBlock: { mock: { calls: unknown[][] } } }): string {
        const block = storyService.insertBlock.mock.calls[0][2] as StoryBlock;
        return (block.payload as unknown as { text: { textId: string } }).text.textId;
    }

    it("keeps a voiced line's take when the line is pasted into another scene", async () => {
        const voice = voiceStub();
        const source = setup({ scene: CHAPTER_ONE, voiceService: voice.service });
        const destination = setup({ scene: CHAPTER_TWO, sceneId: "scene-2", voiceService: voice.service });

        const copied = copyEvent();
        source.result.current.copySelectionToClipboard(copied.event);
        destination.result.current.handlePaste(blocksPasteEvent(copied.written.get(STORY_ACTIONS_MIME) ?? ""));
        await new Promise(resolve => setTimeout(resolve, 0));

        const textId = pastedTextId(destination.storyService);
        expect(textId).not.toBe("text-1");
        // The library was opened by the paste: nothing had read it, because the destination scene has
        // no voiced row for the indicator to ask about.
        expect(voice.loaded.has("ja")).toBe(true);
        expect(voice.adopted).toEqual([{
            locale: "ja",
            // The clip, the anchor and the sign-off all as they were: the same recording, of the same
            // text, in a different place. A stale take still reads as stale; an approved one is not
            // sent back to a director with nothing new to listen to.
            units: { [textId]: { assetId: "clip-1", sourceHash: "fnv1a:older", status: "approved", note: "softer" } },
        }]);
    });

    it("writes no take for a line that was never recorded", async () => {
        const voice = voiceStub({});
        const source = setup({ scene: CHAPTER_ONE, voiceService: voice.service });
        const destination = setup({ scene: CHAPTER_TWO, sceneId: "scene-2", voiceService: voice.service });

        const copied = copyEvent();
        source.result.current.copySelectionToClipboard(copied.event);
        destination.result.current.handlePaste(blocksPasteEvent(copied.written.get(STORY_ACTIONS_MIME) ?? ""));
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(voice.adopted).toEqual([]);
    });

    /**
     * A take names a clip in the audio library of the project that recorded it. This window can
     * neither read that library nor be handed the file, so rows from elsewhere arrive unvoiced - and
     * nothing of this project's voice libraries is read on their behalf either.
     */
    it("carries no take for rows pasted out of another project", async () => {
        const voice = voiceStub();
        const source = setup({ scene: CHAPTER_ONE, voiceService: voice.service });
        const destination = setup({ scene: CHAPTER_TWO, sceneId: "scene-2", voiceService: voice.service });

        const copied = copyEvent();
        source.result.current.copySelectionToClipboard(copied.event);
        const payload = JSON.parse(copied.written.get(STORY_ACTIONS_MIME) ?? "{}") as Record<string, unknown>;
        payload.source = { path: "D:/projects/elsewhere", identifier: "com.example.elsewhere", name: "Elsewhere" };
        destination.result.current.handlePaste(blocksPasteEvent(JSON.stringify(payload)));
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(destination.storyService.insertBlock).toHaveBeenCalledTimes(1);
        expect(voice.adopted).toEqual([]);
        expect(voice.loaded.size).toBe(0);
    });

    it("puts no take on the clipboard at all", () => {
        const voice = voiceStub();
        const source = setup({ scene: CHAPTER_ONE, voiceService: voice.service });

        const copied = copyEvent();
        source.result.current.copySelectionToClipboard(copied.event);

        // Whatever reads the system clipboard learns nothing about this project's audio library.
        const payload = copied.written.get(STORY_ACTIONS_MIME) ?? "";
        expect(payload).not.toContain("clip-1");
        expect(JSON.parse(payload) as Record<string, unknown>).not.toHaveProperty("voice");
    });
});

/**
 * The same two gestures with a live session open on the project, driven end to end.
 *
 * The session is what turns one paste into two: rows this project wrote can be derived by everybody
 * in the room from one effect, and rows from anywhere else cannot, because their translations,
 * takes and asset bytes exist on the pasting machine only.
 */
describe("pasting while a live session is open", () => {
    const HERE = "D:/projects/here";

    const LINE: StoryBlock = {
        id: "block-1",
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: {
            action: "dialogue",
            characterId: "char-1",
            // An asset site, so a paste from elsewhere lands holding a reference to a file this
            // project has never had.
            voiceAssetId: "clip-from-elsewhere",
            text: { textId: "text-1", role: "dialogue", value: "Hi" },
        },
    };
    const SCENE_HERE = {
        id: "scene-1",
        name: "One",
        blocks: { "block-1": LINE },
        rootBlockIds: ["block-1"],
    } as unknown as StoryScene;

    const JA_UNIT: LocalizationUnit = { target: "やあ", sourceHash: "fnv1a:older", status: "reviewed" };
    const JA_TAKE: VoiceUnit = { assetId: "clip-1", sourceHash: "fnv1a:older", status: "approved" };

    function localizationStub() {
        const adopted: { locale: string; units: Record<string, LocalizationUnit> }[] = [];
        const documentFor = (locale: string) => ({
            schemaVersion: 1 as const,
            locale,
            units: locale === "ja" ? { "text-1": JA_UNIT } : {},
        });
        return {
            adopted,
            service: {
                getConfiguration: () => ({
                    sourceLocale: "en",
                    locales: [{ code: "en", displayName: "en" }, { code: "ja", displayName: "ja" }],
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

    function voiceStub() {
        const adopted: { locale: string; units: Record<string, VoiceUnit> }[] = [];
        const loaded = new Set<string>();
        const units = { "text-1": JA_TAKE };
        return {
            adopted,
            loaded,
            service: {
                getConfiguration: () => ({ voicedLocales: [{ code: "ja", displayName: "日本語" }] }),
                getDocumentIfLoaded: (locale: string) =>
                    (loaded.has(locale) ? { schemaVersion: 1 as const, locale, units } : undefined),
                loadDocument: async (locale: string) => {
                    loaded.add(locale);
                    return { schemaVersion: 1 as const, locale, units };
                },
                adoptUnits: (locale: string, adoptedUnits: Record<string, VoiceUnit>) => {
                    adopted.push({ locale, units: adoptedUnits });
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

    function pastedTextId(storyService: { insertBlock: { mock: { calls: unknown[][] } } }): string {
        const block = storyService.insertBlock.mock.calls[0][2] as StoryBlock;
        return (block.payload as unknown as { text: { textId: string } }).text.textId;
    }

    /** A session over this project, which is what freezes everything but its story document. */
    function openSession(session: string) {
        freezeProjectWrites({
            projectPath: HERE,
            reason: {
                kind: "live-session",
                session,
                writable: ["editor/story/stories/story-1/storydoc.json"],
            },
        });
    }

    afterEach(() => {
        thawProjectWrites();
    });

    /**
     * The entries themselves, not ids to look up. A copy reads the copier's own memory, so an effect
     * naming ids would derive nothing anywhere else in the room.
     */
    it("sends the entries its own rows derive with the operation that carries the rows", async () => {
        openSession("room-derive");
        const localization = localizationStub();
        const voice = voiceStub();
        const handlers = setup({
            scene: SCENE_HERE,
            localizationService: localization.service,
            voiceService: voice.service,
        });

        const copied = copyEvent();
        handlers.result.current.copySelectionToClipboard(copied.event);
        handlers.result.current.handlePaste(blocksPasteEvent(copied.written.get(STORY_ACTIONS_MIME) ?? ""));
        await new Promise(resolve => setTimeout(resolve, 0));

        const textId = pastedTextId(handlers.storyService);
        expect(textId).not.toBe("text-1");
        // ⚠ On the insert itself, which is what makes them travel at all: a session hands the
        // operation to the room, and an operation cannot be added to once it has gone.
        const [first, ...rest] = handlers.storyService.insertBlock.mock.calls;
        // What travels is what the ordinary paste writes, unit for unit. The sign-off is not
        // inherited - a review is a review of that unit and nobody has given this one - but the hash
        // it was written against is, and so is everything a take carries.
        expect(first[4]).toEqual({
            translations: { ja: { [textId]: { ...JA_UNIT, status: "translated" } } },
            voice: { ja: { [textId]: JA_TAKE } },
        });
        // Once for the paste, not once per row: the entries belong to the gesture.
        expect(rest.every(call => call[4] === undefined)).toBe(true);
    });

    /**
     * ⚠ The paster writes nothing of its own, and that is the point rather than an oversight.
     *
     * The entries go out with the operation and come back as an effect, and every machine in the
     * room - this one included - writes them through the one applier that applies an effect. A
     * paster that also wrote from memory would be a second implementation for the libraries to
     * disagree through, and it would be the implementation that skips the field-by-field reading
     * the wire value gets.
     */
    it("writes nothing itself, leaving the entries to the applier every machine runs", async () => {
        openSession("room-apply");
        const localization = localizationStub();
        const voice = voiceStub();
        const handlers = setup({
            scene: SCENE_HERE,
            localizationService: localization.service,
            voiceService: voice.service,
        });

        const copied = copyEvent();
        handlers.result.current.copySelectionToClipboard(copied.event);
        handlers.result.current.handlePaste(blocksPasteEvent(copied.written.get(STORY_ACTIONS_MIME) ?? ""));
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(localization.adopted).toEqual([]);
        expect(voice.adopted).toEqual([]);
        // And it is not that nothing was derived - the entries are on the operation, whole.
        const textId = pastedTextId(handlers.storyService);
        expect(handlers.storyService.insertBlock.mock.calls[0][4]).toEqual({
            translations: { ja: { [textId]: { ...JA_UNIT, status: "translated" } } },
            voice: { ja: { [textId]: JA_TAKE } },
        });
    });

    /**
     * Rows from elsewhere: the rows land and nothing else does. The reference they carry resolves to
     * nothing, and that is `assets/missing`'s report to make - it names the site, jumps to the row
     * and refuses a build, which no count in a toast can do.
     */
    it("lands rows from another project and writes no entries at all", async () => {
        openSession("room-rows-only");
        const localization = localizationStub();
        const voice = voiceStub();
        const source = setup({ scene: SCENE_HERE, localizationService: localization.service });
        const handlers = setup({
            scene: SCENE_HERE,
            localizationService: localization.service,
            voiceService: voice.service,
        });

        const copied = copyEvent();
        source.result.current.copySelectionToClipboard(copied.event);
        const payload = JSON.parse(copied.written.get(STORY_ACTIONS_MIME) ?? "{}") as Record<string, unknown>;
        payload.source = { path: "D:/projects/elsewhere", identifier: "com.example.elsewhere", name: "Elsewhere" };
        handlers.result.current.handlePaste(blocksPasteEvent(JSON.stringify(payload)));
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(handlers.storyService.insertBlock).toHaveBeenCalledTimes(1);
        expect(localization.adopted).toEqual([]);
        expect(voice.adopted).toEqual([]);
        expect(voice.loaded.size).toBe(0);
        // One notification, and it is the one about what stayed behind. The unresolved reference
        // raises nothing here: reporting it a second time is what the lint is for.
        expect(handlers.showNotification).toHaveBeenCalledTimes(1);
        expect(handlers.showNotification.mock.calls[0][1]).toBe("info");
    });

    it("tells the author once however many times the paste is repeated", async () => {
        openSession("room-once");
        const localization = localizationStub();
        const source = setup({ scene: SCENE_HERE, localizationService: localization.service });
        const handlers = setup({ scene: SCENE_HERE, localizationService: localization.service });

        const copied = copyEvent();
        source.result.current.copySelectionToClipboard(copied.event);
        const payload = JSON.parse(copied.written.get(STORY_ACTIONS_MIME) ?? "{}") as Record<string, unknown>;
        payload.source = { path: "D:/projects/elsewhere", identifier: "com.example.elsewhere", name: "Elsewhere" };
        const event = JSON.stringify(payload);
        for (let paste = 0; paste < 4; paste += 1) {
            handlers.result.current.handlePaste(blocksPasteEvent(event));
        }
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(handlers.storyService.insertBlock).toHaveBeenCalledTimes(4);
        expect(handlers.showNotification).toHaveBeenCalledTimes(1);
    });
});
