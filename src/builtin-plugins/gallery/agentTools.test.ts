/**
 * The Gallery's agent tools against a stand-in for Studio: that each write tool resolves what the
 * agent names, refuses the whole call when anything does not resolve, and commits once - which is
 * what makes a call one step of undo once the host captures it.
 */

import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import type { Asset, PluginAgentToolDef, PluginApp } from "narraleaf-studio/plugin";
import { checkAgentPluginToolSchema, agentPluginToolMcpName } from "@shared/agent/pluginTools";
import { GALLERY_AGENT_TOOLS, createGalleryAgentTools } from "./agentTools";
import { createGalleryStore } from "./store";
import type { GalleryStoreData } from "./catalog";

const asset = (id: string, name: string, type: "image" | "audio") => ({ id, name, type }) as unknown as Asset;

const ASSETS = {
    image: [asset("img-a", "cg_rooftop_a.png", "image"), asset("img-b", "cg_rooftop_b.png", "image"), asset("img-lock", "locked.png", "image")],
    audio: [asset("aud-theme", "bgm_theme.ogg", "audio"), asset("aud-rain", "bgm_rain.ogg", "audio")],
};

function fakeApp(initial: GalleryStoreData | null = null) {
    const writes: GalleryStoreData[] = [];
    let stored: unknown = initial;
    const app = {
        services: {
            storage: {
                readJson: async () => (stored ? JSON.parse(JSON.stringify(stored)) : null),
                writeJson: async (_namespace: string, value: GalleryStoreData) => {
                    writes.push(JSON.parse(JSON.stringify(value)));
                    stored = value;
                },
            },
            workspace: { frozen: false },
            blueprintNodes: { notifyDynamicSelectOptionsChanged: () => undefined },
            i18n: {
                createTranslator: () => ({
                    locale: "en",
                    t: (key: string, params?: Record<string, string | number>) => `${key} ${params?.n ?? ""}`.trim(),
                }),
            },
            assets: { list: (type: "image" | "audio") => ASSETS[type] ?? [] },
            voice: {
                listUnits: async () => [
                    { unitId: "line-1", locale: "en", text: "I was waiting for you.", character: "Aoi", durationSec: 2.5 },
                ],
            },
            story: {
                listStories: () => [{ id: "story-1", name: "Main" }],
                listScenes: async () => [{ id: "scene-1", name: "Confession", storyId: "story-1" }],
            },
        },
    } as unknown as PluginApp;
    return { app, writes };
}

async function setup(initial: GalleryStoreData | null = null) {
    const { app, writes } = fakeApp(initial);
    const store = createGalleryStore(app, async () => 95);
    await store.load();
    const tools = new Map(createGalleryAgentTools(app, store).map(tool => [tool.name, tool]));
    const call = async (name: string, args: Record<string, unknown>) => (tools.get(name) as PluginAgentToolDef).handler(args, { clientName: null });
    return { store, writes, call, tools };
}

