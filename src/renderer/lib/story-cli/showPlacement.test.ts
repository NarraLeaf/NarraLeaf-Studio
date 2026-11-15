import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DevTools } from "narraleaf-react";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryBlock, type StoryDocument } from "@shared/types/story";
import { computeStoryStageSnapshot } from "@/lib/ui-editor/runtime/game/storyStageSnapshot";
import { compileStagePreviewToNlr, compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import { runCli } from "./cli";

const STORY_ID = "11111111-1111-4111-8111-111111111111";
const CHAPTER_ID = "22222222-2222-4222-8222-222222222222";
const SCENE_ID = "33333333-3333-4333-8333-333333333333";
const IMAGE_ID = "44444444-4444-4444-8444-444444444444";

let projectDir = "";

function writeJson(relative: string, value: unknown): void {
    const file = path.join(projectDir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

async function cli(...args: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(args, { out: text => out.push(text), err: text => err.push(text) });
    expect(code, [...out, ...err].join("\n")).toBe(0);
}

function readDocument(): StoryDocument {
    return JSON.parse(fs.readFileSync(path.join(projectDir, "editor/story/stories", STORY_ID, "storydoc.json"), "utf8")) as StoryDocument;
}

function shows(document: StoryDocument): StoryBlock[] {
    const scene = document.scenes[SCENE_ID];
    return scene.rootBlockIds.map(id => scene.blocks[id]).filter(block =>
        block.kind === "action" && "operation" in block.payload && block.payload.operation === "show");
}

function transformProps(compiled: Awaited<ReturnType<typeof compileStudioStoryToNlr>>, blockId: string): unknown[] {
    const visited = new Set<unknown>();
    const walk = (action: any): any[] => {
        if (!action || visited.has(action)) return [];
        visited.add(action);
        const children = typeof action.getFutureActions === "function" ? action.getFutureActions(compiled.story, { allowFutureScene: true }) : [];
        return [action, ...children.flatMap(walk)];
    };
    return compiled.actionIdBindings.filter(binding => binding.blockId === blockId)
        .flatMap(binding => walk(binding.action))
        .filter(action => action.type === "displayable:applyTransform")
        .flatMap(action => action.contentNode?.getContent?.()[0]?.sequences?.map((sequence: any) => sequence.props) ?? []);
}

afterEach(() => {
    if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true });
    projectDir = "";
});

describe("show placement on existing stage objects", () => {
    it("survives CLI save, show, edit and reload, and reaches the game and preview", async () => {
        projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-story-show-placement-")));
        writeJson("editor/story/index.json", {
            schemaVersion: 2,
            stories: [{ id: STORY_ID, name: "Story" }],
            defaultStoryId: STORY_ID,
        });
        writeJson(`editor/story/stories/${STORY_ID}/storydoc.json`, {
            schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
            id: STORY_ID,
            name: "Story",
            entrySceneId: SCENE_ID,
            chapters: [{ id: CHAPTER_ID, name: "Chapter", sceneIds: [SCENE_ID] }],
            scenes: { [SCENE_ID]: { id: SCENE_ID, name: "Scene", runtimeName: "scene", rootBlockIds: [], blocks: {} } },
        });
        writeJson("assets/assets.metadata.image.json", {
            [IMAGE_ID]: { id: IMAGE_ID, type: "image", name: "forest", hash: "forest", source: "local", meta: {}, tags: [], description: "" },
        });
        const input = path.join(projectDir, "input.story");
        fs.writeFileSync(input, [
            "#nlstory 1", "#story Story", `#scene Scene ⟦${SCENE_ID}⟧`,
            "#layer displayableLayer", "#layer other", "#layer overlay", "",
            "/image forest name=hero",
            "/image forest name=backup",
            "/text name=title Heading",
            "/show hero pos=0.25,0.5 xoffset=40 yoffset=-12 opacity=0.6 d=0.3",
            "/show title pos=0.123456,0.543219 xoffset=0.00000001 opacity=1 d=0.4",
            "/show overlay pos=left d=0.5",
            "After.", "",
        ].join("\n"));
        await cli("check", input, "--project", projectDir);
        await cli("apply", input, "--project", projectDir, "--write");

        const first = readDocument();
        const firstShows = shows(first);
        expect(firstShows).toHaveLength(3);
        const shown = path.join(projectDir, "shown.story");
        await cli("show", "--project", projectDir, "--scene", "Scene", "--out", shown);
        const printed = fs.readFileSync(shown, "utf8");
        expect(printed).toMatch(/\/show hero .*pos=0\.25,0\.5 .*xoffset=40 .*yoffset=-12/);
        expect(printed).toMatch(/\/show title .*pos=0\.123456,0\.543219 .*xoffset=0\.00000001 .*opacity=1/);
        expect(printed).toMatch(/\/show overlay .*pos=left/);
        const edited = printed.replace(/(\/show hero [^\n]*d=)0\.3s/, (_match, prefix: string) => `${prefix}0.7s`);
        expect(edited).not.toBe(printed);
        fs.writeFileSync(shown, edited);
        await cli("check", shown, "--project", projectDir);
        await cli("apply", shown, "--project", projectDir, "--write");

        const reloaded = readDocument();
        const scene = reloaded.scenes[SCENE_ID];
        const reloadedShows = shows(reloaded);
        expect(reloadedShows.map(block => block.id)).toEqual(firstShows.map(block => block.id));
        expect(reloadedShows.slice(1).map(block => block.payload)).toEqual(firstShows.slice(1).map(block => block.payload));
        expect(reloadedShows[0]).toMatchObject({
            payload: { target: { sourceBlockId: scene.rootBlockIds[0] }, transform: { to: { position: { xalign: 0.25, yalign: 0.5, xoffset: 40, yoffset: -12 }, opacity: 0.6 }, durationMs: 700 } },
        });
        expect(reloadedShows[1]).toMatchObject({ payload: { target: { sourceBlockId: scene.rootBlockIds[2] }, transform: { to: { position: { xalign: 0.123456, yalign: 0.543219, xoffset: 0.00000001 } } } } });
        expect(reloadedShows[2]).toMatchObject({ payload: { target: { kind: "layer", name: "overlay" }, transform: { to: { position: { xalign: 0.25, yalign: 0.5 } } } } });

        const game = await compileStudioStoryToNlr({ document: reloaded, sceneId: SCENE_ID, resolveAssetUrl: async id => `nlr://${id}` });
        expect(game.diagnostics).toEqual([]);
        for (const [index, expected] of [[0, { xalign: 0.25, yalign: 0.5, xoffset: 40, yoffset: -12 }], [1, { xalign: 0.123456, yalign: 0.543219, xoffset: 0.00000001 }], [2, { xalign: 0.25, yalign: 0.5 }]] as const) {
            const blockId = reloadedShows[index].id;
            expect(transformProps(game, blockId)).toContainEqual(expect.objectContaining({ position: expect.objectContaining(expected) }));
            const before = computeStoryStageSnapshot({ document: reloaded, sceneId: SCENE_ID, targetBlockId: blockId });
            const selected = await compileStagePreviewToNlr({
                document: reloaded, sceneId: SCENE_ID, targetBlockId: blockId, snapshot: before,
                resolveAssetUrl: async id => `nlr://${id}`, onBeforeTarget: () => {}, onAfterTarget: () => {},
            });
            expect(selected.diagnostics).toEqual([]);
            expect(transformProps(selected, blockId)).toContainEqual(expect.objectContaining({ position: expect.objectContaining(expected) }));
        }

        const targetBlockId = scene.rootBlockIds.at(-1)!;
        const snapshot = computeStoryStageSnapshot({ document: reloaded, sceneId: SCENE_ID, targetBlockId });
        for (const [name, expected] of [["hero", { xalign: 0.25, yalign: 0.5, xoffset: 40, yoffset: -12 }], ["title", { xalign: 0.123456, yalign: 0.543219, xoffset: 0.00000001 }], ["overlay", { xalign: 0.25, yalign: 0.5 }]] as const) {
            expect(snapshot.displayables.find(item => item.objectName === name)?.props.position).toEqual(expect.objectContaining(expected));
        }
        const preview = await compileStagePreviewToNlr({
            document: reloaded, sceneId: SCENE_ID, targetBlockId, snapshot,
            resolveAssetUrl: async id => `nlr://${id}`, onBeforeTarget: () => {}, onAfterTarget: () => {},
        });
        expect(preview.diagnostics).toEqual([]);
        const elements = preview.sceneElements?.[SCENE_ID];
        for (const [element, expected] of [
            [elements?.images.get("hero"), { xalign: 0.25, yalign: 0.5, xoffset: 40, yoffset: -12 }],
            [elements?.texts.get("title"), { xalign: 0.123456, yalign: 0.543219, xoffset: 0.00000001 }],
            [elements?.layers.get("overlay"), { xalign: 0.25, yalign: 0.5 }],
        ] as const) {
            expect(element).toBeDefined();
            expect(DevTools.getDisplayableTransformProps(element as any).position).toEqual(expect.objectContaining(expected));
        }

        const renamed = structuredClone(reloaded);
        const renamedScene = renamed.scenes[SCENE_ID];
        const imageDeclaration = renamedScene.blocks[renamedScene.rootBlockIds[0]];
        const textDeclaration = renamedScene.blocks[renamedScene.rootBlockIds[2]];
        if (imageDeclaration.kind !== "action" || imageDeclaration.payload.action !== "image"
            || textDeclaration.kind !== "action" || textDeclaration.payload.action !== "text") {
            throw new Error("expected image and text declarations");
        }
        imageDeclaration.payload.objectName = "champion";
        textDeclaration.payload.objectName = "heading";
        const layer = renamedScene.layers?.find(entry => entry.kind === "custom" && entry.name === "overlay");
        if (!layer || layer.kind !== "custom") throw new Error("expected an overlay layer");
        layer.name = "foreground";
        const renamedGame = await compileStudioStoryToNlr({ document: renamed, sceneId: SCENE_ID, resolveAssetUrl: async id => `nlr://${id}` });
        expect(renamedGame.diagnostics).toEqual([]);
        for (const [index, expected] of [[0, { xalign: 0.25, yalign: 0.5, xoffset: 40, yoffset: -12 }], [1, { xalign: 0.123456, yalign: 0.543219, xoffset: 0.00000001 }], [2, { xalign: 0.25, yalign: 0.5 }]] as const) {
            const blockId = reloadedShows[index].id;
            expect(transformProps(renamedGame, blockId)).toContainEqual(expect.objectContaining({ position: expect.objectContaining(expected) }));
            const before = computeStoryStageSnapshot({ document: renamed, sceneId: SCENE_ID, targetBlockId: blockId });
            const selected = await compileStagePreviewToNlr({
                document: renamed, sceneId: SCENE_ID, targetBlockId: blockId, snapshot: before,
                resolveAssetUrl: async id => `nlr://${id}`, onBeforeTarget: () => {}, onAfterTarget: () => {},
            });
            expect(selected.diagnostics).toEqual([]);
            expect(transformProps(selected, blockId)).toContainEqual(expect.objectContaining({ position: expect.objectContaining(expected) }));
        }
        const renamedSnapshot = computeStoryStageSnapshot({ document: renamed, sceneId: SCENE_ID, targetBlockId });
        for (const [name, expected] of [["champion", { xalign: 0.25, yalign: 0.5, xoffset: 40, yoffset: -12 }], ["heading", { xalign: 0.123456, yalign: 0.543219, xoffset: 0.00000001 }], ["foreground", { xalign: 0.25, yalign: 0.5 }]] as const) {
            const object = renamedSnapshot.displayables.find(item => item.objectName === name);
            expect(object?.visible).toBe(true);
            expect(object?.props.position).toEqual(expect.objectContaining(expected));
        }
        const renamedPreview = await compileStagePreviewToNlr({
            document: renamed, sceneId: SCENE_ID, targetBlockId, snapshot: renamedSnapshot,
            resolveAssetUrl: async id => `nlr://${id}`, onBeforeTarget: () => {}, onAfterTarget: () => {},
        });
        expect(renamedPreview.diagnostics).toEqual([]);
        const renamedElements = renamedPreview.sceneElements?.[SCENE_ID];
        expect(DevTools.getDisplayableTransformProps(renamedElements?.images.get("champion") as any).position)
            .toEqual(expect.objectContaining({ xalign: 0.25, yalign: 0.5, xoffset: 40, yoffset: -12 }));
        expect(DevTools.getDisplayableTransformProps(renamedElements?.texts.get("heading") as any).position)
            .toEqual(expect.objectContaining({ xalign: 0.123456, yalign: 0.543219, xoffset: 0.00000001 }));
        expect(DevTools.getDisplayableTransformProps(renamedElements?.layers.get("foreground") as any).position)
            .toEqual(expect.objectContaining({ xalign: 0.25, yalign: 0.5 }));
        writeJson(`editor/story/stories/${STORY_ID}/storydoc.json`, renamed);
        const storyDocumentFile = path.join(projectDir, "editor/story/stories", STORY_ID, "storydoc.json");
        const renamedBytes = fs.readFileSync(storyDocumentFile, "utf8");
        await cli("show", "--project", projectDir, "--scene", "Scene", "--out", shown);
        const renamedPrinted = fs.readFileSync(shown, "utf8");
        expect(renamedPrinted).toMatch(/\/show champion .*pos=0\.25,0\.5/);
        expect(renamedPrinted).toMatch(/\/show heading .*pos=0\.123456,0\.543219/);
        expect(renamedPrinted).toMatch(/\/show foreground .*pos=left/);
        await cli("check", shown, "--project", projectDir);
        await cli("apply", shown, "--project", projectDir, "--write");
        expect(fs.readFileSync(storyDocumentFile, "utf8")).toBe(renamedBytes);
        const afterRenamedRoundTrip = shows(readDocument());
        expect(afterRenamedRoundTrip).toEqual(shows(renamed));
        expect(afterRenamedRoundTrip.map(block => block.id)).toEqual(firstShows.map(block => block.id));

        fs.writeFileSync(shown, renamedPrinted.replace("/show champion ", "/show backup ").replace("/show foreground ", "/show other "));
        await cli("check", shown, "--project", projectDir);
        await cli("apply", shown, "--project", projectDir, "--write");
        const retargeted = readDocument();
        expect(shows(retargeted)[0]).toMatchObject({
            id: firstShows[0].id,
            payload: { objectName: "backup", target: { sourceBlockId: scene.rootBlockIds[1] }, transform: { to: { position: { xalign: 0.25, yalign: 0.5, xoffset: 40, yoffset: -12 }, opacity: 0.6 }, durationMs: 700 } },
        });
        const otherLayer = retargeted.scenes[SCENE_ID].layers?.find(entry => entry.kind === "custom" && entry.name === "other");
        if (!otherLayer || otherLayer.kind !== "custom") throw new Error("expected the other layer");
        expect(shows(retargeted)[2]).toMatchObject({
            id: firstShows[2].id,
            payload: { target: { kind: "layer", name: "other", sourceBlockId: otherLayer.id }, transform: { to: { position: { xalign: 0.25, yalign: 0.5 } }, durationMs: 500 } },
        });
    });
});
