import { describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryBlock, type StoryDocument } from "@shared/types/story";
import { compileStagePreviewToNlr, compileStudioStoryToNlr } from "./storyCompiler";
import { computeStoryStageSnapshot } from "./storyStageSnapshot";

/**
 * A row-precise launch opens with the speaker names the rows before it gave.
 *
 * "Play from this row" - and a save made in such a session, which is put back at its row through the
 * same walk - builds an opening scene in place of the rows before the target. That scene used to
 * leave every `/rename` behind, so a line written for "？？？" was spoken under the cast's name. The
 * opening now replays, for each character, the last `/rename` the walked path passed.
 */

type Compiled = Awaited<ReturnType<typeof compileStudioStoryToNlr>>;

const SCENE = "scene-1";

function row(id: string, payload: Record<string, unknown>, kind: StoryBlock["kind"] = "action"): StoryBlock {
    return { id, kind, parentId: null, childrenIds: [], payload } as StoryBlock;
}

const line = (id: string) => row(id, { action: "narration", text: { textId: `${id}-text`, value: id, role: "narration" } }, "nodeAction");
const rename = (id: string, characterId: string, displayName: string) =>
    row(id, { action: "character", operation: "setName", characterId, displayName });

function document(rows: StoryBlock[]): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "chapter-1", name: "Chapter", sceneIds: [SCENE] }],
        scenes: {
            [SCENE]: {
                id: SCENE,
                name: "Scene 1",
                runtimeName: "Scene 1",
                rootBlockIds: rows.map(entry => entry.id),
                blocks: Object.fromEntries(rows.map(entry => [entry.id, entry])),
            },
        },
    } as StoryDocument;
}

async function launchAt(doc: StoryDocument, targetBlockId: string): Promise<Compiled> {
    return compileStudioStoryToNlr({
        document: doc,
        sceneId: SCENE,
        resolveAssetUrl: (assetId: string) => `test://${assetId}`,
        launch: {
            targetBlockId,
            snapshot: computeStoryStageSnapshot({ document: doc, sceneId: SCENE, targetBlockId }),
        },
    });
}

async function previewAt(doc: StoryDocument, targetBlockId: string): Promise<Compiled> {
    return compileStagePreviewToNlr({
        document: doc,
        sceneId: SCENE,
        snapshot: computeStoryStageSnapshot({ document: doc, sceneId: SCENE, targetBlockId }),
        targetBlockId,
        resolveAssetUrl: (assetId: string) => `test://${assetId}`,
        onBeforeTarget: () => {},
        onAfterTarget: () => {},
    });
}

type EngineAction = { type: string; callee: unknown; contentNode?: { getContent(): unknown[] } };

/** What the opening scene runs that no row recorded: the launch's (or the preview's) own setup. */
function setupActions(compiled: Compiled): EngineAction[] {
    const story = compiled.story as unknown as { constructStory(): void };
    story.constructStory();
    const scene = compiled.scene as unknown as {
        getAllChildren(story: unknown, root: unknown, options: { allowFutureScene: boolean }): EngineAction[];
        getSceneRoot(): unknown;
    };
    const recorded = new Set(compiled.actionIdBindings.map(binding => binding.action as unknown));
    return scene.getAllChildren(compiled.story, scene.getSceneRoot(), { allowFutureScene: false })
        .filter(action => !recorded.has(action));
}

/** The setup's renames, as `character id -> name`, in order. */
function renameSetup(compiled: Compiled): string[] {
    return setupActions(compiled)
        .filter(action => action.type === "character:setName")
        .map(action => {
            const [name] = action.contentNode!.getContent() as [string];
            return `${(action.callee as { getId(): string | null }).getId()} -> ${name}`;
        });
}

const errors = (compiled: Compiled) => compiled.diagnostics.filter(entry => entry.level === "error");

describe("a row-precise launch and /rename", () => {
    const rows = [
        rename("hide", "char-alice", "？？？"),
        line("first"),
        rename("reveal", "char-alice", "Alice"),
        rename("bob", "char-bob", "Mr. B"),
        line("second"),
    ];

    it("opens with the name a /rename before the target gave, on the character it renamed", async () => {
        const compiled = await launchAt(document(rows), "first");

        expect(errors(compiled)).toEqual([]);
        expect(renameSetup(compiled)).toEqual(["nl:character:char-alice -> ？？？"]);
    });

    it("replays only each character's last /rename", async () => {
        const compiled = await launchAt(document(rows), "second");

        expect(renameSetup(compiled)).toEqual([
            "nl:character:char-alice -> Alice",
            "nl:character:char-bob -> Mr. B",
        ]);
    });

    it("replays nothing when no /rename came before the target", async () => {
        const compiled = await launchAt(document([line("first"), rename("late", "char-alice", "？？？"), line("second")]), "first");

        expect(renameSetup(compiled)).toEqual([]);
    });
});

describe("a row's preview and /rename", () => {
    it("shows the line under the name the rows before it gave", async () => {
        const compiled = await previewAt(document([rename("hide", "char-alice", "？？？"), line("target")]), "target");

        expect(renameSetup(compiled)).toEqual(["nl:character:char-alice -> ？？？"]);
    });
});
