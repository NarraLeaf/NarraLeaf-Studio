import { describe, expect, it } from "vitest";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryDocument, type StoryScene, type StoryVariableRef } from "@shared/types/story";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { createTestLintContext } from "../testContext";
import type { LintContext, LintStoryEntry } from "../context";
import type { LintFinding, LintRuleId } from "../types";
import { VARIABLES_LINT_RULES } from "./variables";

/**
 * The three `variables` rules.
 *
 * The cases that matter here are the ones where scope decides the answer: a scene variable is only
 * declared for its own scene, a persistent variable may be declared in the project registry with no
 * story row behind it at all, and a blueprint node param is a use exactly like a `/set` row is.
 * Getting any of those wrong turns an error-severity rule into a wall of false positives on a
 * perfectly good project.
 */

// --- fixtures ---------------------------------------------------------------

type BlockSpec = {
    id: string;
    kind: string;
    payload: unknown;
    disabled?: boolean;
    children?: BlockSpec[];
};

function scene(id: string, name: string, specs: BlockSpec[]): StoryScene {
    const blocks: Record<string, unknown> = {};
    const walk = (spec: BlockSpec, parentId: string | null): string => {
        const childrenIds = (spec.children ?? []).map(child => walk(child, spec.id));
        blocks[spec.id] = {
            id: spec.id,
            kind: spec.kind,
            parentId,
            childrenIds,
            payload: spec.payload,
            ...(spec.disabled ? { disabled: true } : {}),
        };
        return spec.id;
    };
    const rootBlockIds = specs.map(spec => walk(spec, null));
    return { id, name, runtimeName: name, rootBlockIds, blocks } as unknown as StoryScene;
}

function story(id: string, name: string, scenes: StoryScene[]): LintStoryEntry {
    const document = {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id,
        name,
        chapters: [],
        scenes: Object.fromEntries(scenes.map(entry => [entry.id, entry])),
    } as StoryDocument;
    return { id, name, document };
}

const declaration = (
    id: string,
    scope: "scene" | "saved" | "persistent",
    name: string,
    storageKey?: string,
): BlockSpec => ({
    id,
    kind: "declaration",
    payload: { scope, name, valueType: "number", storageKey: storageKey ?? id },
});

const setVariable = (id: string, target: StoryVariableRef): BlockSpec => ({
    id,
    kind: "action",
    payload: { action: "setVariable", target, value: 1 },
});

/** A `/set` whose right-hand side is `<name> + 1` - the shape that carries an author-facing name. */
const setFromExpression = (id: string, target: StoryVariableRef, read: StoryVariableRef, name: string): BlockSpec => ({
    id,
    kind: "action",
    payload: {
        action: "setVariable",
        target,
        value: 0,
        expression: {
            source: `${name} + 1`,
            ast: {
                kind: "binary",
                op: "+",
                left: { kind: "var", target: read, name },
                right: { kind: "literal", value: 1 },
            },
        },
    },
});

/** A narration row whose text interpolates a variable. */
const interpolatingLine = (id: string, target: StoryVariableRef): BlockSpec => ({
    id,
    kind: "nodeAction",
    payload: {
        action: "narration",
        text: {
            textId: `t-${id}`,
            value: "",
            role: "narration",
            rich: [{ interpolation: { kind: "variable", target } }],
        },
    },
});

function blueprintWithNode(params: Record<string, unknown>): BlueprintDocument {
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {
            "bp-1": {
                id: "bp-1",
                name: "HUD",
                owner: { kind: "globalMain" },
                frontend: "visual",
                programKind: "graph",
                program: {
                    kind: "graph",
                    graphs: {
                        events: { "ev-1": { id: "ev-1", graph: { nodes: { "n-1": { id: "n-1", type: "blueprint.story.sceneGet", params } } } } },
                        functions: {},
                    },
                },
            },
        },
        ownerRecords: {},
    } as BlueprintDocument;
}

function registryEntry(id: string, name: string, storageKey?: string): VariableRegistryEntry {
    return { id, name, valueType: "number", storageKey: storageKey ?? id };
}

function run(id: LintRuleId, ctx: LintContext): LintFinding[] {
    const rule = VARIABLES_LINT_RULES.find(entry => entry.id === id);
    if (!rule) {
        throw new Error(`no such rule: ${id}`);
    }
    const findings = rule.run(ctx, {});
    if (findings instanceof Promise) {
        throw new Error("variable rules are synchronous");
    }
    return findings;
}

// --- variables/undeclared ---------------------------------------------------

