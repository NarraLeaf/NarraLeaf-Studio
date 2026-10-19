import { describe, expect, it } from "vitest";
import type { DevModeCharacterSummary } from "@shared/types/devMode";
import type { StoryActionPayload, StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION, groupSameMotionTarget } from "@shared/types/story";
import { compileStudioStoryToNlr, INSTANT_TRANSFORM_MS } from "@/lib/ui-editor/runtime/game/storyCompiler";

/**
 * Three runtime faults found porting a Ren'Py game (2026-10-19), pinned at the compile seam. Each was
 * reproduced first against the real engine in Electron (narraleaf-react 1.5.0, motion 11.18); the
 * runtime itself cannot be driven headlessly here, so these assert the shape the compiler hands it.
 */

type ContentNodeLike = { action: ActionLike | null; getChild: () => ContentNodeLike | null };
type ActionLike = { type: string; contentNode: ContentNodeLike & { getContent: () => unknown[] } };

/** A layered character: three axes, as the ported heroine is built. */
const SU: DevModeCharacterSummary = {
    id: "char-su",
    name: "Su",
    appearance: {
        kind: "layered",
        canvas: { width: 100, height: 200 },
        axes: [
            { id: "skin", name: "skin", tags: [{ id: "skin_base", name: "skin_base" }, { id: "skin_blush", name: "skin_blush" }], defaultTagId: "skin_base" },
            { id: "feet", name: "feet", tags: [{ id: "bare", name: "bare" }], defaultTagId: "bare" },
            { id: "face", name: "face", tags: [{ id: "neutral", name: "neutral" }, { id: "smile", name: "smile" }], defaultTagId: "neutral" },
        ],
        layers: [
            { id: "l-skin", name: "skin", axisId: "skin", options: { skin_base: "asset-skin", skin_blush: "asset-blush" } },
            { id: "l-feet", name: "feet", axisId: "feet", options: { bare: "asset-feet" } },
            { id: "l-face", name: "face", axisId: "face", options: { neutral: "asset-neutral", smile: "asset-smile" } },
        ],
    } as DevModeCharacterSummary["appearance"],
    entranceTransform: { zoom: 0.45, scaleX: -1, position: { xalign: 0.5, yalign: 0.5, yoffset: -451 } },
};

function action(id: string, payload: Record<string, unknown>, parentId: string | null = null): StoryBlock {
    return { id, kind: "action", parentId, childrenIds: [], payload: payload as StoryActionPayload } as StoryBlock;
}

function narration(id: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "narration", text: { textId: `text-${id}`, value: "Line.", role: "narration" } },
    } as StoryBlock;
}

const enter = (id: string, transform?: Record<string, unknown>) =>
    action(id, { action: "character", operation: "enter", characterId: "char-su", tags: { face: "smile" }, ...(transform ? { transform } : {}) });
const exit = (id: string) =>
    action(id, { action: "character", operation: "exit", characterId: "char-su", transform: { to: { opacity: 0 }, durationMs: 250 } });
const expression = (id: string, tags: Record<string, string>, parentId: string | null) =>
    action(id, { action: "character", operation: "expression", characterId: "char-su", tags, transition: { kind: "dissolve", durationMs: 500 } }, parentId);
const transformRow = (id: string, transform: Record<string, unknown>) =>
    action(id, { action: "displayable", operation: "transform", target: { kind: "character", name: "char-su", label: "Su" }, transform });

function documentOf(rows: StoryBlock[]): StoryDocument {
    const blocks = Object.fromEntries(rows.map(row => [row.id, row]));
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
                blocks,
            },
        },
    } as StoryDocument;
}

async function compile(rows: StoryBlock[]) {
    const compiled = await compileStudioStoryToNlr({
        document: documentOf(rows),
        sceneId: "scene-1",
        characters: [SU],
        resolveAssetUrl: async assetId => `nlr://${assetId}`,
    });
    expect(compiled.diagnostics).toEqual([]);
    return compiled;
}

