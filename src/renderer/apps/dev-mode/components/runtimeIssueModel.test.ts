import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryBlockId, StoryDocument, StoryScene } from "@shared/types/story";
import type { DevModeBundle } from "@shared/types/devMode";
import type { GameAppRuntimeIssue } from "@/lib/ui-editor/runtime/app/GameAppHost";
import {
    RUNTIME_ISSUE_LIMIT,
    appendRuntimeIssue,
    buildStoryRowLookups,
    countRuntimeIssues,
    locateRuntimeIssue,
    locateStoryBlock,
    runtimeIssueKey,
    type LocatedRuntimeIssue,
} from "./runtimeIssueModel";

function narration(id: StoryBlockId, text: string, childrenIds: StoryBlockId[] = []): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds,
        payload: { action: "narration", text: { textId: `t-${id}`, value: text, role: "narration" } },
    };
}

function dialogue(id: StoryBlockId, characterId: string, text: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "dialogue", characterId, text: { textId: `t-${id}`, value: text, role: "dialogue" } },
    };
}

function scene(id: string, name: string, blocks: StoryBlock[], rootBlockIds: StoryBlockId[]): StoryScene {
    return {
        id,
        name,
        runtimeName: id,
        rootBlockIds,
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    };
}

function document(id: string, name: string, scenes: StoryScene[]): StoryDocument {
    return {
        schemaVersion: 1,
        id,
        name,
        chapters: [],
        scenes: Object.fromEntries(scenes.map(item => [item.id, item])),
    } as unknown as StoryDocument;
}

/** A bundle carrying just the story library — the only part the locator reads. */
function bundleWith(
    documents: StoryDocument[],
    characters: { id: string; name: string; color?: string }[] = [],
): Pick<DevModeBundle, "storyLibrary"> {
    return {
        storyLibrary: {
            index: { schemaVersion: 1, stories: [] },
            documents: Object.fromEntries(documents.map(doc => [doc.id, doc])),
            characters: characters.map(character => ({
                id: character.id,
                name: character.name,
                appearance: { kind: "preset", poses: [], defaultPoseId: null },
                ...(character.color ? { color: character.color } : {}),
            })),
            animations: {},
            assetNames: {},
        },
    } as unknown as Pick<DevModeBundle, "storyLibrary">;
}

describe("locateStoryBlock", () => {
    const storyA = document("story-a", "Story A", [
        scene("scene-1", "Opening", [narration("a", "first"), narration("b", "second"), narration("c", "third")], [
            "a",
            "b",
            "c",
        ]),
    ]);

    it("gives the 1-based line number the editor shows, plus the scene it is in", () => {
        const located = locateStoryBlock(bundleWith([storyA]), "c");
        expect(located).toMatchObject({
            storyId: "story-a",
            sceneId: "scene-1",
            sceneName: "Opening",
            blockId: "c",
            lineNumber: 3,
        });
        expect(located?.sentence).toContain("third");
    });

    it("finds a block in a scene the session did not start in", () => {
        // The whole reason it searches every scene: a compile walks the reachable graph and the play
        // head follows jumps, so the failing row is routinely somewhere else entirely.
        const storyB = document("story-b", "Story B", [
            scene("scene-x", "Elsewhere", [narration("far", "way over here")], ["far"]),
        ]);
        expect(locateStoryBlock(bundleWith([storyA, storyB]), "far")).toMatchObject({
            storyId: "story-b",
            sceneId: "scene-x",
            sceneName: "Elsewhere",
            lineNumber: 1,
        });
    });

    it("names the speaker on a dialogue row", () => {
        const doc = document("story-c", "Story C", [
            scene("scene-1", "Talk", [dialogue("d", "char-1", "hello")], ["d"]),
        ]);
        const located = locateStoryBlock(bundleWith([doc], [{ id: "char-1", name: "Nattou" }]), "d");
        expect(located?.speaker).toBe("Nattou");
    });

    it("returns null for a block that no longer exists rather than inventing a line", () => {
        expect(locateStoryBlock(bundleWith([storyA]), "deleted")).toBeNull();
    });

    it("returns null when there is no block id and when there is no story library", () => {
        expect(locateStoryBlock(bundleWith([storyA]), undefined)).toBeNull();
        expect(locateStoryBlock({}, "a")).toBeNull();
    });

    it("still names the scene for an orphan block that occupies no line", () => {
        // Present in `blocks` but unreachable from `rootBlockIds`: it has no line number because it
        // has no line, and saying "in Opening" beats saying nothing.
        const orphaned = document("story-d", "Story D", [
            scene("scene-1", "Opening", [narration("a", "first"), narration("ghost", "unreachable")], ["a"]),
        ]);
        expect(locateStoryBlock(bundleWith([orphaned]), "ghost")).toMatchObject({
            sceneName: "Opening",
            lineNumber: 0,
            sentence: "",
        });
    });
});

