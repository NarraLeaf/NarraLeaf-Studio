import { describe, expect, it, vi } from "vitest";
import type { AgentCallResult } from "@shared/agent/protocol";
import type { ImportPlan, PsdLeaf } from "@shared/utils/psdLayerPlan";
import { AssetType } from "../assets/assetTypes";
import { Services } from "../services";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { CharacterService } from "../core/CharacterService";
import { AgentRefusal, type AgentToolContext, type AgentToolHandler } from "./agentCall";
import { charactersList } from "./tools/castTools";
import {
    canvasFromSizes,
    characterLayeredSet,
    characterLayersImport,
    characterLabel,
    characterPreview,
    specFromPsdPlan,
} from "./tools/layeredTools";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

// A PSD import reads and bakes through main; what is recorded is whether it got as far as baking.
const bridge = vi.hoisted(() => ({ readPsd: vi.fn(), bakePsd: vi.fn() }));
vi.mock("@/lib/app/bridge", () => ({ getInterface: () => bridge }));
vi.mock("./agentFolderRequest", () => ({ ensureAgentMayReadPaths: async () => undefined }));

// The compositor draws on an OffscreenCanvas, which node has not got. What it is handed - which
// bitmaps, in which order, at which size - is what the preview decides, so that is what is recorded.
const drawCalls: { sizes: string[]; maxSize: number | undefined }[] = [];
vi.mock("../character/spriteCompositor", async importOriginal => ({
    ...(await importOriginal<typeof import("../character/spriteCompositor")>()),
    drawStack: async (bitmaps: { width: number; height: number; tag: string }[], maxSize: number | undefined) => {
        drawCalls.push({ sizes: bitmaps.map(bitmap => bitmap.tag), maxSize });
        return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    },
}));

/**
 * The layered character tools over the real cast service (so undo is the real project stack) and
 * in-memory images: a stack is written as one step, refused whole on an error, a cold switch is
 * refused until confirmed and reports the rows it strands, files named by convention become a stack,
 * and a preview composites the chosen look.
 */

function png(width: number, height: number, colourType = 6): Uint8Array {
    const be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const chunk = (type: string, data: number[]) => [...be(data.length), ...[...type].map(c => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
    return new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ...chunk("IHDR", [...be(width), ...be(height), 8, colourType, 0, 0, 0]),
        ...chunk("IDAT", [0]),
        ...chunk("IEND", []),
    ]);
}

const MEI_FILES = [
    "mei_body", "mei_outfit_school", "mei_outfit_casual", "mei_jacket_casual",
    "mei_eyes_normal", "mei_eyes_smile", "mei_mouth_normal", "mei_mouth_smile",
];

function harness(init: { images?: Record<string, Uint8Array>; blocks?: Record<string, unknown>; preset?: { id: string; name: string; poses: string[] } } = {}) {
    const images: Record<string, { id: string; name: string; type: AssetType; groupId?: string }> = {};
    const bytes: Record<string, Uint8Array> = {};
    for (const name of MEI_FILES) {
        images[name] = { id: name, name, type: AssetType.Image };
        bytes[name] = png(1000, 1800);
    }
    for (const [name, data] of Object.entries(init.images ?? {})) {
        images[name] = { id: name, name, type: AssetType.Image };
        bytes[name] = data;
    }
    const blocks = init.blocks ?? {};
    const history = new HistoryService();
    const services: Record<string, unknown> = {
        [Services.History]: history,
        [Services.UI]: { showError: vi.fn() },
        [Services.FileSystem]: {},
        [Services.ServiceAssets]: { deleteFile: vi.fn(async () => ({ ok: true })) },
        [Services.Story]: {
            listStories: () => [{ id: "story", name: "Main" }],
            loadStory: async () => ({
                chapters: [{ sceneIds: ["scene"] }],
                scenes: { scene: { id: "scene", name: "Rooftop", rootBlockIds: Object.keys(blocks), blocks } },
            }),
        },
        [Services.Assets]: {
            getAssets: () => ({ [AssetType.Image]: images }),
            fetch: async (asset: { id: string }) => ({ success: true, data: { data: bytes[asset.id], metadata: {} } }),
            getGroupAssetsManager: () => ({ getGroups: () => [] }),
        },
        [Services.Project]: { getProjectConfig: () => ({ metadata: { resolution: { width: 1920, height: 1080 } } }) },
    };
    const ids = init.preset ? [init.preset.id] : [];
    let next = 0;
    services[Services.Uuid] = { generate: () => ids.shift() ?? `c${++next}` };
    const context = { project: {} as never, services: { get: (name: string) => services[name] } as never, commandLineRun: false };
    const cast = new CharacterService();
    history.setContext(context);
    cast.setContext(context);
    services[Services.Character] = cast;
    if (init.preset) {
        const made = cast.createCharacter(init.preset.name);
        for (const pose of init.preset.poses) {
            const created = made.profile.appearance.createPose(pose)!;
            made.profile.appearance.setPoseAsset(created.id, "mei_body");
        }
    }
    const tool = {
        ctx: { services: { get: (name: string) => services[name] } },
        request: { callId: "call", policy: { writesEnabled: true, allowedImportRoots: [] } },
        follow: { describeCall: vi.fn(), getState: () => ({ paused: false }) },
        log: vi.fn(),
    } as unknown as AgentToolContext;
    const call = (handler: AgentToolHandler, args: Record<string, unknown>) => handler(args, tool);
    const run = async (handler: AgentToolHandler, args: Record<string, unknown>) => {
        const result = await call(handler, args) as AgentCallResult & { structured?: Record<string, any> };
        return result.structured as Record<string, any>;
    };
    const refusal = async (handler: AgentToolHandler, args: Record<string, unknown>) => {
        try {
            await call(handler, args);
        } catch (error) {
            if (error instanceof AgentRefusal) return error;
            throw error;
        }
        throw new Error("expected a refusal");
    };
    const undoDepth = () => history.describe().find(entry => entry.scopeId === projectHistoryScope())?.undo ?? 0;
    return { cast, history, run, call, refusal, undoDepth, follow: tool.follow as unknown as { describeCall: ReturnType<typeof vi.fn> } };
}

