import { afterEach, describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { ScriptCtx } from "narraleaf-react";
import {
    mountCompiledScripts,
    unmountCompiledScripts,
} from "@/lib/ui-editor/blueprint-runtime/script/scriptRuntime";
import { storyActionOwnerKey } from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import {
    evaluateStoryActionBlueprintValueSync,
    type CompileStoryActionScriptInput,
} from "./storyActionBlueprint";

/**
 * A story row whose logic is a script.
 *
 * The offer was made in three places - a row's action, an inline value and a branch condition - and
 * the starter file even declared `export default async function (ctx: StoryCtx)`, while the
 * compiler's second line skipped anything that was not a graph. So the row did nothing, and said
 * nothing about doing nothing.
 *
 * The value and condition modes are the testable half: both are evaluated synchronously and hand
 * their answer straight back. The action mode goes through NLR's `Script.execute`, whose callback
 * only runs inside a live game.
 */

const BLUEPRINT_ID = "bp-story";
const SCRIPT_REF = "scripts/story.ts";

function blueprintDocument(): BlueprintDocument {
    return {
        blueprints: {
            [BLUEPRINT_ID]: {
                id: BLUEPRINT_ID,
                name: "Condition",
                owner: { kind: "storyAction", blueprintId: BLUEPRINT_ID, mode: "condition" },
                frontend: "typescript",
                programKind: "scriptModule",
                program: { kind: "scriptModule", scriptRef: SCRIPT_REF },
                members: { variables: {}, fields: {}, functions: {} },
                bindings: {},
            },
        },
        // Spelled through the helper: the key format belongs to one function, and a fixture that
        // restates it stops testing the thing that produces it.
        ownerRecords: {
            [storyActionOwnerKey(BLUEPRINT_ID)]: {
                privateBlueprintIds: [BLUEPRINT_ID],
                activeBlueprintId: BLUEPRINT_ID,
            },
        },
    } as unknown as BlueprintDocument;
}

/** A `ScriptCtx` with the one member a story context reads: the save-file namespaces. */
function scriptCtx(saved: Map<string, unknown>): ScriptCtx {
    const namespace = {
        get: (key: string) => saved.get(key),
        set: (key: string, value: unknown) => saved.set(key, value),
        has: (key: string) => saved.has(key),
    };
    return { storable: { getNamespace: () => namespace } } as unknown as ScriptCtx;
}

function input(onDiagnostic?: (message: string) => void): CompileStoryActionScriptInput {
    return {
        blueprintDocument: blueprintDocument(),
        persistentVariables: {} as never,
        blueprintId: BLUEPRINT_ID,
        nlrScene: { name: "scene-1" } as never,
        sceneFnCatalog: { blueprintIds: new Set<string>() },
        sceneVariables: {},
        savedVariables: {
            "var-visited": { id: "var-visited", name: "visited", storageKey: "visited", defaultValue: false } as never,
        },
        savedNamespace: "saved",
        onDiagnostic,
    };
}

async function mount(module: Record<string, unknown>): Promise<void> {
    await mountCompiledScripts(
        { [BLUEPRINT_ID]: { scriptRef: SCRIPT_REF, url: "file:///story.mjs" } },
        undefined,
        async () => module,
    );
}

afterEach(() => {
    unmountCompiledScripts();
});

describe("a story row runs a script", () => {
    it("evaluates the default export and hands back what it returned", async () => {
        await mount({ default: () => true });
        expect(evaluateStoryActionBlueprintValueSync(input(), scriptCtx(new Map()))).toBe(true);
    });

    it("gives the script the row's saved variables, by id, through the same defaulting a graph gets", async () => {
        const saved = new Map<string, unknown>();
        await mount({
            default: (ctx: { saved: { get: (id: string) => unknown; set: (id: string, value: unknown) => void } }) => {
                const before = ctx.saved.get("var-visited");
                ctx.saved.set("var-visited", true);
                return before;
            },
        });

        // The declared default, not undefined: an unwritten variable reads as what it was declared
        // to be, which is what `Get Saved Var` answers in a graph.
        expect(evaluateStoryActionBlueprintValueSync(input(), scriptCtx(saved))).toBe(false);
        expect(saved.get("visited")).toBe(true);
    });

    it("refuses a promise where the story cannot wait, and says so", async () => {
        const messages: string[] = [];
        await mount({ default: async () => true });

        expect(evaluateStoryActionBlueprintValueSync(input(m => messages.push(m)), scriptCtx(new Map()))).toBeUndefined();
        expect(messages).toHaveLength(1);
        // The author's own file, named: the fix is in it and nowhere else.
        expect(messages[0]).toContain(SCRIPT_REF);
        expect(messages[0]).toContain("promise");
    });

    it("names the file when the module exports no default", async () => {
        const messages: string[] = [];
        await mount({ onCall: () => true });

        expect(evaluateStoryActionBlueprintValueSync(input(m => messages.push(m)), scriptCtx(new Map()))).toBeUndefined();
        expect(messages[0]).toContain(SCRIPT_REF);
    });

    it("says nothing when the script never mounted, because the compile already did", async () => {
        // A module that is not there failed to compile or threw while loading, and that was reported
        // against the file where it happened. "No default export" here would be a second, wrong
        // diagnosis of one problem.
        const messages: string[] = [];
        expect(evaluateStoryActionBlueprintValueSync(input(m => messages.push(m)), scriptCtx(new Map()))).toBeUndefined();
        expect(messages).toEqual([]);
    });
});
