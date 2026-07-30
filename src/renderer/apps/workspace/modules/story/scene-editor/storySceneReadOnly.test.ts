import { describe, expect, it, vi } from "vitest";
import type { KeybindingDefinition } from "@/apps/workspace/hooks";
import type { StoryRowActions } from "./storyRowActions";
import {
    isRowTextEditable,
    isStoryKeybindingReadOnlySafe,
    isStoryRowActionReadOnlySafe,
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
    "toggleLens",
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
        expect(isStoryRowActionReadOnlySafe("toggleLens")).toBe(true);
        expect(isStoryRowActionReadOnlySafe("openInspector")).toBe(true);
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

describe("isRowTextEditable", () => {
    it("opens a row for editing on a writable workspace", () => {
        expect(isRowTextEditable(false)).toBe(true);
    });

    it("refuses while frozen - both the state transition and the DOM ask this", () => {
        // Gating only `StoryRowActions.startTextEdit` was measured to leave the ordinary click working:
        // it goes through the controller's window mouseup, and the field is `contentEditable` besides.
        expect(isRowTextEditable(true)).toBe(false);
    });
});
