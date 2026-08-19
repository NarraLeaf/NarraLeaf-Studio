import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { parseCommandLine } from "@/apps/workspace/modules/story/scene-editor/storyCommandParser";
import { resolveCommandLine, type StoryCommandContext } from "@/apps/workspace/modules/story/scene-editor/storyCommandResolution";
import { getCommandSpec } from "@/apps/workspace/modules/story/scene-editor/commands/registry";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";

/**
 * **The camera's six lens channels, from the line an author types to the props the engine is handed.**
 *
 * This starts at `parseCommandLine` rather than at a hand-built payload on purpose. A lens channel
 * can be lost at four different places - the vocabulary, the spec's `build`, the cut/tween split, and
 * the emitter - and each of them loses it SILENTLY: no diagnostic, a row that still reads back
 * correctly in the editor, and a stage that does nothing. A test that starts halfway down cannot tell
 * which half is at fault, which is exactly the position a `vignette=` that "did not work" left us in.
 *
 * Two of the four did lose one. `emitCutProps` builds its leftover bag from a literal list of keys,
 * and the lens's DRESSING - the two colours and the two falloff stops, which are discrete and so
 * always cut - was not in it: `/transform camera vignetteInner=30 vignetteOuter=70` compiled to no
 * statement at all, and `vignette=0.6 vignetteInner=30` kept only the strength.
 *
 * The two STRENGTHS were always emitted correctly; what swallowed those was an engine defect
 * (`narraleaf-react`: a lifecycle `reset()` replaced the element's `TransformState` object, so the
 * mounted host animated an orphan and the settled repaint wiped the lens plates back to neutral).
 * They are pinned here anyway, because this file is where the boundary is stated: everything below
 * these assertions is the engine's to answer for.
 */

const CONTEXT = {
    images: [], audio: [], videos: [], characters: [], tempSpeakers: [], scenes: [],
    choiceOptions: [], valueBlueprints: [], audioTracks: [], labels: [], appTags: [], variables: [],
    appearanceByCharacterId: {}, puppetCharacterIds: [], puppetByCharacterId: {},
    stageObjects: { image: [], text: [], layer: [], video: [], audio: [], vfx: [] },
} as unknown as StoryCommandContext;

let nextId = 0;
const generateId = () => `lens_${nextId++}`;

/** Parse → resolve → build: the exact path pressing Enter on a command line takes. */
function buildRow(source: string): StoryBlock {
    const line = parseCommandLine(source);
    if (line.kind !== "command" || !line.def) {
        throw new Error(`not a command: ${source}`);
    }
    expect(line.issues, source).toEqual([]);
    const { args, issues } = resolveCommandLine(line, CONTEXT);
    expect(issues, source).toEqual([]);
    const spec = getCommandSpec(line.def.commandId);
    if (!spec?.build) {
        throw new Error(`no build on ${line.def.commandId}`);
    }
    return spec.build(args, { generateId, context: CONTEXT });
}

function documentOf(block: StoryBlock): StoryDocument {
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
                rootBlockIds: [block.id],
                blocks: { [block.id]: { ...block, parentId: null, childrenIds: [] } },
            },
        },
    };
}

function collectActionTree(action: any, story: unknown, seen = new Set<any>()): any[] {
    if (!action || seen.has(action)) {
        return [];
    }
    seen.add(action);
    const children = typeof action.getFutureActions === "function"
        ? action.getFutureActions(story, { allowFutureScene: true })
        : [];
    return [action, ...children.flatMap((child: any) => collectActionTree(child, story, seen))];
}