describe("variables/undeclared", () => {
    it("reports a scene variable nothing declares", () => {
        const ctx = createTestLintContext({
            stories: [story("s1", "Main", [scene("sc1", "Prologue", [setVariable("b1", { scope: "scene", variableId: "v1" })])])],
        });

        const findings = run("variables/undeclared", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.variablesUndeclared.message");
        expect(findings[0].messageParams).toEqual({ variable: "v1" });
        expect(findings[0].target).toEqual({
            kind: "storyBlock",
            storyId: "s1",
            sceneId: "sc1",
            blockId: "b1",
            storyName: "Main",
            sceneName: "Prologue",
        });
    });

    it("says nothing when the scene declares it", () => {
        const ctx = createTestLintContext({
            stories: [
                story("s1", "Main", [
                    scene("sc1", "Prologue", [
                        declaration("v1", "scene", "Gold"),
                        setVariable("b1", { scope: "scene", variableId: "v1" }),
                    ]),
                ]),
            ],
        });
        expect(run("variables/undeclared", ctx)).toEqual([]);
    });

    it("does not accept a scene declaration from another scene", () => {
        const ctx = createTestLintContext({
            stories: [
                story("s1", "Main", [
                    scene("sc1", "Prologue", [setVariable("b1", { scope: "scene", variableId: "v1" })]),
                    scene("sc2", "Chapter 1", [declaration("v1", "scene", "Gold")]),
                ]),
            ],
        });

        const findings = run("variables/undeclared", ctx);

        expect(findings).toHaveLength(1);
        // The declaration exists, just not here - so the finding can still name it properly.
        expect(findings[0].messageParams).toEqual({ variable: "Gold" });
        expect(findings[0].location).toMatchObject({ sceneId: "sc1" });
    });

    it("names the variable the way the author typed it in an expression", () => {
        const ctx = createTestLintContext({
            stories: [
                story("s1", "Main", [
                    scene("sc1", "Prologue", [
                        declaration("v1", "scene", "Gold"),
                        setFromExpression("b1", { scope: "scene", variableId: "v1" }, { scope: "saved", variableId: "v2" }, "bonus"),
                    ]),
                ]),
            ],
        });

        const findings = run("variables/undeclared", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageParams).toEqual({ variable: "bonus" });
    });

    it("reads a variable interpolated into a line", () => {
        const ctx = createTestLintContext({
            stories: [story("s1", "Main", [scene("sc1", "Prologue", [interpolatingLine("b1", { scope: "saved", variableId: "v9" })])])],
        });
        expect(run("variables/undeclared", ctx)).toHaveLength(1);
    });

    it("does not flag a persistent variable declared only in the project registry", () => {
        const ctx = createTestLintContext({
            stories: [story("s1", "Main", [scene("sc1", "Prologue", [setVariable("b1", { scope: "persistent", variableId: "pk-1" })])])],
            variableRegistry: [registryEntry("reg-1", "Playthroughs", "pk-1")],
        });
        expect(run("variables/undeclared", ctx)).toEqual([]);
    });

    it("flags a persistent variable no surface declares", () => {
        const ctx = createTestLintContext({
            stories: [story("s1", "Main", [scene("sc1", "Prologue", [setVariable("b1", { scope: "persistent", variableId: "pk-1" })])])],
        });
        expect(run("variables/undeclared", ctx)).toHaveLength(1);
    });

    it("accepts a persistent variable a story row in ANOTHER story declares", () => {
        const ctx = createTestLintContext({
            stories: [
                story("s1", "Main", [scene("sc1", "Prologue", [setVariable("b1", { scope: "persistent", variableId: "pk-1" })])]),
                story("s2", "Side", [scene("sc9", "Extras", [declaration("d1", "persistent", "Playthroughs", "pk-1")])]),
            ],
        });
        expect(run("variables/undeclared", ctx)).toEqual([]);
    });

    it("ignores a disabled row", () => {
        const ctx = createTestLintContext({
            stories: [
                story("s1", "Main", [
                    scene("sc1", "Prologue", [{ ...setVariable("b1", { scope: "scene", variableId: "v1" }), disabled: true }]),
                ]),
            ],
        });
        expect(run("variables/undeclared", ctx)).toEqual([]);
    });

    it("reports one finding per variable per scene, not per row", () => {
        const ctx = createTestLintContext({
            stories: [
                story("s1", "Main", [
                    scene("sc1", "Prologue", [
                        setVariable("b1", { scope: "scene", variableId: "v1" }),
                        setVariable("b2", { scope: "scene", variableId: "v1" }),
                    ]),
                ]),
            ],
        });

        const findings = run("variables/undeclared", ctx);
        expect(findings).toHaveLength(1);
        expect(findings[0].location).toMatchObject({ blockId: "b1" });
    });
});

// --- variables/unused -------------------------------------------------------

describe("variables/unused", () => {
    it("reports a declaration nothing reads or writes", () => {
        const ctx = createTestLintContext({
            stories: [story("s1", "Main", [scene("sc1", "Prologue", [declaration("v1", "scene", "Gold")])])],
        });

        const findings = run("variables/unused", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.variablesUnused.message");
        expect(findings[0].messageParams).toEqual({ variable: "Gold" });
        expect(findings[0].location).toMatchObject({ kind: "story", sceneId: "sc1", blockId: "v1" });
    });

    it("says nothing about a declaration a row writes", () => {
        const ctx = createTestLintContext({
            stories: [
                story("s1", "Main", [
                    scene("sc1", "Prologue", [
                        declaration("v1", "scene", "Gold"),
                        setVariable("b1", { scope: "scene", variableId: "v1" }),
                    ]),
                ]),
            ],
        });
        expect(run("variables/unused", ctx)).toEqual([]);
    });

    it("does not count a scene variable used from another scene", () => {
        const ctx = createTestLintContext({
            stories: [
                story("s1", "Main", [
                    scene("sc1", "Prologue", [declaration("v1", "scene", "Gold")]),
                    scene("sc2", "Chapter 1", [setVariable("b1", { scope: "scene", variableId: "v1" })]),
                ]),
            ],
        });

        const findings = run("variables/unused", ctx);
        expect(findings).toHaveLength(1);
        expect(findings[0].messageParams).toEqual({ variable: "Gold" });
    });

    it("counts a blueprint node param as a use", () => {
        const ctx = createTestLintContext({
            stories: [story("s1", "Main", [scene("sc1", "Prologue", [declaration("v1", "scene", "Gold")])])],
            blueprintDocument: blueprintWithNode({ sceneVariableId: "v1" }),
        });
        expect(run("variables/unused", ctx)).toEqual([]);
    });

    it("counts a use in a disabled row - the row is off, the variable is still wanted", () => {
        const ctx = createTestLintContext({
            stories: [
                story("s1", "Main", [
                    scene("sc1", "Prologue", [
                        declaration("v1", "scene", "Gold"),
                        { ...setVariable("b1", { scope: "scene", variableId: "v1" }), disabled: true },
                    ]),
                ]),
            ],
        });
        expect(run("variables/unused", ctx)).toEqual([]);
    });

    it("resolves a persistent row addressed by its storage key rather than its row id", () => {
        const ctx = createTestLintContext({
            stories: [
                story("s1", "Main", [
                    scene("sc1", "Prologue", [
                        declaration("d1", "persistent", "Playthroughs", "pk-1"),
                        setVariable("b1", { scope: "persistent", variableId: "pk-1" }),
                    ]),
                ]),
            ],
        });
        expect(run("variables/unused", ctx)).toEqual([]);
    });

    it("reports a registry entry nothing uses, against the project", () => {
        const ctx = createTestLintContext({ variableRegistry: [registryEntry("reg-1", "Playthroughs", "pk-1")] });

        const findings = run("variables/unused", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageParams).toEqual({ variable: "Playthroughs" });
        expect(findings[0].location).toEqual({ kind: "project" });
        expect(findings[0].target).toBeUndefined();
    });

    it("says nothing about a registry entry a blueprint node names", () => {
        const ctx = createTestLintContext({
            variableRegistry: [registryEntry("reg-1", "Playthroughs", "pk-1")],
            blueprintDocument: blueprintWithNode({ persistentVariableId: "pk-1" }),
        });
        expect(run("variables/unused", ctx)).toEqual([]);
    });

    it("says nothing about an empty project", () => {
        expect(run("variables/unused", createTestLintContext())).toEqual([]);
    });
});

// --- variables/name-collision -----------------------------------------------

describe("variables/name-collision", () => {
    it("emits one finding per reported collision, anchored on the story row", () => {
        const ctx = createTestLintContext({
            stories: [story("s1", "Main", [scene("sc1", "Prologue", [declaration("d1", "persistent", "Playthroughs", "pk-1")])])],
            persistentNameCollisions: [{ name: "Playthroughs", storageKeys: ["pk-1", "reg-1"] }],
        });

        const findings = run("variables/name-collision", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.variablesNameCollision.message");
        expect(findings[0].messageParams).toEqual({ variable: "Playthroughs" });
        expect(findings[0].location).toMatchObject({ kind: "story", blockId: "d1" });
        expect(findings[0].target).toMatchObject({ kind: "storyBlock", blockId: "d1" });
    });

    it("falls back to the project when no story row carries the key", () => {
        const ctx = createTestLintContext({
            persistentNameCollisions: [{ name: "Playthroughs", storageKeys: ["pk-1", "reg-1"] }],
        });

        const findings = run("variables/name-collision", ctx);

        expect(findings).toHaveLength(1);
        expect(findings[0].location).toEqual({ kind: "project" });
        expect(findings[0].target).toBeUndefined();
    });

    it("says nothing when the merged view reports no collision", () => {
        expect(run("variables/name-collision", createTestLintContext())).toEqual([]);
    });
});