const MEI_SET = {
    character: "Mei",
    axes: [
        { name: "expression", tags: ["normal", "smile"] },
        { name: "outfit", tags: ["school", "casual"] },
    ],
    layers: [
        { name: "body", asset: "mei_body" },
        { name: "outfit", axis: "outfit", options: { school: "mei_outfit_school", casual: "mei_outfit_casual" } },
        { name: "jacket", axis: "outfit", options: { school: null, casual: "mei_jacket_casual" } },
        { name: "eyes", axis: "expression", options: { normal: "mei_eyes_normal", smile: "mei_eyes_smile" } },
        { name: "mouth", axis: "expression", options: { normal: "mei_mouth_normal", smile: "mei_mouth_smile" } },
    ],
};

describe("character_layered_set", () => {
    it("creates a layered character as one step of undo, standing on its canvas", async () => {
        const { cast, history, run, undoDepth } = harness();
        const out = await run(characterLayeredSet, MEI_SET);
        expect(out.created).toBe(true);
        expect(out.combinations).toBe(4);
        expect(out.scoped).toEqual([{ layer: "jacket", drawsNothingFor: ["school"] }]);
        expect(out.character.kind).toBe("layered");
        expect(out.character.layered.canvas).toEqual({ width: 1000, height: 1800 });
        expect(out.character.layered.layers[2]).toEqual({ name: "jacket", axis: "outfit", options: { school: null, casual: "mei_jacket_casual" } });
        // Taller than the stage, so scaled to fit with the feet on the bottom edge.
        expect(out.character.entranceTransform).toEqual({ position: { xalign: 0.5, yalign: 0.5, yoffset: 0 }, zoom: 0.6 });
        expect(undoDepth()).toBe(1);

        history.undo(projectHistoryScope());
        await history.settled();
        expect(cast.listCharacter()).toHaveLength(0);
    });

    it("refuses layers of different sizes, naming each odd one, and writes nothing", async () => {
        const { cast, refusal } = harness({ images: { mei_mouth_smile: png(300, 200) } });
        const error = await refusal(characterLayeredSet, MEI_SET);
        expect(error.code).toBe("check_failed");
        expect(error.message).toMatch(/the canvas, 1000x1800 here/);
        expect(error.message).toContain('layer "mouth" for smile: 300x200');
        expect(cast.listCharacter()).toHaveLength(0);
    });

    it("refuses a layer that leaves a tag of its axis unaccounted for, and a missing image", async () => {
        const { refusal } = harness();
        const partial = { ...MEI_SET, layers: [...MEI_SET.layers.slice(0, 4), { name: "mouth", axis: "expression", options: { normal: "mei_mouth_normal" } }] };
        const unresolved = await refusal(characterLayeredSet, partial);
        expect(unresolved.code).toBe("invalid_args");
        expect(unresolved.message).toMatch(/Layer "mouth" does not say what it draws for "smile"/);

        const missing = { ...MEI_SET, layers: [{ name: "body", asset: "mei_bdy" }, ...MEI_SET.layers.slice(1)] };
        expect((await refusal(characterLayeredSet, missing)).message).toMatch(/layer "body": No image asset "mei_bdy"/);
    });

    it("refuses a look that draws nothing at all, as the character editor does", async () => {
        const { refusal } = harness();
        const empty = {
            character: "Mei",
            axes: [{ name: "outfit", tags: ["school", "none"] }],
            layers: [{ name: "outfit", axis: "outfit", options: { school: "mei_outfit_school", none: null } }],
        };
        const error = await refusal(characterLayeredSet, empty);
        expect(error.code).toBe("check_failed");
        expect(error.message).toMatch(/The look none draws nothing at all/);
    });

    it("writes nothing on a dry run", async () => {
        const { cast, run, undoDepth } = harness();
        const out = await run(characterLayeredSet, { ...MEI_SET, dryRun: true });
        expect(out.dryRun).toBe(true);
        expect(out.character.layered.axes).toHaveLength(2);
        expect(cast.listCharacter()).toHaveLength(0);
        expect(undoDepth()).toBe(0);
    });

    it("keeps tag ids across a restatement and reports rows that chose a tag it removes", async () => {
        const { cast, run } = harness();
        await run(characterLayeredSet, MEI_SET);
        const mei = cast.listCharacter()[0];
        const smile = mei.profile.appearance.getAxes()[0].tags[1];
        const casual = mei.profile.appearance.getAxes()[1].tags[1];
        const story = (cast as unknown as { getContext(): { services: { get(id: string): any } } }).getContext().services.get(Services.Story);
        const blocks = {
            r1: { id: "r1", kind: "action", childrenIds: [], payload: { action: "character", operation: "expression", characterId: mei.profile.getId(), tags: { x: smile.id } } },
        };
        story.loadStory = async () => ({ chapters: [{ sceneIds: ["scene"] }], scenes: { scene: { id: "scene", name: "Rooftop", rootBlockIds: ["r1"], blocks } } });

        const out = await run(characterLayeredSet, {
            ...MEI_SET,
            axes: [{ name: "expression", tags: ["normal"] }, MEI_SET.axes[1]],
            layers: [
                ...MEI_SET.layers.slice(0, 3),
                { name: "eyes", axis: "expression", options: { normal: "mei_eyes_normal" } },
                { name: "mouth", axis: "expression", options: { normal: "mei_mouth_normal" } },
            ],
        });
        expect(out.created).toBe(false);
        expect(mei.profile.appearance.getAxes()[1].tags[1].id).toBe(casual.id);
        expect(out.warnings).toContainEqual(expect.stringMatching(/1 story row\(s\) chose a tag this removes[\s\S]*scene "Rooftop", row 1/));
    });
});

