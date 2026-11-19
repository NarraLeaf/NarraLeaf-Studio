import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryAnimationAsset, StoryAnimationTimeline, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { decodeStoryMotionExchange, encodeStoryMotionExchange } from "@shared/story/libraryExchange";
import { deleteStoryMotionKeyframe, deleteStoryMotionTrack, getStoryMotionTimeline } from "@/apps/workspace/modules/story-motion/storyMotionTimeline";
import { deleteStoryMotionKeyframes } from "@/apps/workspace/modules/story-motion/storyMotionEditing";
import { storyTransformRefFinalProps } from "@/lib/ui-editor/runtime/game/storyTransformProps";
import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import { HistoryService } from "../history/HistoryService";
import { storyMotionHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import { StoryService } from "./StoryService";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

const temporaryDirectories: string[] = [];
afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function createHarness() {
    const root = await mkdtemp(join(tmpdir(), "nls-motion-timeline-"));
    temporaryDirectories.push(root);
    const history = new HistoryService();
    let nextId = 0;
    const exists = async (path: string) => stat(path).then(() => true, () => false);
    const fs = {
        isDirExists: async (path: string) => ({ ok: true as const, data: await exists(path) }),
        isFileExists: async (path: string) => ({ ok: true as const, data: await exists(path) }),
        createDir: async (path: string) => {
            await mkdir(path, { recursive: true });
            return { ok: true as const, data: undefined };
        },
        writeFileNoFollowOrCreate: async (path: string, text: string) => {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, text, "utf8");
            return { ok: true as const, data: undefined };
        },
        readJSON: async (path: string) => {
            const data = await readFile(path, "utf8").catch(() => null);
            return data === null
                ? { ok: false as const, error: { code: "NOT_FOUND", message: "missing" } }
                : { ok: true as const, data: JSON.parse(data) };
        },
    };
    const context = {
        project: { resolve: (...parts: (string | string[])[]) => join(root, ...parts.flat()) },
        services: {
            get(id: Services) {
                if (id === Services.History) return history;
                if (id === Services.FileSystem) return fs;
                if (id === Services.Uuid) return { generate: () => `00000000-0000-4000-8000-${(++nextId).toString(16).padStart(12, "0")}` };
                if (id === Services.Project) return {};
                throw new Error(`Unexpected service ${id}`);
            },
        },
        commandLineRun: false,
    } as never;
    history.setContext(context);
    const service = () => {
        const next = new StoryService();
        next.setContext(context);
        return next;
    };
    return { root, history, service };
}