/** Every `Transform` the row hands the engine, as `{props, options}` pairs in statement order. */
async function transformsOf(source: string): Promise<{ props: Record<string, unknown>; options: Record<string, unknown> }[]> {
    const block = buildRow(source);
    const compiled = await compileStudioStoryToNlr({ document: documentOf(block), sceneId: "scene-1" });
    expect(compiled.diagnostics, source).toEqual([]);
    return compiled.actionIdBindings
        .filter(binding => binding.blockId === block.id)
        .flatMap(binding => collectActionTree(binding.action, compiled.story))
        .filter(action => action?.type === "displayable:applyTransform")
        .flatMap(action => {
            const transform = action.contentNode?.getContent?.()[0] as { sequences?: { props: Record<string, unknown>; options: Record<string, unknown> }[] } | undefined;
            return transform?.sequences ?? [];
        });
}

describe("a camera row hands its lens channels to the engine", () => {
    it("tweens a vignette alongside the pose it shares a row with", async () => {
        // The row the defect was measured on. `zoom` and `vignette` are both continuous, so they
        // belong to ONE eased statement - a lens that arrived in a second statement would be a
        // different shot, not the same one.
        const transforms = await transformsOf("/transform camera zoom=2 vignette=0.72 d=1");
        expect(transforms).toHaveLength(1);
        expect(transforms[0].props).toEqual({ zoom: 2, vignette: 0.72 });
        expect(transforms[0].options).toEqual(expect.objectContaining({ duration: 1000 }));
    });

    it("tweens a shutter, which is the same kind of channel", async () => {
        const transforms = await transformsOf("/transform camera shutter=1 d=1");
        expect(transforms).toHaveLength(1);
        expect(transforms[0].props).toEqual({ shutter: 1 });
    });

    /**
     * A gesture is three keyframes rather than a destination, so it is one Transform carrying the
     * whole in/hold/out - three awaited statements would settle and restart at every joint, which is
     * visible as a hitch mid-blink.
     */
    it("plays a named gesture as one keyframed statement that returns the channel to zero", async () => {
        const transforms = await transformsOf("/transform camera lens=blink");
        expect(transforms).toHaveLength(3);
        expect(transforms.map(step => step.props.shutter)).toEqual([1, 1, 0]);
    });

    it("emits the falloff geometry, which cuts, in its own zero-duration statement", async () => {
        const transforms = await transformsOf("/transform camera vignetteInner=30 vignetteOuter=70");
        expect(transforms).toHaveLength(1);
        expect(transforms[0].props).toEqual({ vignetteInner: "30%", vignetteOuter: "70%" });
        expect(transforms[0].options).toEqual(expect.objectContaining({ duration: 0 }));
    });

    it("emits the lens colours, which cut for the same reason a mask image does", async () => {
        const shutter = await transformsOf("/transform camera shutterColor=#ff0000");
        expect(shutter[0]?.props).toEqual({ shutterColor: "#ff0000" });

        const vignette = await transformsOf("/transform camera vignetteColor=#1a0b2e");
        expect(vignette[0]?.props).toEqual({ vignetteColor: "#1a0b2e" });
    });

    /**
     * The row that lost the most, and the reason the dressing is worth its own assertions: the
     * strength tweened and looked like the row had worked, while the geometry beside it was dropped
     * on the floor with no diagnostic. The dressing must land FIRST and instantly, so the strength
     * fades in through the falloff the row asked for rather than through the previous one.
     */
    it("cuts the dressing before easing the strength when one row states both", async () => {
        const transforms = await transformsOf("/transform camera vignette=0.6 vignetteInner=30 vignetteOuter=70 d=1");
        expect(transforms).toHaveLength(2);
        expect(transforms[0].props).toEqual({ vignetteInner: "30%", vignetteOuter: "70%" });
        expect(transforms[0].options).toEqual(expect.objectContaining({ duration: 0 }));
        expect(transforms[1].props).toEqual({ vignette: 0.6 });
        expect(transforms[1].options).toEqual(expect.objectContaining({ duration: 1000 }));
    });

    it("puts the whole lens back when the row clears it", async () => {
        const transforms = await transformsOf("/transform camera lens=none");
        expect(transforms).toHaveLength(1);
        expect(transforms[0].props).toEqual(expect.objectContaining({
            shutter: 0,
            vignette: 0,
        }));
    });
});
