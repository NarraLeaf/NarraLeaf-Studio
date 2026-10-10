import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));
import type { AgentCallResult } from "@shared/agent/protocol";
import type { StoryTransformProps } from "@shared/types/story";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { AssetType } from "../assets/assetTypes";
import { Services } from "../services";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { CharacterService } from "../core/CharacterService";
import { AgentRefusal, type AgentToolContext, type AgentToolHandler } from "./agentCall";
import { characterUpsert, charactersList, variableDelete, variableUpsert } from "./tools/castTools";

/**
 * The cast tools over in-memory stand-ins for the services they write through: a variable can be
 * renamed by id and deleted only when nothing uses it, each write inside one history transaction;
 * a character that gets art gets a standing entrance, and an opaque pose is warned about.
 */

function png(colourType: number, width: number, height: number): Uint8Array {
    const be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const chunk = (type: string, data: number[]) => [...be(data.length), ...[...type].map(c => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
    return new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ...chunk("IHDR", [...be(width), ...be(height), 8, colourType, 0, 0, 0]),
        ...chunk("IDAT", [0]),
        ...chunk("IEND", []),
    ]);
}

function fakeRegistry(entries: VariableRegistryEntry[]) {
    const map = new Map(entries.map(entry => [entry.id, { ...entry }]));
    let next = 0;
    return {
        listEntries: () => [...map.values()],
        getEntry: (id: string) => map.get(id),
        createEntry: (scope: VariableRegistryEntry["scope"], input: { name: string; valueType: string; defaultValue?: unknown; description?: string }) => {
            const id = `var-${++next}`;
            const entry = { id, storageKey: id, scope, name: input.name, valueType: input.valueType, ...(input.description ? { description: input.description } : {}) } as VariableRegistryEntry;
            map.set(id, entry);
            return entry;
        },
        renameEntry: (id: string, name: string) => { map.get(id)!.name = name; },
        setEntryValueType: (id: string, valueType: VariableRegistryEntry["valueType"]) => { map.get(id)!.valueType = valueType; },
        setEntryDefault: (id: string, value: VariableRegistryEntry["defaultValue"]) => { map.get(id)!.defaultValue = value; },
        setEntryDescription: (id: string, description: string | undefined) => {
            const entry = map.get(id)!;
            if (description) entry.description = description; else delete entry.description;
        },
        remove: (id: string) => map.delete(id),
    };
}

type Fakes = {
    registry: ReturnType<typeof fakeRegistry>;
    transactions: number;
    sceneBlocks: Record<string, unknown>;
    characters: CharacterSeed[];
    history: HistoryService;
    images: Record<string, { id: string; name: string; type: AssetType; bytes: Uint8Array }>;
};

type CharacterSeed = { id: string; name: string; entrance?: StoryTransformProps };

function fakeCharacter(id: string, name: string, entrance?: StoryTransformProps): CharacterSeed {
    return { id, name, entrance };
}