describe("the Gallery's agent tools", () => {
    it("are the six the manifest declares, with the same write flags and schemas Studio accepts", async () => {
        const { tools } = await setup();
        const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8")) as {
            contributes: { agentTools: { name: string; write: boolean }[] };
        };
        const declared = manifest.contributes.agentTools;
        expect([...tools.values()].map(tool => ({ name: tool.name, write: tool.write }))).toEqual(declared);
        expect(declared.map(tool => tool.name)).toEqual(Object.values(GALLERY_AGENT_TOOLS));
        for (const tool of tools.values()) {
            expect(checkAgentPluginToolSchema(tool.inputSchema), tool.name).toEqual([]);
            expect(agentPluginToolMcpName("narraleaf.gallery", tool.name)).toMatch(/^narraleaf_gallery__/);
            expect(tool.title.length).toBeLessThanOrEqual(80);
            expect(tool.description.length).toBeLessThanOrEqual(1200);
        }
    });

    it("add every kind of entry in one write, resolving assets, scenes and voice lines by name", async () => {
        const { call, writes, store } = await setup();
        const result = await call(GALLERY_AGENT_TOOLS.addEntries, {
            entries: [
                { kind: "cg", group: "Chapter 1", variants: [{ image: "cg_rooftop_a" }, { image: "img-b", name: "Smiling" }], cover: 2 },
                { kind: "scene", name: "The confession", group: "Chapter 1", scene: { scene: "confession" }, variants: [{ image: "cg_rooftop_a.png" }] },
                { kind: "music", name: "Soundtrack", variants: [{ audio: "bgm_theme" }, { audio: "aud-rain" }] },
                { kind: "voice", name: "Aoi", variants: [{ voiceUnit: "line-1" }] },
            ],
        });
        expect(typeof result === "object" && "text" in result ? result.text : "").toContain("Added 4 gallery entries");
        expect(writes).toHaveLength(1);
        const [cg, scene, music, voice] = store.getItems();
        expect(cg).toMatchObject({ kind: "cg", name: "cg_rooftop_a", variants: [{ imageAssetId: "img-a" }, { imageAssetId: "img-b", name: "Smiling" }] });
        expect(cg!.coverVariantId).toBe(cg!.variants[1]!.id);
        expect(scene).toMatchObject({ kind: "scene", scene: { storyId: "story-1", sceneId: "scene-1" } });
        expect(cg!.groupId).toBe(scene!.groupId);
        expect(store.getGroups()).toEqual([{ id: cg!.groupId, name: "Chapter 1" }]);
        expect(music!.variants.map(variant => [variant.audioAssetId, variant.durationSec])).toEqual([["aud-theme", 95], ["aud-rain", 95]]);
        expect(voice!.variants[0]).toMatchObject({ voiceUnitId: "line-1", lineText: "I was waiting for you.", durationSec: 2.5 });
    });

    it("refuse the whole call, writing nothing, when one name does not resolve", async () => {
        const { call, writes, store } = await setup();
        const result = await call(GALLERY_AGENT_TOOLS.addEntries, {
            entries: [
                { kind: "cg", variants: [{ image: "cg_rooftop_a" }] },
                { kind: "cg", variants: [{ image: "no_such_picture" }] },
            ],
        });
        expect(result).toMatchObject({ error: { code: "not_found" } });
        expect(writes).toHaveLength(0);
        expect(store.getItems()).toEqual([]);
        expect(await call(GALLERY_AGENT_TOOLS.addEntries, { entries: [{ kind: "music", variants: [{ image: "cg_rooftop_a" }] }] }))
            .toMatchObject({ error: { code: "invalid_args" } });
        expect(await call(GALLERY_AGENT_TOOLS.addEntries, { entries: [{ kind: "scene" }] })).toMatchObject({ error: { code: "invalid_args" } });
    });

    it("edit, regroup, re-cover, move and remove entries, one write per call", async () => {
        const { call, writes, store } = await setup();
        await call(GALLERY_AGENT_TOOLS.addEntries, {
            entries: [{ kind: "cg", name: "First", variants: [{ image: "img-a" }] }, { kind: "cg", name: "Second", variants: [{ image: "img-b" }] }],
        });
        const [first, second] = store.getItems();
        await call(GALLERY_AGENT_TOOLS.updateEntries, {
            entries: [{
                id: first!.id,
                name: "Rooftop",
                group: "Route A",
                hidden: true,
                addVariants: [{ image: "img-b" }],
                lockedImage: "locked",
                moveBefore: "",
            }],
        });
        expect(writes).toHaveLength(2);
        const moved = store.getItems();
        expect(moved.map(item => item.id)).toEqual([second!.id, first!.id]);
        const rooftop = moved[1]!;
        expect(rooftop).toMatchObject({ name: "Rooftop", hidden: true, lockedImageAssetId: "img-lock" });
        expect(rooftop.variants).toHaveLength(2);
        await call(GALLERY_AGENT_TOOLS.updateEntries, { entries: [{ id: rooftop.id, cover: rooftop.variants[1]!.id, removeVariants: [rooftop.variants[0]!.id] }] });
        expect(store.getItems()[1]!.coverVariantId).toBe(rooftop.variants[1]!.id);
        expect(store.getItems()[1]!.variants).toHaveLength(1);
        await call(GALLERY_AGENT_TOOLS.removeEntries, { ids: [second!.id] });
        expect(store.getItems().map(item => item.id)).toEqual([rooftop.id]);
        expect(await call(GALLERY_AGENT_TOOLS.removeEntries, { ids: ["nope"] })).toMatchObject({ error: { code: "not_found" } });
    });

    it("replace the group list whole, ungrouping the entries of a group left out, and set the locked look", async () => {
        const { call, store } = await setup();
        await call(GALLERY_AGENT_TOOLS.addEntries, { entries: [{ kind: "cg", group: "Old", variants: [{ image: "img-a" }] }] });
        const old = store.getGroups()[0]!;
        await call(GALLERY_AGENT_TOOLS.setGroups, { groups: [{ name: "Chapter 1" }, { name: "Chapter 2" }] });
        expect(store.getGroups().map(group => group.name)).toEqual(["Chapter 1", "Chapter 2"]);
        expect(store.getItems()[0]!.groupId).toBeNull();
        expect(await call(GALLERY_AGENT_TOOLS.setGroups, { groups: [{ id: old.id, name: "Back" }] })).toMatchObject({ error: { code: "not_found" } });
        await call(GALLERY_AGENT_TOOLS.setSettings, { lockedImage: "locked.png", lockedNameMask: "" });
        expect(store.getSettings()).toMatchObject({ lockedImageAssetId: "img-lock", lockedNameMask: "" });
    });

    it("list the catalog with ids, the unlock summary and, on request, the recorded voice lines", async () => {
        const { call } = await setup();
        await call(GALLERY_AGENT_TOOLS.addEntries, { entries: [{ kind: "cg", name: "Rooftop", variants: [{ image: "img-a" }] }] });
        const listed = await call(GALLERY_AGENT_TOOLS.list, { voiceUnits: true });
        const answer = listed as { text: string; data: { entries: { name: string }[]; voiceUnits: { id: string }[] } };
        expect(answer.text).toContain("Unlock Gallery");
        expect(answer.data.entries.map(entry => entry.name)).toEqual(["Rooftop"]);
        expect(answer.data.voiceUnits).toEqual([{ id: "line-1", line: "I was waiting for you.", speaker: "Aoi" }]);
    });
});
