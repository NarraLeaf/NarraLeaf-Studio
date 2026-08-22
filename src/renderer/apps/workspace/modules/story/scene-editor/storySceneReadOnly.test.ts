import { describe, expect, it, vi } from "vitest";
import type { KeybindingDefinition } from "@/apps/workspace/hooks";
import { storyDocumentSpec } from "@shared/documents/specs";
import { freezeAllowsWrite } from "@/lib/app/writeFreeze";
import type { StoryRowActions } from "./storyRowActions";
import {
    isRowTextEditable,
    isStoryKeybindingReadOnlySafe,
    isStoryRowActionReadOnlySafe,
    storyDocumentFreezeScope,
    toReadOnlyStoryKeybindings,
    toReadOnlyStoryRowActions,
} from "./storySceneReadOnly";

/**
 * Every key of `StoryRowActions`, spelled out so a new action lands here as a failing expectation
 * rather than silently defaulting to writable inside a frozen project.
 */
const ALL_ROW_ACTIONS: Array<keyof StoryRowActions> = [
    "select",
    "contextMenu",
    "mouseDown",
    "mouseEnter",
    "toggleCollapsed",
    "startTextEdit",
    "editRichChange",
    "commitTextEdit",
    "exitTextEdit",
    "continueRow",
    "arrowOut",
    "goalColumnInvalidated",
    "backspaceAtEmptyStart",
    "undoBeyondRow",
    "redoBeyondRow",
    "openInspector",
    "revealInspectorPanel",
    "updatePayload",
    "setDialogueCharacter",
    "setPosition",
    "setSpeaker",
    "createCharacter",
    "insertAfter",
    "deleteRow",
    "addInside",
    "addBranch",
    "playFromRow",
];

function spyActions(): { actions: StoryRowActions; spies: Map<keyof StoryRowActions, ReturnType<typeof vi.fn>> } {
    const spies = new Map<keyof StoryRowActions, ReturnType<typeof vi.fn>>();
    const actions = {} as Record<string, unknown>;
    for (const key of ALL_ROW_ACTIONS) {
        const spy = vi.fn();
        spies.set(key, spy);
        actions[key] = spy;
    }
    return { actions: actions as StoryRowActions, spies };
}

describe("isStoryRowActionReadOnlySafe", () => {
    it("keeps selecting, folding and reading a row", () => {
        expect(isStoryRowActionReadOnlySafe("select")).toBe(true);
        expect(isStoryRowActionReadOnlySafe("mouseDown")).toBe(true);
        expect(isStoryRowActionReadOnlySafe("mouseEnter")).toBe(true);
        expect(isStoryRowActionReadOnlySafe("contextMenu")).toBe(true);
        expect(isStoryRowActionReadOnlySafe("toggleCollapsed")).toBe(true);
        expect(isStoryRowActionReadOnlySafe("openInspector")).toBe(true);
        // Reading a row's fields is worth nothing if the rail holding them cannot be revealed.
        expect(isStoryRowActionReadOnlySafe("revealInspectorPanel")).toBe(true);
    });

    it("refuses opening a row's text and everything that edits it", () => {
        expect(isStoryRowActionReadOnlySafe("startTextEdit")).toBe(false);
        expect(isStoryRowActionReadOnlySafe("editRichChange")).toBe(false);
        expect(isStoryRowActionReadOnlySafe("commitTextEdit")).toBe(false);
        expect(isStoryRowActionReadOnlySafe("continueRow")).toBe(false);
        expect(isStoryRowActionReadOnlySafe("backspaceAtEmptyStart")).toBe(false);
        expect(isStoryRowActionReadOnlySafe("undoBeyondRow")).toBe(false);
        expect(isStoryRowActionReadOnlySafe("redoBeyondRow")).toBe(false);
        expect(isStoryRowActionReadOnlySafe("deleteRow")).toBe(false);
        expect(isStoryRowActionReadOnlySafe("insertAfter")).toBe(false);
        expect(isStoryRowActionReadOnlySafe("setSpeaker")).toBe(false);
        expect(isStoryRowActionReadOnlySafe("createCharacter")).toBe(false);
    });
});

describe("toReadOnlyStoryRowActions", () => {
    it("returns the same object when writable, because rows depend on its identity", () => {
        const { actions } = spyActions();
        expect(toReadOnlyStoryRowActions(actions, false)).toBe(actions);
    });

    it("covers every action, so none is left undefined", () => {
        const { actions } = spyActions();
        const frozen = toReadOnlyStoryRowActions(actions, true);
        for (const key of ALL_ROW_ACTIONS) {
            expect(typeof frozen[key]).toBe("function");
        }
    });

    it("passes the read-safe actions straight through and swallows the rest", () => {
        const { actions, spies } = spyActions();
        const frozen = toReadOnlyStoryRowActions(actions, true);

        frozen.select("block-1", {} as never);
        frozen.openInspector("block-1");
        frozen.startTextEdit("block-1");
        frozen.deleteRow("block-1");

        expect(spies.get("select")).toHaveBeenCalledTimes(1);
        expect(spies.get("openInspector")).toHaveBeenCalledTimes(1);
        expect(spies.get("startTextEdit")).not.toHaveBeenCalled();
        expect(spies.get("deleteRow")).not.toHaveBeenCalled();
    });
});

