import { describe, expect, it, vi } from "vitest";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope, storySceneHistoryScope } from "../history/historyScopes";
import { Services, type WorkspaceContext } from "../services";
import { applyRenamePlan } from "./applyRename";
import type { StoryBlock, StoryDocument, StoryScene, StoryVariableRef } from "@shared/types/story";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { createStoryExpressionScope, parseStoryExpression } from "@shared/utils/storyExpressionParser";
import {
    collectVariableReferences,
    countSelected,
    planCharacterRename,
    planLabelRename,
    planSceneRename,
    planVariableRename,
    validateRenameName,
    variableNamesInReach,
    type RenameStory,
    type VariableSubject,
} from "./renameModel";

const GOLD: StoryVariableRef = { scope: "scene", variableId: "decl_gold" };
const FAME: StoryVariableRef = { scope: "saved", variableId: "reg_fame" };

const SCOPE = createStoryExpressionScope(
    [
        { name: "gold", ref: GOLD },
        { name: "fame", ref: FAME },
    ],
    { scenes: [{ id: "sc_a", name: "Corridor" }, { id: "sc_b", name: "Hall" }] },
);
const expr = (source: string) => parseStoryExpression(source, SCOPE).expression;

let seq = 0;
function block(kind: StoryBlock["kind"], payload: unknown, id = `b${++seq}`): StoryBlock {
    return { id, kind, parentId: null, childrenIds: [], payload } as unknown as StoryBlock;
}

function scene(id: string, name: string, blocks: StoryBlock[]): StoryScene {
    return {
        id,
        name,
        runtimeName: id,
        rootBlockIds: blocks.map(entry => entry.id),
        blocks: Object.fromEntries(blocks.map(entry => [entry.id, entry])),
    } as StoryScene;
}

function story(scenes: StoryScene[]): RenameStory {
    const document = {
        id: "st",
        name: "Main",
        version: 1,
        chapters: [{ id: "ch", name: "One", sceneIds: scenes.map(entry => entry.id) }],
        scenes: Object.fromEntries(scenes.map(entry => [entry.id, entry])),
    } as unknown as StoryDocument;
    return { id: "st", name: "Main", document };
}

function fixture() {
    const declaration = block("declaration", { scope: "scene", name: "gold", valueType: "number", storageKey: "decl_gold" }, "decl_gold");
    const setGold = block("action", { action: "setVariable", target: GOLD, value: null, expression: expr("gold + fame") }, "set_gold");
    const ifGold = block("control", { control: "conditionBranch", branch: "if", condition: { kind: "expression", expression: expr("gold >= 10 && visited(Corridor)") } }, "if_gold");
    const flagRead = block("control", { control: "conditionBranch", branch: "elseIf", condition: { kind: "variable", target: GOLD, operator: "isTrue" } }, "if_flag");
    const line = block("nodeAction", {
        action: "dialogue",
        speakerName: "Alice",
        text: { textId: "t1", value: "You have ", role: "dialogue", rich: [{ text: "You have " }, { interpolation: { kind: "expression", expression: expr("gold * 2") } }] },
    }, "line");
    const wait = block("action", { action: "input", operation: "wait", resultTarget: FAME }, "wait");
    const label = block("control", { control: "label", name: "retry" }, "label");
    const goto = block("control", { control: "goto", targetLabel: "retry" }, "goto");
    const gotoOther = block("control", { control: "goto", targetLabel: "Retry" }, "goto2");
    const a = scene("sc_a", "Corridor", [declaration, setGold, ifGold, flagRead, line, wait, label, goto, gotoOther]);
    const otherGold = block("control", { control: "conditionBranch", branch: "if", condition: { kind: "expression", expression: expr("fame > 0") } }, "fame_b");
    const b = scene("sc_b", "Hall", [otherGold]);
    return story([a, b]);
}

const GOLD_SUBJECT: VariableSubject = {
    kind: "variable",
    ref: GOLD,
    name: "gold",
    declaration: { source: "story", storyId: "st", sceneId: "sc_a", blockId: "decl_gold" },
};
const FAME_SUBJECT: VariableSubject = { kind: "variable", ref: FAME, name: "fame", declaration: { source: "registry", entryId: "reg_fame" } };