function harness(init: Partial<Pick<Fakes, "sceneBlocks" | "characters">> & { variables?: VariableRegistryEntry[] } = {}) {
    const fakes: Fakes = {
        registry: fakeRegistry(init.variables ?? []),
        transactions: 0,
        sceneBlocks: init.sceneBlocks ?? {},
        characters: init.characters ?? [],
        history: new HistoryService(),
        images: {
            sprite: { id: "sprite", name: "lin_normal", type: AssetType.Image, bytes: png(2, 700, 1000) },
            cutout: { id: "cutout", name: "lin_smile", type: AssetType.Image, bytes: png(6, 700, 1000) },
        },
    };
    const services: Record<string, unknown> = {
        [Services.VariableRegistry]: fakes.registry,
        [Services.LocalBlueprint]: {
            runBlueprintHistoryTransaction: (_scope: string, action: () => unknown) => { fakes.transactions += 1; return action(); },
            deleteSavedRegistryVariable: (_scope: string, id: string) => { fakes.transactions += 1; return fakes.registry.remove(id); },
            deletePersistentVariable: (_scope: string, id: string) => { fakes.transactions += 1; return fakes.registry.remove(id); },
        },
        [Services.Story]: {
            listStories: () => [{ id: "story", name: "Main" }],
            loadStory: async () => ({
                chapters: [{ sceneIds: ["scene"] }],
                scenes: { scene: { id: "scene", name: "Corridor", rootBlockIds: Object.keys(fakes.sceneBlocks), blocks: fakes.sceneBlocks } },
            }),
        },
        [Services.UIGraph]: { getDocument: () => ({ blueprintDocument: { blueprints: {}, ownerRecords: {} } }) },
        [Services.UIDocument]: { getDocument: () => ({ surfaces: [], elements: {}, components: [] }) },
        [Services.History]: fakes.history,
        [Services.UI]: { showError: vi.fn() },
        [Services.FileSystem]: {},
        [Services.ServiceAssets]: { deleteFile: vi.fn(async () => ({ ok: true })) },
        [Services.Assets]: {
            getAssets: () => ({ [AssetType.Image]: fakes.images }),
            fetch: async (asset: { id: string }) => ({ success: true, data: { data: fakes.images[asset.id].bytes, metadata: {} } }),
        },
        [Services.Project]: { getProjectConfig: () => ({ metadata: { resolution: { width: 1920, height: 1080 } } }) },
    };
    // The real cast service over these stand-ins, so a write is checked to be one step of undo.
    const ids = fakes.characters.map(seed => seed.id);
    let next = 0;
    services[Services.Uuid] = { generate: () => ids.shift() ?? `c${++next}` };
    const context = { project: {} as never, services: { get: (name: string) => services[name] } as never, commandLineRun: false };
    const cast = new CharacterService();
    fakes.history.setContext(context);
    cast.setContext(context);
    services[Services.Character] = cast;
    for (const seed of fakes.characters) {
        const made = cast.createCharacter(seed.name);
        if (seed.entrance) made.profile.setEntranceTransform(seed.entrance);
    }
    const tool = {
        ctx: { services: { get: (name: string) => services[name] } },
        request: { callId: "call", policy: { writesEnabled: true, allowedImportRoots: [] } },
        follow: { describeCall: vi.fn(), getState: () => ({ paused: false }) },
        log: vi.fn(),
    } as unknown as AgentToolContext;
    const run = async (handler: AgentToolHandler, args: Record<string, unknown>) => {
        const result = await handler(args, tool) as AgentCallResult & { structured?: Record<string, any> };
        return result.structured as Record<string, any>;
    };
    const refusal = async (handler: AgentToolHandler, args: Record<string, unknown>) => {
        try {
            await handler(args, tool);
        } catch (error) {
            if (error instanceof AgentRefusal) return error;
            throw error;
        }
        throw new Error("expected a refusal");
    };
    return { fakes, cast, run, refusal };
}

const HONEST: VariableRegistryEntry = { id: "v-honest", storageKey: "v-honest", name: "真心", scope: "saved", valueType: "boolean" };

describe("variable_upsert", () => {
    it("renames and retypes by id in one history step, keeping the id", async () => {
        const { fakes, run } = harness({ variables: [HONEST] });
        const out = await run(variableUpsert, { id: "v-honest", name: "affection_lin", valueType: "number", defaultValue: 0, description: "Lin's trust" });
        expect(out.variable).toMatchObject({ id: "v-honest", name: "affection_lin", valueType: "number", description: "Lin's trust" });
        expect(out.created).toBe(false);
        expect(fakes.transactions).toBe(1);
    });

    it("needs valueType only to create, and refuses a name another variable holds", async () => {
        const { refusal, run } = harness({ variables: [HONEST, { ...HONEST, id: "v-place", storageKey: "v-place", name: "地点" }] });
        expect((await refusal(variableUpsert, { name: "new_one" })).message).toMatch(/valueType.*required to create/);
        expect((await refusal(variableUpsert, { id: "v-honest", name: "地点" })).message).toMatch(/already called "地点"/);
        expect((await run(variableUpsert, { name: "new_one", valueType: "number" })).created).toBe(true);
    });

    it("refuses moving a variable between scopes", async () => {
        const { refusal } = harness({ variables: [HONEST] });
        expect((await refusal(variableUpsert, { id: "v-honest", scope: "persistent" })).code).toBe("unavailable");
    });
});

describe("variable_delete", () => {
    it("refuses while a story row reads the variable, naming the row", async () => {
        const { refusal } = harness({
            variables: [HONEST],
            sceneBlocks: { b1: { id: "b1", kind: "condition", childrenIds: [], payload: { when: { kind: "variable", target: { scope: "saved", variableId: "v-honest" } } } } },
        });
        const error = await refusal(variableDelete, { variable: "真心" });
        expect(error.code).toBe("unavailable");
        expect(error.message).toContain('story "Main", scene "Corridor", row 1 (condition)');
    });

    it("deletes an unused variable as one step and returns what is left", async () => {
        const { fakes, run } = harness({ variables: [HONEST] });
        const out = await run(variableDelete, { variable: "v-honest" });
        expect(out.deleted).toMatchObject({ id: "v-honest", name: "真心" });
        expect(out.variables).toEqual([]);
        expect(fakes.transactions).toBe(1);
    });
});