describe("buildStoryRowLookups", () => {
    it("drops an accent colour the editor would refuse to draw", () => {
        const doc = document("story-a", "Story A", [scene("scene-1", "Opening", [], [])]);
        // Near-white: fails the readability band Studio chrome holds accents to.
        const lookups = buildStoryRowLookups(
            bundleWith([doc], [{ id: "c1", name: "Pale", color: "#fffffe" }]),
            doc,
            doc.scenes["scene-1"],
        );
        expect(lookups.character("c1")).toEqual({ name: "Pale" });
    });

    it("keeps a readable accent colour", () => {
        const doc = document("story-a", "Story A", [scene("scene-1", "Opening", [], [])]);
        const lookups = buildStoryRowLookups(
            bundleWith([doc], [{ id: "c1", name: "Brand", color: "#40a8c4" }]),
            doc,
            doc.scenes["scene-1"],
        );
        expect(lookups.character("c1")).toEqual({ name: "Brand", color: "#40a8c4" });
    });

    it("returns null for a character the bundle does not carry", () => {
        const doc = document("story-a", "Story A", [scene("scene-1", "Opening", [], [])]);
        const lookups = buildStoryRowLookups(bundleWith([doc]), doc, doc.scenes["scene-1"]);
        expect(lookups.character("missing")).toBeNull();
    });
});

describe("locateRuntimeIssue", () => {
    const doc = document("story-a", "Story A", [
        scene("scene-1", "Opening", [narration("a", "first"), narration("b", "second")], ["a", "b"]),
    ]);

    it("carries the level, message, origin and stack through, with the location resolved", () => {
        const issue: GameAppRuntimeIssue = {
            level: "error",
            message: "Invalid command, skipped: /show ghost",
            origin: "compile",
            blockId: "b",
            stack: "at compileBlock",
        };
        expect(locateRuntimeIssue(bundleWith([doc]), issue, "issue-1")).toEqual({
            id: "issue-1",
            level: "error",
            message: "Invalid command, skipped: /show ghost",
            origin: "compile",
            stack: "at compileBlock",
            location: expect.objectContaining({ sceneName: "Opening", lineNumber: 2 }),
        });
    });

    it("keeps an unattributable failure rather than dropping it", () => {
        const located = locateRuntimeIssue(
            bundleWith([doc]),
            { level: "error", message: "Boot failed", origin: "session" },
            "issue-1",
        );
        expect(located.location).toBeNull();
        expect(located.message).toBe("Boot failed");
        expect(located).not.toHaveProperty("stack");
    });
});

describe("appendRuntimeIssue", () => {
    function issue(id: string, message: string, blockId?: string): LocatedRuntimeIssue {
        return {
            id,
            level: "error",
            message,
            origin: blockId ? "compile" : "session",
            location: blockId
                ? {
                      storyId: "s",
                      storyName: "S",
                      sceneId: "sc",
                      sceneName: "Sc",
                      blockId,
                      lineNumber: 1,
                      sentence: "",
                      speaker: null,
                  }
                : null,
        };
    }

    it("puts the newest first", () => {
        const list = appendRuntimeIssue(appendRuntimeIssue([], issue("1", "first")), issue("2", "second"));
        expect(list.map(entry => entry.id)).toEqual(["2", "1"]);
    });

    it("keys a repeat the same as the report it repeats, and two rows apart", () => {
        // What the strip's acknowledgement rests on: a looping row reports the same failure as a
        // NEW entry every pass, so a dismissal keyed on entry ids would come undone immediately.
        expect(runtimeIssueKey(issue("1", "boom", "row-1"))).toBe(runtimeIssueKey(issue("2", "boom", "row-1")));
        expect(runtimeIssueKey(issue("1", "boom", "row-1"))).not.toBe(runtimeIssueKey(issue("2", "boom", "row-2")));
    });

    it("collapses a repeat instead of stacking it, and moves it back to the front", () => {
        // A row inside a loop reports the same failure on every pass; without this the banner is a
        // hundred copies of one sentence.
        let list = appendRuntimeIssue([], issue("1", "boom", "row-1"));
        list = appendRuntimeIssue(list, issue("2", "other", "row-2"));
        list = appendRuntimeIssue(list, issue("3", "boom", "row-1"));
        expect(list.map(entry => entry.id)).toEqual(["3", "2"]);
    });

    it("keeps the same message from two different rows as two problems", () => {
        let list = appendRuntimeIssue([], issue("1", "boom", "row-1"));
        list = appendRuntimeIssue(list, issue("2", "boom", "row-2"));
        expect(list).toHaveLength(2);
    });

    it("caps the list", () => {
        let list: LocatedRuntimeIssue[] = [];
        for (let index = 0; index < RUNTIME_ISSUE_LIMIT + 5; index += 1) {
            list = appendRuntimeIssue(list, issue(`${index}`, `message ${index}`));
        }
        expect(list).toHaveLength(RUNTIME_ISSUE_LIMIT);
        expect(list[0]?.id).toBe(`${RUNTIME_ISSUE_LIMIT + 4}`);
    });
});

describe("countRuntimeIssues", () => {
    function at(level: LocatedRuntimeIssue["level"], id: string): LocatedRuntimeIssue {
        return { id, level, message: id, origin: "session", location: null };
    }

    it("splits the list by level, which is what decides the strip's colour", () => {
        // A warning-only list must count zero errors: the strip is painted in the error colour when
        // and only when there is a real error in it.
        expect(countRuntimeIssues([at("warning", "a"), at("warning", "b")])).toEqual({
            errors: 0,
            warnings: 2,
        });
        expect(countRuntimeIssues([at("error", "a"), at("warning", "b"), at("error", "c")])).toEqual({
            errors: 2,
            warnings: 1,
        });
    });

    it("counts nothing in an empty list", () => {
        expect(countRuntimeIssues([])).toEqual({ errors: 0, warnings: 0 });
    });
});
