import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import {
    applyResumeToLaunchSnapshot,
    buildStoryResumeLaunch,
    resolveRelaunchStartRow,
    resolveStoryResumeTarget,
    storyResumeNotice,
    toStoryLiteralRecord,
    type StoryResumeState,
} from "./hotReloadResume";

function row(id: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "narration", text: { textId: `${id}-t`, value: id, role: "narration" } },
    } as StoryBlock;
}

/** A two-scene story; `rows` is what the first scene holds after the author's latest edit. */
function documentWith(rows: string[]): StoryDocument {
    const blocks = rows.map(row);
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [],
        entrySceneId: "scene-1",
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "Corridor",
                runtimeName: "scene-1",
                rootBlockIds: rows,
                blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
            },
            "scene-2": {
                id: "scene-2",
                name: "Elsewhere",
                runtimeName: "scene-2",
                rootBlockIds: ["z1"],
                blocks: { z1: row("z1") },
            },
        },
    } as unknown as StoryDocument;
}

const resumeState = (position: StoryResumeState["position"]): StoryResumeState => ({
    position,
    sceneVariables: { mood: 3 },
    savedVariables: { chapter: "two" },
});

describe("where a reload puts the author back", () => {
    it("resumes on the very row when the edit kept it", () => {
        const target = resolveStoryResumeTarget(
            { sceneId: "scene-1", blockId: "r2", trail: ["r1", "r2"] },
            documentWith(["r1", "r2", "r3"]),
        );

        expect(target).toEqual({ kind: "row", sceneId: "scene-1", blockId: "r2" });
        expect(storyResumeNotice(target)).toBeNull();
    });

    it("falls back to the nearest row it actually played when the row was deleted", () => {
        // The deleted row is not in the new document, so there is nothing there to walk backwards
        // from: what the run played is the only record of what came before it.
        const target = resolveStoryResumeTarget(
            { sceneId: "scene-1", blockId: "r3", trail: ["r1", "r2", "r3"] },
            documentWith(["r1", "r2"]),
        );

        expect(target).toEqual({ kind: "previousRow", sceneId: "scene-1", blockId: "r2" });
        expect(storyResumeNotice(target)).toContain("resumed from the row before it");
    });

    it("skips trail rows the same edit removed", () => {
        const target = resolveStoryResumeTarget(
            { sceneId: "scene-1", blockId: "r4", trail: ["r1", "r2", "r3", "r4"] },
            documentWith(["r1"]),
        );

        expect(target).toEqual({ kind: "previousRow", sceneId: "scene-1", blockId: "r1" });
    });

    it("never walks the trail into another scene", () => {
        // One row into a new scene, and that row is deleted. The row before it belongs to the scene
        // the author has left, which is further from where they were than this scene's start.
        const target = resolveStoryResumeTarget(
            { sceneId: "scene-2", blockId: "gone", trail: ["r1", "r2", "gone"] },
            documentWith(["r1", "r2"]),
        );

        expect(target).toEqual({ kind: "sceneStart", sceneId: "scene-2" });
        expect(storyResumeNotice(target)).toContain("start of the scene");
    });

    it("starts from the entry, and says so, when the scene is gone", () => {
        const document = documentWith(["r1"]);
        delete (document.scenes as Record<string, unknown>)["scene-1"];

        const target = resolveStoryResumeTarget(
            { sceneId: "scene-1", blockId: "r1", trail: ["r1"] },
            document,
        );

        expect(target).toEqual({ kind: "entry", reason: "sceneMissing" });
        expect(storyResumeNotice(target)).toBe(
            "The scene you were on no longer exists; restarted from the beginning.",
        );
    });

    it("starts from the entry when the whole story document is gone", () => {
        const target = resolveStoryResumeTarget({ sceneId: "scene-1", trail: [] }, undefined);

        expect(target).toEqual({ kind: "entry", reason: "storyMissing" });
        expect(storyResumeNotice(target)).toContain("no longer exists");
    });

    it("starts the scene when the run never reached a row", () => {
        const target = resolveStoryResumeTarget({ sceneId: "scene-1", trail: [] }, documentWith(["r1"]));

        expect(target).toEqual({ kind: "sceneStart", sceneId: "scene-1" });
    });
});