describe("cold switch", () => {
    const poseRow = (characterId: string, pose: string) => ({
        r1: { id: "r1", kind: "action", childrenIds: [], payload: { action: "character", operation: "enter", characterId, pose } },
        r2: { id: "r2", kind: "action", childrenIds: [], payload: { action: "character", operation: "exit", characterId } },
    });

    it("refuses to make a preset character layered until confirmed, naming the rows that chose a pose", async () => {
        const h = harness({ preset: { id: "mei-id", name: "Mei", poses: ["normal"] } });
        const poseId = h.cast.getCharacter("mei-id")!.profile.appearance.getPoses()[0].id;
        const story = (h.cast as unknown as { getContext(): { services: { get(id: string): any } } }).getContext().services.get(Services.Story);
        const blocks = poseRow("mei-id", poseId);
        story.loadStory = async () => ({ chapters: [{ sceneIds: ["scene"] }], scenes: { scene: { id: "scene", name: "Rooftop", rootBlockIds: ["r1", "r2"], blocks } } });

        const refused = await h.refusal(characterLayeredSet, MEI_SET);
        expect(refused.code).toBe("unavailable");
        expect(refused.message).toMatch(/"Mei" is a preset character; making it layered discards its 1 pose\(s\)/);
        expect(refused.message).toContain('story "Main", scene "Rooftop", row 1 (action)');
        // The exit row names the character but chooses no look, so it is not stranded.
        expect(refused.message).not.toContain("row 2");
        expect(refused.hint).toMatch(/confirmSwitch: true/);
        expect(h.cast.getCharacter("mei-id")!.profile.appearance.getKind()).toBe("preset");

        const out = await h.run(characterLayeredSet, { ...MEI_SET, confirmSwitch: true });
        expect(out.character.kind).toBe("layered");
        expect(out.warnings[0]).toMatch(/cold switch/);
        expect(h.undoDepth()).toBe(1);

        h.history.undo(projectHistoryScope());
        await h.history.settled();
        expect(h.cast.getCharacter("mei-id")!.profile.appearance.getPoses().map(pose => pose.name)).toEqual(["normal"]);
    });
});