describe("character_upsert entrance and alpha", () => {
    it("gives a new character with art a standing entrance and warns about an opaque pose", async () => {
        const { run } = harness();
        const out = await run(characterUpsert, { name: "列车员", poses: [{ name: "normal", asset: "lin_normal" }] });
        expect(out.character.entranceTransform).toEqual({ position: { xalign: 0.5, yalign: 0.5, yoffset: -40 } });
        expect(out.character.drawnAtCenter).toEqual({ left: 610, top: 80, width: 700, height: 1000 });
        expect(out.warnings).toHaveLength(1);
        expect(out.warnings[0]).toMatch(/"lin_normal" is a PNG with no alpha channel/);
    });

    it("keeps a reused character's tuned entrance but says so, and refits on request", async () => {
        const tuned = { position: { xalign: 0.5, yalign: 0.5, yoffset: -50 }, zoom: 0.624 };
        const { run } = harness({ characters: [fakeCharacter("narra", "Narra", tuned)] });
        const kept = await run(characterUpsert, { id: "narra", poses: [{ name: "normal", asset: "lin_smile" }] });
        expect(kept.character.entranceTransform).toEqual(tuned);
        expect(kept.character.drawnAtCenter).toEqual({ left: 742, top: 278, width: 437, height: 624 });
        expect(kept.warnings).toEqual([expect.stringMatching(/keeps its entrance defaults/)]);

        const refit = await run(characterUpsert, { id: "narra", entranceTransform: "standing" });
        expect(refit.character.entranceTransform).toEqual({ position: { xalign: 0.5, yalign: 0.5, yoffset: -40 } });
        expect(refit.warnings).toBeUndefined();
    });

    it("sets and clears the entrance as stated", async () => {
        const { run, refusal } = harness({ characters: [fakeCharacter("narra", "Narra")] });
        const set = await run(characterUpsert, { id: "narra", entranceTransform: { zoom: 0.9, position: { yoffset: -90 } } });
        expect(set.character.entranceTransform).toEqual({ zoom: 0.9, position: { yoffset: -90 } });
        const cleared = await run(characterUpsert, { id: "narra", entranceTransform: null });
        expect(cleared.character.entranceTransform).toBeNull();
        expect((await refusal(characterUpsert, { id: "narra", entranceTransform: { rotation: 3 } })).code).toBe("invalid_args");
    });

    it("lists the stage and every character's box", async () => {
        const { run } = harness();
        await run(characterUpsert, { name: "林", poses: [{ name: "normal", asset: "lin_smile" }] });
        const out = await run(charactersList, {});
        expect(out.stage).toEqual({ width: 1920, height: 1080 });
        expect(out.characters[0]).toMatchObject({ spriteSize: { width: 700, height: 1000 }, drawnAtCenter: { top: 80, height: 1000 } });
    });
});

describe("character_upsert undo", () => {
    it("lands a rename, a colour and new poses as one step that undo takes back whole", async () => {
        const { cast, fakes, run } = harness({ characters: [fakeCharacter("narra", "Narra")] });
        const before = cast.getCharacter("narra")!.toJSON();
        await run(characterUpsert, { id: "narra", name: "Lin", nameColor: "#ff0000", nicknames: ["L"], poses: [{ name: "smile", asset: "lin_smile" }] });
        const live = cast.getCharacter("narra")!;
        expect(live.profile.getName()).toBe("Lin");
        expect(live.profile.appearance.getPoses().map(pose => pose.name)).toEqual(["smile"]);
        expect(fakes.history.describe().find(entry => entry.scopeId === projectHistoryScope())?.undo).toBe(1);

        fakes.history.undo(projectHistoryScope());
        await fakes.history.settled();
        expect(cast.getCharacter("narra")!.toJSON()).toEqual(before);
    });

    it("undoes a creation by removing the character", async () => {
        const { cast, fakes, run } = harness();
        const out = await run(characterUpsert, { name: "林", poses: [{ name: "normal", asset: "lin_smile" }] });
        expect(cast.listCharacter()).toHaveLength(1);
        expect(fakes.history.peekUndo(projectHistoryScope())).toEqual({ key: "characters.history.createCharacter", params: { name: "林" } });
        fakes.history.undo(projectHistoryScope());
        await fakes.history.settled();
        expect(cast.getCharacter(out.character.id)).toBeUndefined();
    });
});