/** The row's own actions, in the order it emitted them. */
function actionsOfRow(compiled: Awaited<ReturnType<typeof compile>>, blockId: string): ActionLike[] {
    return compiled.actionIdBindings
        .filter(binding => binding.blockId === blockId && binding.staticId.startsWith("studio:"))
        .map(binding => binding.action as unknown as ActionLike);
}

function bodyOf(action: ActionLike): ActionLike[] {
    return action.contentNode.getContent()[0] as ActionLike[];
}

/** Every action a chained body runs, following the links it is built from. */
function runFrom(action: ActionLike): string[] {
    const types: string[] = [];
    let node: ContentNodeLike | null = action.contentNode;
    while (node && types.length < 32) {
        if (node.action) {
            types.push(node.action.type);
        }
        node = node.getChild();
    }
    return types;
}

/**
 * Every action a branch runs that moves something, once each, through the `control:do` wrappers a
 * row's chain is held in. `image:flush` is the repaint a tag change asks for, not a step of its own.
 */
function typesUnder(action: ActionLike): string[] {
    const seen = new Set<ActionLike>();
    const types: string[] = [];
    const walk = (start: ActionLike): void => {
        let node: ContentNodeLike | null = start.contentNode;
        while (node) {
            const current: ActionLike | null = node.action;
            if (current && !seen.has(current)) {
                seen.add(current);
                if (current.type.startsWith("control:")) {
                    bodyOf(current).forEach(walk);
                } else if (current.type !== "image:flush") {
                    types.push(current.type);
                }
            }
            node = node.getChild();
        }
    };
    walk(action);
    return types;
}

type TransformLike = { sequences?: { props?: Record<string, unknown>; options?: Record<string, unknown> }[] };

function transformsOfRow(compiled: Awaited<ReturnType<typeof compile>>, blockId: string): TransformLike[] {
    return actionsOfRow(compiled, blockId)
        .filter(action => action.type === "displayable:applyTransform")
        .map(action => action.contentNode.getContent()[0] as TransformLike);
}

describe("two rows in one parallel group on the same stage element", () => {
    function parallelDocumentRows(children: StoryBlock[]): StoryBlock[] {
        const group = {
            id: "g",
            kind: "control",
            parentId: null,
            childrenIds: children.map(child => child.id),
            payload: { control: "parallel", mode: "all" },
        } as unknown as StoryBlock;
        return [enter("enter"), group, ...children, narration("after")];
    }

    it("runs them as one branch, in order, instead of two branches that take the element from each other", async () => {
        // Two `/char` rows with `t=` on one layered character in a `/parallel`. As two branches the
        // second transition took the element over before the first had started, the first never
        // completed, and `Control.all` waited on it for ever: the story stopped with the dialogue
        // box gone and nothing in the console.
        const compiled = await compile(parallelDocumentRows([
            expression("smile", { face: "smile" }, "g"),
            expression("blush", { skin: "skin_blush" }, "g"),
        ]));
        const [group] = actionsOfRow(compiled, "g");
        const branches = bodyOf(group);

        expect(branches).toHaveLength(1);
        expect(branches[0].type).toBe("control:do");
        expect(typesUnder(branches[0])).toEqual(["image:setAppearance", "image:setAppearance"]);
        // The engine refuses a branch carrying a link of its own (`checkActionChain`).
        expect(branches[0].contentNode.getChild()).toBeFalsy();
    });

    it("keeps rows on different elements side by side", async () => {
        const compiled = await compile(parallelDocumentRows([
            expression("smile", { face: "smile" }, "g"),
            action("cam", { action: "camera", operation: "transform", transform: { to: { zoom: 1.1 }, durationMs: 500 } }, "g"),
        ]));
        const branches = bodyOf(actionsOfRow(compiled, "g")[0]);

        expect(branches.map(branch => typesUnder(branch))).toEqual([["image:setAppearance"], ["displayable:applyTransform"]]);
    });

    it("groups by element, keeping each group in document order", () => {
        const rows = parallelDocumentRows([
            expression("a", { face: "smile" }, "g"),
            action("cam", { action: "camera", operation: "transform", transform: { to: { zoom: 1.1 } } }, "g"),
            transformRow("b", { to: { opacity: 0.5 } }),
            expression("c", { skin: "skin_blush" }, "g"),
        ]);
        const scene = documentOf(rows).scenes["scene-1"];

        // `/char Su` and `/transform Su` are one element: a portrait is an Image either way.
        expect(groupSameMotionTarget(scene, ["a", "cam", "b", "c"])).toEqual([["a", "b", "c"], ["cam"]]);
    });
});