describe("what the interface calls the character", () => {
    it("names it by its name in the status bar and the Agent log when the call names it by id", async () => {
        const id = "6f1c2b9e-0d3a-4c5b-9e7f-1a2b3c4d5e6f";
        const h = harness({ preset: { id, name: "Mei", poses: ["normal"] } });
        await h.refusal(characterLayeredSet, { ...MEI_SET, character: id });
        expect(h.follow.describeCall).toHaveBeenCalledWith("call", "Mei");
        expect(h.follow.describeCall.mock.calls.flat().join(" ")).not.toContain(id);
        await h.refusal(characterLayersImport, { character: id, prefix: "nobody" });
        expect(h.follow.describeCall).toHaveBeenLastCalledWith("call", "Mei");
    });

    it("never quotes an id for a character that does not exist, but does quote the name a new one will get", () => {
        const h = harness();
        const ctx = (h.cast as unknown as { getContext(): never }).getContext();
        expect(characterLabel(ctx, "0d6e8c1a-2b3f-4a5d-8e9f-0a1b2c3d4e5f")).toBe("");
        expect(characterLabel(ctx, "Aoi")).toBe("Aoi");
    });
});

describe("character_layers_import", () => {
    it("refuses a PSD import before baking or importing anything", async () => {
        const h = harness({ preset: { id: "mei-id", name: "Mei", poses: ["normal"] } });
        const layer = (path: string[]) => ({ path, name: path[path.length - 1], blendMode: "normal", opacity: 1, hidden: false, clipping: false });
        bridge.readPsd.mockResolvedValue({
            success: true,
            data: {
                document: {
                    fileName: "mei.psd",
                    width: 1000,
                    height: 1800,
                    layers: [
                        layer(["body"]),
                        { ...layer(["expression"]), children: [layer(["expression", "normal"]), layer(["expression", "smile"])] },
                    ],
                },
            },
        });
        bridge.bakePsd.mockReset();
        // Mei is a preset character: making her layered is a cold switch the agent has not confirmed.
        const refused = await h.refusal(characterLayersImport, { character: "Mei", psd: "D:/art/mei.psd" });
        expect(refused.code).toBe("unavailable");
        expect(refused.hint).toMatch(/confirmSwitch: true/);
        expect(bridge.bakePsd).not.toHaveBeenCalled();
        expect(h.cast.getCharacter("mei-id")!.profile.appearance.getKind()).toBe("preset");
        expect(h.undoDepth()).toBe(0);
    });

    it("builds the stack from files named <character>_<layer>_<tag> and writes it as one step", async () => {
        const { cast, run, undoDepth } = harness({ images: { lin_body: png(1000, 1800) } });
        const out = await run(characterLayersImport, {
            character: "Mei",
            order: ["body", "outfit", "jacket", "eyes", "mouth"],
            axes: { expression: ["eyes", "mouth"], outfit: ["outfit", "jacket"] },
            defaults: { outfit: "casual" },
        });
        expect(out.derivedSpec.axes).toEqual([
            { name: "outfit", tags: ["casual", "school"], default: "casual" },
            { name: "expression", tags: ["normal", "smile"], default: "normal" },
        ]);
        expect(out.character.layered.layers.map((layer: { name: string }) => layer.name)).toEqual(["body", "outfit", "jacket", "eyes", "mouth"]);
        expect(cast.listCharacter()[0].profile.appearance.getKind()).toBe("layered");
        expect(undoDepth()).toBe(1);
    });

    it("asks for the stacking order, listing the layers it found", async () => {
        const { refusal } = harness();
        const error = await refusal(characterLayersImport, { character: "Mei" });
        expect(error.message).toMatch(/pass `order`, bottom to top/);
        expect(error.hint).toMatch(/Layers found under "Mei_": body, eyes, jacket, mouth, outfit/);
    });
});