describe("the launch a reload enters through", () => {
    const request = { storyId: "story-1", sceneId: "scene-1", startBlockId: "r1", snapshotId: "snap-1" };

    it("enters at the row the player was on, carrying the values the run held", () => {
        const built = buildStoryResumeLaunch({
            request,
            resume: resumeState({ sceneId: "scene-1", blockId: "r3", trail: ["r1", "r2", "r3"] }),
            document: documentWith(["r1", "r2", "r3"]),
        });

        expect(built.launchRequest).toEqual({ storyId: "story-1", sceneId: "scene-1", startBlockId: "r3" });
        expect(built.compileRequest.resume).toEqual({
            sceneVariables: { mood: 3 },
            savedVariables: { chapter: "two" },
        });
    });

    it("drops the Scene Snapshot the run was launched with", () => {
        // Its persistent overrides are written into the profile on every compile, so carrying it
        // through each reload would keep overwriting values the player had since chosen.
        const built = buildStoryResumeLaunch({
            request,
            resume: resumeState({ sceneId: "scene-1", blockId: "r1", trail: ["r1"] }),
            document: documentWith(["r1"]),
        });

        expect(built.launchRequest.snapshotId).toBeUndefined();
        expect(built.compileRequest.snapshotId).toBeUndefined();
    });

    it("starts the story's own entry scene when the scene is gone", () => {
        // Not the request it was launched with: that names the scene that has just been deleted, so
        // re-asking for it would fail the compile rather than restart anything.
        const document = documentWith(["r1"]);
        delete (document.scenes as Record<string, unknown>)["scene-1"];
        (document as { entrySceneId?: string }).entrySceneId = "scene-2";

        const built = buildStoryResumeLaunch({
            request,
            resume: resumeState({ sceneId: "scene-1", blockId: "r1", trail: ["r1"] }),
            document,
        });

        expect(built.launchRequest).toEqual({ storyId: "story-1", sceneId: "scene-2" });
        expect(built.compileRequest.resume).toBeUndefined();
        expect(built.target).toEqual({ kind: "entry", reason: "sceneMissing" });
    });

    it("keeps the original launch when there is no entry scene to fall back to", () => {
        const built = buildStoryResumeLaunch({
            request,
            resume: resumeState({ sceneId: "scene-1", blockId: "r1", trail: ["r1"] }),
            document: undefined,
        });

        expect(built.launchRequest).toBe(request);
        expect(built.target).toEqual({ kind: "entry", reason: "storyMissing" });
    });

    it("carries no values into a scene start, which has no pre-pose to lay them on", () => {
        const built = buildStoryResumeLaunch({
            request,
            resume: resumeState({ sceneId: "scene-2", blockId: "gone", trail: ["gone"] }),
            document: documentWith(["r1"]),
        });

        expect(built.launchRequest).toEqual({ storyId: "story-1", sceneId: "scene-2" });
        expect(built.compileRequest.resume).toBeUndefined();
    });

    it("is the plain restart it always was when there is nothing to resume", () => {
        // The title screen: nothing entered a game, so there is no place to keep.
        const built = buildStoryResumeLaunch({ request, resume: null, document: documentWith(["r1"]) });

        expect(built.launchRequest).toBe(request);
        expect(built.compileRequest).toBe(request);
        expect(built.target).toBeNull();
    });
});

describe("the row a relaunch restarts from", () => {
    it("keeps a row the edit kept, and says nothing", () => {
        const resolved = resolveRelaunchStartRow({
            sceneId: "scene-1",
            startBlockId: "r2",
            document: documentWith(["r1", "r2", "r3"]),
        });

        expect(resolved).toEqual({ startBlockId: "r2", notice: null });
    });

    it("restarts the scene from its start when the row is gone, and says so", () => {
        // Deliberately not the resume's "nearest row before it": a relaunch has no trail to walk
        // that does not consist of rows the run reached AFTER the one being asked about.
        const resolved = resolveRelaunchStartRow({
            sceneId: "scene-1",
            startBlockId: "r3",
            document: documentWith(["r1", "r2"]),
        });

        expect(resolved.startBlockId).toBeUndefined();
        expect(resolved.notice).toContain("restarted from the start of the scene");
    });

    it("asks nothing of a relaunch that named no row", () => {
        const resolved = resolveRelaunchStartRow({ sceneId: "scene-1", document: documentWith(["r1"]) });

        expect(resolved).toEqual({ notice: null });
    });

    it("leaves a relaunch into a scene that has gone to the compile", () => {
        // Dropping the row would restart the top of a scene that is not there either, which is a
        // different failure with a worse story: the run would look like it landed somewhere.
        const resolved = resolveRelaunchStartRow({
            sceneId: "scene-gone",
            startBlockId: "r1",
            document: documentWith(["r1"]),
        });

        expect(resolved).toEqual({ startBlockId: "r1", notice: null });
    });
});

describe("re-applying the values a run held", () => {
    it("wins over the stage walk and over a Scene Snapshot", () => {
        // The walk reconstructs what the values would be had the story been played straight through;
        // these are what they actually were, which is the later state of the two.
        const snapshot = {
            sceneVariables: { mood: 0, weather: "rain" },
            savedVariables: { chapter: "one" },
        };

        applyResumeToLaunchSnapshot(snapshot, { sceneVariables: { mood: 3 }, savedVariables: { chapter: "two" } });

        expect(snapshot.sceneVariables).toEqual({ mood: 3, weather: "rain" });
        expect(snapshot.savedVariables).toEqual({ chapter: "two" });
    });
});

describe("what a namespace can carry into a launch", () => {
    it("keeps every value a launch snapshot can state", () => {
        expect(toStoryLiteralRecord({
            text: "hi",
            count: 4,
            flag: false,
            nothing: null,
            list: [1, "two", true],
            nested: { a: 1, b: [null] },
        })).toEqual({
            text: "hi",
            count: 4,
            flag: false,
            nothing: null,
            list: [1, "two", true],
            nested: { a: 1, b: [null] },
        });
    });

    it("drops what it cannot state rather than inventing a stand-in", () => {
        // A dropped key falls back to the variable's declared default at compile time, which is a
        // value the author wrote. A JSON-ish stand-in for a Date would be one nobody wrote.
        expect(toStoryLiteralRecord({
            when: new Date(0),
            missing: undefined,
            broken: Number.NaN,
            fn: () => 1,
            listWithHole: [1, undefined],
            kept: "yes",
        })).toEqual({ kept: "yes" });
    });
});
