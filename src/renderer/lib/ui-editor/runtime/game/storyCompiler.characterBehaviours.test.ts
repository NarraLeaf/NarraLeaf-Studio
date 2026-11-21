import { describe, expect, it } from "vitest";
import type { DevModeCharacterSummary } from "@shared/types/devMode";
import type { StoryActionPayload, StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import { computeStoryStageSnapshot } from "@/lib/ui-editor/runtime/game/storyStageSnapshot";

/**
 * Character behaviours at the compile seam: the rows a character runs when it starts and stops
 * speaking are compiled in front of each line, named after that line, and left out where a
 * hand-written row at the same line sets the same channel. The stage walk applies the same rows,
 * so a launch from a mid-scene line is posed the way play would have left it.
 */

function action(id: string, payload: Record<string, unknown>, parentId: string | null = null): StoryBlock {
    return { id, kind: "action", parentId, childrenIds: [], payload: payload as StoryActionPayload } as StoryBlock;
}

function line(id: string, characterId?: string, extra: Record<string, unknown> = {}): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: characterId
            ? { action: "dialogue", characterId, text: { textId: `text-${id}`, value: "Line.", role: "dialogue" }, ...extra }
            : { action: "narration", text: { textId: `text-${id}`, value: "Line.", role: "narration" }, ...extra },
    } as StoryBlock;
}

const zoomTo = (id: string, characterId: string, zoom: number) =>
    action(id, { action: "character", operation: "move", characterId, transform: { mode: "props", to: { zoom }, durationMs: 300 } });

function character(id: string, name: string, behaviours?: DevModeCharacterSummary["behaviours"]): DevModeCharacterSummary {
    return {
        id,
        name,
        appearance: { kind: "preset", poses: [{ id: `${id}-pose`, name: "default", assetId: `${id}-asset` }] } as unknown as DevModeCharacterSummary["appearance"],
        ...(behaviours ? { behaviours } : {}),
    };
}

const ALICE = character("alice", "Alice", {
    startSpeaking: [zoomTo("grow", "alice", 1.05)],
    stopSpeaking: [zoomTo("shrink", "alice", 1)],
});
const BOB = character("bob", "Bob");

function documentOf(rows: StoryBlock[]): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: ["scene-1"] }],
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "Scene 1",
                runtimeName: "Scene 1",
                rootBlockIds: rows.filter(row => row.parentId === null).map(row => row.id),
                blocks: Object.fromEntries(rows.map(row => [row.id, row])),
            },
        },
    } as StoryDocument;
}

async function compile(rows: StoryBlock[]) {
    const compiled = await compileStudioStoryToNlr({
        document: documentOf(rows),
        sceneId: "scene-1",
        characters: [ALICE, BOB],
        resolveAssetUrl: async assetId => `nlr://${assetId}`,
    });
    expect(compiled.diagnostics).toEqual([]);
    return compiled;
}

/** The behaviour rows compiled for a line, by their row id, as the line's own bindings name them. */
function behaviourRowsAt(compiled: Awaited<ReturnType<typeof compile>>, lineId: string): string[] {
    const rows = new Set<string>();
    for (const binding of compiled.actionIdBindings) {
        const match = binding.staticId.match(new RegExp(`:${lineId}~alice~(\\w+)~(\\w+):`));
        if (match) {
            // Re-attributed to the line an author can open, never left on the synthetic row.
            expect(binding.blockId).toBe(lineId);
            rows.add(`${match[1]}:${match[2]}`);
        }
    }
    return [...rows];
}

describe("character behaviours in a compiled scene", () => {
    const enter = (id: string, characterId: string) => action(id, { action: "character", operation: "enter", characterId });

    it("compiles the speaker's start and the previous speaker's stop in front of each line", async () => {
        const compiled = await compile([
            enter("in-a", "alice"),
            enter("in-b", "bob"),
            line("l1", "alice"),
            line("l2", "bob"),
            line("l3"),
        ]);
        expect(behaviourRowsAt(compiled, "l1")).toEqual(["startSpeaking:grow"]);
        // Every line carries the stop: who held the floor before it is play's answer, not the compile's.
        expect(behaviourRowsAt(compiled, "l2")).toEqual(["stopSpeaking:shrink"]);
        expect(behaviourRowsAt(compiled, "l3")).toEqual(["stopSpeaking:shrink"]);
    });

    it("leaves out a behaviour row a hand-written row at the same line overrides", async () => {
        const compiled = await compile([
            enter("in-a", "alice"),
            zoomTo("hand", "alice", 1.3),
            line("l1", "alice"),
        ]);
        expect(behaviourRowsAt(compiled, "l1")).toEqual([]);
    });

    it("compiles nothing for a line that opts out, or before the character was ever put on stage", async () => {
        const compiled = await compile([
            line("early", "alice"),
            enter("in-a", "alice"),
            line("l1", "alice", { skipCharacterBehaviours: true }),
        ]);
        expect(behaviourRowsAt(compiled, "early")).toEqual([]);
        expect(behaviourRowsAt(compiled, "l1")).toEqual([]);
    });
});

describe("character behaviours in the stage walk", () => {
    const enter = (id: string, characterId: string) => action(id, { action: "character", operation: "enter", characterId });
    const zoomOf = (snapshot: ReturnType<typeof computeStoryStageSnapshot>, name: string) =>
        snapshot.displayables.find(record => record.objectName === name)?.props.zoom;

    it("poses the stage and the floor the way play leaves them before the target", () => {
        const document = documentOf([enter("in-a", "alice"), enter("in-b", "bob"), line("l1", "alice"), line("l2", "alice"), line("target", "bob")]);
        const atTarget = computeStoryStageSnapshot({ document, sceneId: "scene-1", targetBlockId: "target", characters: [ALICE, BOB] });
        expect(zoomOf(atTarget, "alice")).toBe(1.05);
        expect(atTarget.behaviourFloor).toBe("alice");
        expect(atTarget.behaviourPresence).toEqual(["alice"]);

        const after = computeStoryStageSnapshot({
            document: documentOf([enter("in-a", "alice"), line("l1", "alice"), line("l2", "bob"), line("target")]),
            sceneId: "scene-1",
            targetBlockId: "target",
            characters: [ALICE, BOB],
        });
        expect(zoomOf(after, "alice")).toBe(1);
        expect(after.behaviourFloor).toBe("bob");
    });

    it("runs nothing for a character who is not on stage", () => {
        const document = documentOf([line("l1", "alice"), enter("in-a", "alice"), line("target")]);
        const snapshot = computeStoryStageSnapshot({ document, sceneId: "scene-1", targetBlockId: "target", characters: [ALICE] });
        expect(zoomOf(snapshot, "alice")).toBeUndefined();
    });
});