describe("an instant transform followed by an animated one", () => {
    it("never hands the engine a zero duration", async () => {
        // `opacity=0.3` then `opacity=1 d=0.5`: under a zero duration `motion` wrote the style but
        // kept its own record of the channel at 1, so the second row saw nothing to animate and the
        // sprite stayed at 0.3 for the rest of the scene (and invisible, when the first said 0).
        const compiled = await compile([
            enter("enter", { to: { position: { xalign: 0.5, yalign: 0.5 } }, durationMs: 300 }),
            transformRow("dim", { to: { opacity: 0.3 } }),
            transformRow("back", { to: { opacity: 1 }, durationMs: 500 }),
            narration("after"),
        ]);
        const [dim] = transformsOfRow(compiled, "dim");
        const [back] = transformsOfRow(compiled, "back");

        expect(INSTANT_TRANSFORM_MS).toBeGreaterThan(0);
        expect(dim.sequences?.[0]?.props).toEqual({ opacity: 0.3 });
        expect(dim.sequences?.[0]?.options?.duration).toBe(INSTANT_TRANSFORM_MS);
        expect(back.sequences?.[0]?.options?.duration).toBe(500);
    });

    it("floors the instant halves too - the show before a pose and a discrete cut", async () => {
        const compiled = await compile([
            enter("enter"),
            transformRow("snap", { to: { position: { xalign: 0.2 }, mixBlendMode: "multiply" } }),
        ]);
        const durations = transformsOfRow(compiled, "snap").flatMap(transform => transform.sequences?.map(sequence => sequence.options?.duration) ?? []);

        expect(durations.length).toBeGreaterThan(0);
        expect(durations.every(duration => typeof duration === "number" && duration > 0)).toBe(true);
    });
});

describe("a mirrored character re-entering without pos=", () => {
    it("comes back to the entrance position, mirror kept", async () => {
        // Reported as landing at 1 − 0.2677 after a `pos=0.2677` entrance and a hide. The compile
        // sends the entrance position, and the real engine plays it there (measured: x = 0.5); this
        // pins the compile half so a regression here cannot pass for an engine fault.
        const compiled = await compile([
            enter("first", { to: { position: { xalign: 0.2677, yalign: 0.5 } }, durationMs: 300 }),
            exit("hide"),
            enter("again", { to: { opacity: 1 }, durationMs: 500 }),
            narration("after"),
        ]);
        const props = transformsOfRow(compiled, "again").flatMap(transform => transform.sequences?.map(sequence => sequence.props ?? {}) ?? []);

        expect(props).toEqual([expect.objectContaining({
            opacity: 1,
            zoom: 0.45,
            scaleX: -1,
            position: { xalign: 0.5, yalign: 0.5, yoffset: -451 },
        })]);
    });
});

describe("a show that states its own opacity", () => {
    it("fades from hidden to that opacity, never flashing to full first", async () => {
        // `/show sign opacity=0.5 in=fade d=0.5` used to run an instant show to 1 and then fade DOWN to
        // 0.5. The stated opacity is the reveal, so it goes straight there with the pose.
        const compiled = await compile([
            action("create", { action: "image", operation: "create", objectName: "sign", assetId: "asset-sign" }),
            action("show", {
                action: "image",
                operation: "show",
                objectName: "sign",
                transform: { to: { opacity: 0.5, position: { xalign: 0.3, yalign: 0.5 } }, durationMs: 500 },
            }),
            narration("after"),
        ]);
        const sequences = transformsOfRow(compiled, "show").flatMap(transform => transform.sequences ?? []);

        expect(sequences.some(sequence => sequence.props?.opacity === 1)).toBe(false);
        expect(sequences).toEqual([expect.objectContaining({
            props: expect.objectContaining({ opacity: 0.5 }),
            options: expect.objectContaining({ duration: 500 }),
        })]);
    });
});