describe("empty story motion timeline", () => {
    it.each([
        ["the track", (timeline: StoryAnimationTimeline) => deleteStoryMotionTrack(timeline, "rotation")],
        ["the selected keyframe", (timeline: StoryAnimationTimeline) => deleteStoryMotionKeyframes(timeline, new Set(["key"]))],
        ["the inspector keyframe", (timeline: StoryAnimationTimeline) => deleteStoryMotionKeyframe(timeline, "key")],
    ])("survives deleting %s, saving, reopening, and undo/redo", async (_action, remove) => {
        const { root, history, service } = await createHarness();
        let currentService = service();
        await currentService.loadAnimationIndex();
        const created = await currentService.createAnimationAsset({
            name: "Rotation",
            timeline: { tracks: [{ id: "rotation", property: "rotation", keyframes: [{ id: "key", timeMs: 100, value: 30 }] }] },
            sequences: [{ id: "old", props: { opacity: 0.25 }, options: { durationMs: 100 } }],
        });
        await currentService.flushPendingChanges();
        const before = structuredClone(getStoryMotionTimeline(created));
        const scope = storyMotionHistoryScope(created.id);
        history.registerScope<StoryAnimationTimeline>({
            id: scope,
            label: { key: "workspace.history.scope.storyMotion" },
            capture: () => getStoryMotionTimeline(currentService.getLoadedAnimationAsset(created.id)),
            apply: timeline => { currentService.updateAnimationAsset(created.id, asset => ({ ...asset, timeline })); },
        });

        const edited = currentService.updateAnimationAsset(created.id, asset => ({
            ...asset,
            timeline: remove(getStoryMotionTimeline(asset)),
        }));
        history.checkpoint(scope, { label: { key: "workspace.history.entry.storyMotionEdit" }, before });
        expect(edited.timeline?.tracks).toEqual([]);
        await currentService.flushPendingChanges();

        const saved = JSON.parse(await readFile(join(root, "editor/story/animations", `${created.id}.json`), "utf8")) as StoryAnimationAsset;
        expect(saved.timeline?.tracks).toEqual([]);
        expect(storyTransformRefFinalProps({ mode: "animation", animationId: created.id }, "none", new Map([[created.id, saved]]))).toEqual({});
        expect(storyTransformRefFinalProps({ mode: "animation", animationId: created.id }, "show", new Map([[created.id, saved]]))).toEqual({ opacity: 1 });
        expect(storyTransformRefFinalProps({ mode: "animation", animationId: created.id }, "hide", new Map([[created.id, saved]]))).toEqual({ opacity: 0 });

        currentService = service();
        await currentService.loadAnimationIndex();
        const reloaded = await currentService.loadAnimationAsset(created.id);
        expect(reloaded.timeline?.tracks).toEqual([]);
        expect(history.undo(scope)).toBe(true);
        expect(currentService.getLoadedAnimationAsset(created.id)?.timeline?.tracks).toEqual(before.tracks);
        expect(history.redo(scope)).toBe(true);
        expect(currentService.getLoadedAnimationAsset(created.id)?.timeline?.tracks).toEqual([]);
        await currentService.flushPendingChanges();

        const reopened = service();
        await reopened.loadAnimationIndex();
        expect((await reopened.loadAnimationAsset(created.id)).timeline?.tracks).toEqual([]);
    });

    it("exports and imports an empty motion without recreating movement", async () => {
        const { service } = await createHarness();
        const first = service();
        await first.loadAnimationIndex();
        const asset = await first.createAnimationAsset({ name: "Empty", timeline: { tracks: [] } });
        const decoded = decodeStoryMotionExchange(encodeStoryMotionExchange([asset]));
        expect(decoded.ok).toBe(true);
        if (!decoded.ok) return;
        const imported = await first.createAnimationAsset(decoded.items[0]);
        expect(imported.timeline?.tracks).toEqual([]);
        expect(storyTransformRefFinalProps({ mode: "animation", animationId: imported.id }, "none", new Map([[imported.id, imported]]))).toEqual({});
        await first.flushPendingChanges();
    });

    it("compiles an empty camera motion without replaying its legacy sequence", async () => {
        const { service } = await createHarness();
        const story = service();
        await story.loadAnimationIndex();
        const asset = await story.createAnimationAsset({
            name: "Camera",
            targetKind: "camera",
            timeline: { tracks: [] },
            sequences: [{ id: "old", props: { zoom: 2 }, options: { durationMs: 900 } }],
        });
        const document: StoryDocument = {
            schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
            id: "story",
            name: "Story",
            chapters: [{ id: "chapter", name: "Chapter", sceneIds: ["scene"] }],
            scenes: {
                scene: {
                    id: "scene", name: "Scene", runtimeName: "scene", rootBlockIds: ["camera"],
                    blocks: {
                        camera: {
                            id: "camera", kind: "action", parentId: null, childrenIds: [],
                            payload: { action: "camera", operation: "transform", transform: { mode: "animation", animationId: asset.id } },
                        },
                    },
                },
            },
        };
        const compiled = await compileStudioStoryToNlr({
            document, sceneId: "scene", animations: { [asset.id]: asset },
            resolveAssetUrl: async assetId => `asset://${assetId}`,
        });
        expect(compiled.diagnostics).toEqual([]);
        const actions = compiled.actionIdBindings
            .filter(binding => binding.blockId === "camera")
            .map(binding => binding.action as { type?: string; contentNode?: { getContent?: () => unknown[] } });
        const transforms = actions.filter(action => action.type === "displayable:applyTransform")
            .map(action => action.contentNode?.getContent?.()[0] as { sequences?: { props: unknown; options: unknown }[] });
        expect(transforms).toHaveLength(1);
        expect(transforms[0].sequences?.[0]).toMatchObject({ props: {}, options: { duration: 0 } });
        expect(transforms[0].sequences?.[0].props).toEqual({});
        await story.flushPendingChanges();
    });
});