describe("character_preview", () => {
    it("composites the named look, filling the other axes with their defaults", async () => {
        const { run, call } = harness();
        await run(characterLayeredSet, MEI_SET);
        vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
            return { width, height: 1800, tag: `${bytes.length}`, close: () => undefined };
        });
        drawCalls.length = 0;
        const result = await call(characterPreview, { character: "Mei", look: { outfit: "casual" }, maxSize: 512 });
        vi.unstubAllGlobals();
        if (!result.ok) throw new Error(result.error.message);
        expect(result.content[0]).toEqual({ type: "image", mimeType: "image/png", data: "iVBORw==" });
        const text = result.content[1].type === "text" ? result.content[1].text : "";
        expect(text).toContain('"Mei" - expression=normal (default), outfit=casual: 1000x1800 artwork');
        expect(text).toContain("Layers bottom to top: body, outfit, jacket, eyes, mouth.");
        // Body, casual outfit, jacket, normal eyes and mouth: five bitmaps, at the size asked for.
        expect(drawCalls).toEqual([{ sizes: expect.any(Array), maxSize: 512 }]);
        expect(drawCalls[0].sizes).toHaveLength(5);
    });

    it("refuses a tag the character does not have", async () => {
        const { run, refusal } = harness();
        await run(characterLayeredSet, MEI_SET);
        expect((await refusal(characterPreview, { character: "Mei", look: ["angry"] })).message).toMatch(/No tag "angry"/);
    });
});

describe("characters_list", () => {
    it("describes a layered character in the words character_layered_set takes", async () => {
        const { run } = harness();
        await run(characterLayeredSet, MEI_SET);
        const out = await run(charactersList, {});
        expect(out.characters[0]).toMatchObject({
            kind: "layered",
            layered: { axes: [{ name: "expression", tags: ["normal", "smile"], default: "normal" }, { name: "outfit", tags: ["school", "casual"], default: "school" }] },
            spriteSize: { width: 1000, height: 1800 },
        });
        expect(out.characters[0].poses).toBeUndefined();
    });
});

describe("pure parts", () => {
    it("takes the size most images share as the canvas and lists the rest", () => {
        const sizes = new Map([["a", { width: 10, height: 20 }], ["b", { width: 10, height: 20 }], ["c", { width: 5, height: 5 }], ["d", null]]);
        const placements = [{ assetId: "a", where: "body" }, { assetId: "b", where: "eyes" }, { assetId: "d", where: "hat" }];
        expect(canvasFromSizes(placements, sizes)).toEqual({ canvas: { width: 10, height: 20 }, unmeasured: ["hat"] });
        const odd = canvasFromSizes([...placements, { assetId: "c", where: "mouth" }], sizes);
        expect("error" in odd && odd.error).toMatch(/10x20 here[\s\S]*mouth: 5x5/);
    });

    it("turns a PSD plan into a spec with unique names and remembers where each slot came from", () => {
        const leaf = (path: string[]): PsdLeaf => ({ path, name: path[path.length - 1], blendMode: "normal", hidden: false, clipping: false, group: path.length > 1 ? path[0] : null });
        const plan = {
            slots: [
                { kind: "constant", name: "Layer 1", leaf: leaf(["Layer 1"]) },
                { kind: "switch", axis: "hat", options: [{ tag: "none", leaf: leaf(["hat", "none"]) }, { tag: "cap", leaf: leaf(["hat", "cap"]) }] },
                { kind: "switch", axis: "glasses", options: [{ tag: "none", leaf: leaf(["glasses", "none"]) }, { tag: "round", leaf: leaf(["glasses", "round"]) }] },
                { kind: "constant", name: "Layer 1", leaf: leaf(["Layer 1 copy"]) },
            ],
        } as unknown as ImportPlan;
        const { spec, renamed, tagPaths, layerPaths } = specFromPsdPlan(plan, path => path.join("/"));
        expect(spec.axes).toEqual([{ name: "hat", tags: ["none", "cap"] }, { name: "glasses", tags: ["glasses-none", "round"] }]);
        expect(spec.layers.map(layer => layer.name)).toEqual(["Layer 1", "hat", "glasses", "Layer 1 2"]);
        expect(renamed).toEqual(['tag "glasses/none" is "glasses-none"', 'layer "Layer 1 copy" is "Layer 1 2"']);
        expect(tagPaths.get("glasses/glasses-none")).toEqual(["glasses", "none"]);
        expect(layerPaths.get("layer 1 2")).toEqual(["Layer 1 copy"]);
    });
});