describe("story keybindings", () => {
    const bindings: KeybindingDefinition[] = [
        { id: "find", key: "mod+f", handler: vi.fn() },
        { id: "move-selection-down", key: "arrowdown", handler: vi.fn() },
        { id: "edit-active", key: "enter", handler: vi.fn() },
        { id: "delete", key: "delete", handler: vi.fn() },
        { id: "undo", key: "mod+z", handler: vi.fn() },
        { id: "move-row-up", key: "alt+arrowup", handler: vi.fn() },
    ];

    it("names find, navigation and the openers as read-safe", () => {
        expect(isStoryKeybindingReadOnlySafe("find")).toBe(true);
        expect(isStoryKeybindingReadOnlySafe("move-selection-down")).toBe(true);
        expect(isStoryKeybindingReadOnlySafe("edit-active")).toBe(true);
        expect(isStoryKeybindingReadOnlySafe("delete")).toBe(false);
        expect(isStoryKeybindingReadOnlySafe("undo")).toBe(false);
        expect(isStoryKeybindingReadOnlySafe("indent")).toBe(false);
        expect(isStoryKeybindingReadOnlySafe("outdent")).toBe(false);
        expect(isStoryKeybindingReadOnlySafe("move-row-up")).toBe(false);
    });

    it("returns the input untouched when writable", () => {
        expect(toReadOnlyStoryKeybindings(bindings, false)).toBe(bindings);
    });

    it("keeps every binding registered, with the editing handlers replaced", () => {
        const frozen = toReadOnlyStoryKeybindings(bindings, true);
        expect(frozen.map(binding => binding.id)).toEqual(bindings.map(binding => binding.id));
        expect(frozen.map(binding => binding.key)).toEqual(bindings.map(binding => binding.key));
        expect(frozen[0].handler).toBe(bindings[0].handler);
        expect(frozen[2].handler).toBe(bindings[2].handler);
        expect(frozen[3].handler).not.toBe(bindings[3].handler);

        for (const binding of frozen) {
            void binding.handler({} as never);
        }
        expect(bindings[3].handler).not.toHaveBeenCalled();
        expect(bindings[4].handler).not.toHaveBeenCalled();
        expect(bindings[5].handler).not.toHaveBeenCalled();
        expect(bindings[0].handler).toHaveBeenCalledTimes(1);
    });
});

describe("storyDocumentFreezeScope", () => {
    it("names the file the write gate would be asked about, in the gate's own spelling", () => {
        // The whole point of deriving it from the document spec: this string is compared against the
        // set a live session declares writable, and a second spelling of the story path would make
        // the editor offer edits the write boundary then refuses.
        const scope = storyDocumentFreezeScope("chapter-one");
        expect(scope).toBe("editor/story/stories/chapter-one/storydoc.json");
        expect(freezeAllowsWrite(
            { kind: "live-session", session: "room-1", writable: [scope!] },
            scope!,
        )).toBe(true);
    });

    it("names nothing for a tab with no story, so the guard stays conservative", () => {
        expect(storyDocumentFreezeScope(undefined)).toBeUndefined();
        expect(storyDocumentFreezeScope("")).toBeUndefined();
    });

    it("does not let one story's scope unlock another's", () => {
        const mine = storyDocumentFreezeScope("chapter-one")!;
        const theirs = storyDocumentFreezeScope("chapter-two")!;
        expect(freezeAllowsWrite(
            { kind: "live-session", session: "room-1", writable: [theirs] },
            mine,
        )).toBe(false);
    });

    it("is one path because a story is one file, and has to grow the day it is not", () => {
        // A scope of one path is only the whole story while the document IS one file. The document
        // layer already carries a set layout - a manifest beside a directory of members - and the
        // story document is the case it was built for. On the day it is split, every write to
        // `scenes/<sceneId>.json` would be a path this scope never names: refused at the boundary,
        // reported as an unsaved change, with the editor still offering the edit.
        //
        // So this asserts the assumption rather than the behaviour. It fails the moment the story
        // spec gains a layout, which is where somebody has to decide what a session declares
        // writable.
        expect("layout" in storyDocumentSpec).toBe(false);
        expect(storyDocumentSpec.paths).toEqual(["editor/story/stories/<storyId>/storydoc.json"]);
    });
});

describe("isRowTextEditable", () => {
    it("opens a row for editing on a writable workspace", () => {
        expect(isRowTextEditable(false, false)).toBe(true);
    });

    it("refuses while frozen - both the state transition and the DOM ask this", () => {
        // Gating only `StoryRowActions.startTextEdit` was measured to leave the ordinary click working:
        // it goes through the controller's window mouseup, and the field is `contentEditable` besides.
        expect(isRowTextEditable(true, false)).toBe(false);
    });

    it("refuses a row somebody else in the room is writing", () => {
        // The host would refuse the operation anyway. Letting an author type a paragraph and telling
        // them afterwards is precisely the injury the claim exists to prevent.
        expect(isRowTextEditable(false, true)).toBe(false);
        expect(isRowTextEditable(true, true)).toBe(false);
    });
});