describe("collectVariableReferences", () => {
    it("lists the declaration, every read and every write, by slot", () => {
        const sites = collectVariableReferences({ stories: [fixture()], ref: GOLD, declaration: GOLD_SUBJECT.declaration });
        expect(sites.map(site => [site.blockId, site.access, site.slot])).toEqual([
            ["decl_gold", "declaration", "declaration"],
            ["set_gold", "write", "assignTarget"],
            ["set_gold", "read", "assignValue"],
            ["if_gold", "read", "condition"],
            ["if_flag", "read", "condition"],
            ["line", "read", "text"],
        ]);
        expect(sites[3]).toMatchObject({ line: 3, sceneName: "Corridor", excerpt: "gold >= 10 && visited(Corridor)" });
    });

    it("counts an into= target as a write and reaches every scene for a project variable", () => {
        const blueprints = {
            blueprints: {
                bp1: {
                    id: "bp1",
                    name: "Shop",
                    graphs: { events: { ev: { graph: { nodes: { n1: { id: "n1", type: "blueprint.saved.set", params: { savedVariableId: "reg_fame" } } } } } } },
                },
            },
            ownerRecords: { "surfaceMain:s1": { blueprintId: "bp1" } },
        } as unknown as BlueprintDocument;
        const sites = collectVariableReferences({ stories: [fixture()], ref: FAME, declaration: FAME_SUBJECT.declaration, blueprints });
        expect(sites.map(site => [site.blockId ?? site.slot, site.access])).toEqual([
            ["registry", "declaration"],
            ["set_gold", "read"],
            ["wait", "write"],
            ["fame_b", "read"],
            ["blueprintNode", "write"],
        ]);
        expect(sites[4].target).toMatchObject({ kind: "blueprint", blueprintId: "bp1", ownerKey: "surfaceMain:s1", focusNodeId: "n1" });
    });
});

describe("planVariableRename", () => {
    it("rewrites the declaration and every expression, and lists id references as followers", () => {
        const plan = planVariableRename({ subject: GOLD_SUBJECT, newName: "coins", stories: [fixture()] });
        expect(plan.failures).toEqual([]);
        expect(plan.edits.map(edit => [edit.site.blockId, edit.before, edit.after])).toEqual([
            ["decl_gold", "gold", "coins"],
            ["set_gold", "gold + fame", "coins + fame"],
            ["if_gold", "gold >= 10 && visited(Corridor)", "coins >= 10 && visited(Corridor)"],
            ["line", "gold * 2", "coins * 2"],
        ]);
        expect(plan.followers.map(site => [site.blockId, site.slot])).toEqual([
            ["set_gold", "assignTarget"],
            ["if_flag", "condition"],
        ]);
        expect(countSelected(plan, new Set([plan.edits[1].id]))).toBe(3);
        // The declaration cannot be unticked.
        expect(countSelected(plan, new Set([plan.edits[0].id]))).toBe(4);
    });

    it("writes a registry variable's name through the registry, across scenes", () => {
        const plan = planVariableRename({ subject: FAME_SUBJECT, newName: "renown", stories: [fixture()] });
        expect(plan.edits.map(edit => edit.change.kind)).toEqual(["registryName", "blockExpression", "blockExpression"]);
        expect(plan.edits[2]).toMatchObject({ before: "fame > 0", after: "renown > 0" });
        expect(plan.followers.map(site => site.blockId)).toEqual(["wait"]);
    });
});

describe("label, scene and character plans", () => {
    it("renames a label and the exact-name gotos of its scene", () => {
        const plan = planLabelRename({ subject: { kind: "label", storyId: "st", sceneId: "sc_a", blockId: "label", name: "retry" }, newName: "again", stories: [fixture()] });
        expect(plan.edits.map(edit => [edit.site.blockId, edit.change.kind])).toEqual([["label", "labelName"], ["goto", "gotoTarget"]]);
    });

    it("renames a scene and its visited() reads", () => {
        const plan = planSceneRename({ subject: { kind: "scene", storyId: "st", sceneId: "sc_a", name: "Corridor" }, newName: "Long Hall", stories: [fixture()] });
        expect(plan.edits.map(edit => edit.after)).toEqual(["Long Hall", "gold >= 10 && visited('Long Hall')"]);
    });

    it("offers the rows speaking as a character's bare name", () => {
        const plan = planCharacterRename({ subject: { kind: "character", characterId: "c1", name: "Alice" }, newName: "Alicia", stories: [fixture()] });
        expect(plan.edits.map(edit => edit.change.kind)).toEqual(["characterName", "speakerName"]);
    });
});

describe("validateRenameName", () => {
    it("refuses empty, unchanged, reserved and taken names", () => {
        expect(validateRenameName(GOLD_SUBJECT, "  ", [])).toEqual({ code: "empty" });
        expect(validateRenameName(GOLD_SUBJECT, "gold", [])).toEqual({ code: "unchanged" });
        expect(validateRenameName(GOLD_SUBJECT, "AppTag", [])).toEqual({ code: "reserved" });
        const taken = variableNamesInReach({ subject: GOLD_SUBJECT, stories: [fixture()], registry: [{ id: "reg_fame", scope: "saved", name: "fame", storageKey: "reg_fame", valueType: "number" } as never] });
        expect(validateRenameName(GOLD_SUBJECT, "FAME", taken)).toEqual({ code: "taken" });
        expect(validateRenameName(GOLD_SUBJECT, "Gold", taken)).toBeNull();
    });

    it("compares labels exactly, as the engine does", () => {
        const subject = { kind: "label" as const, storyId: "st", sceneId: "sc_a", blockId: "label", name: "retry" };
        expect(validateRenameName(subject, "start", ["Start"])).toBeNull();
        expect(validateRenameName(subject, "Start", ["Start"])).toEqual({ code: "taken" });
    });
});

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

function makeContext(renameStory: RenameStory) {
    const history = new HistoryService();
    const registry = new Map([["reg_fame", { id: "reg_fame", name: "fame" }]]);
    const storyService = {
        getStoryDocument: () => renameStory.document,
        updateBlocks(_storyId: string, edits: readonly { sceneId: string; blockId: string; payload: StoryBlock["payload"] }[]) {
            for (const edit of edits) {
                renameStory.document.scenes[edit.sceneId].blocks[edit.blockId].payload = edit.payload;
            }
        },
        renameScene(_storyId: string, sceneId: string, name: string) {
            renameStory.document.scenes[sceneId].name = name;
            return true;
        },
    };
    const registryService = {
        getEntry: (id: string) => registry.get(id),
        renameEntry: (id: string, name: string) => {
            const entry = registry.get(id);
            if (entry) entry.name = name;
        },
    };
    const ctx = {
        project: {} as never,
        services: {
            get(id: Services) {
                if (id === Services.Story) return storyService;
                if (id === Services.History) return history;
                if (id === Services.VariableRegistry) return registryService;
                throw new Error(`Unexpected service ${id}`);
            },
        },
    } as unknown as WorkspaceContext;
    history.setContext(ctx);
    return { ctx, history, registry };
}

const sourceOf = (renameStory: RenameStory, blockId: string): string => {
    const payload = renameStory.document.scenes.sc_a.blocks[blockId].payload as { condition?: { expression: { source: string } }; expression?: { source: string } };
    return payload.condition?.expression.source ?? payload.expression?.source ?? "";
};

describe("applyRenamePlan", () => {
    it("applies the ticked edits and takes them all back in one project step", async () => {
        const renameStory = fixture();
        const { ctx, history, registry } = makeContext(renameStory);
        const plan = planVariableRename({ subject: FAME_SUBJECT, newName: "renown", stories: [renameStory] });
        const skipped = plan.edits.find(edit => edit.site.blockId === "fame_b")!;
        expect(await applyRenamePlan(ctx, plan, new Set([skipped.id]))).toBe(true);
        expect(registry.get("reg_fame")?.name).toBe("renown");
        expect(sourceOf(renameStory, "set_gold")).toBe("gold + renown");
        const otherScene = renameStory.document.scenes.sc_b.blocks.fame_b.payload as { condition: { expression: { source: string } } };
        expect(otherScene.condition.expression.source).toBe("fame > 0");

        expect(history.undo(projectHistoryScope())).toBe(true);
        await history.settled();
        expect(registry.get("reg_fame")?.name).toBe("fame");
        expect(sourceOf(renameStory, "set_gold")).toBe("gold + fame");

        expect(history.redo(projectHistoryScope())).toBe(true);
        await history.settled();
        expect(sourceOf(renameStory, "set_gold")).toBe("gold + renown");
    });

    it("leaves a row edited since the rename as the author left it", async () => {
        const renameStory = fixture();
        const { ctx, history } = makeContext(renameStory);
        const plan = planSceneRename({ subject: { kind: "scene", storyId: "st", sceneId: "sc_a", name: "Corridor" }, newName: "Long Hall", stories: [renameStory] });
        await applyRenamePlan(ctx, plan, new Set());
        expect(renameStory.document.scenes.sc_a.name).toBe("Long Hall");
        const condition = (renameStory.document.scenes.sc_a.blocks.if_gold.payload as { condition: { expression: { source: string } } }).condition;
        condition.expression = { ...condition.expression, source: "gold >= 99 && visited('Long Hall')" };
        expect(history.undo(storySceneHistoryScope("st", "sc_a"))).toBe(true);
        await history.settled();
        expect(renameStory.document.scenes.sc_a.name).toBe("Corridor");
        expect(sourceOf(renameStory, "if_gold")).toBe("gold >= 99 && visited('Long Hall')");
    });

    it("refuses a plan with a site it could not rewrite", async () => {
        const renameStory = fixture();
        const { ctx } = makeContext(renameStory);
        const plan = planVariableRename({ subject: GOLD_SUBJECT, newName: "coins", stories: [renameStory] });
        plan.failures.push(plan.edits[1].site);
        expect(await applyRenamePlan(ctx, plan, new Set())).toBe(false);
        expect(sourceOf(renameStory, "set_gold")).toBe("gold + fame");
    });
});
