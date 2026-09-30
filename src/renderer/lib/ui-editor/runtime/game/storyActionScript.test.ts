import { afterEach, describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { ScriptCtx } from "narraleaf-react";
import {
    mountCompiledScripts,
    unmountCompiledScripts,
} from "@/lib/ui-editor/blueprint-runtime/script/scriptRuntime";
import { storyActionOwnerKey } from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import {
    buildStoryActionHostApi,
    evaluateStoryActionBlueprintValueSync,
    type CompileStoryActionScriptInput,
} from "./storyActionBlueprint";
import { scriptLayerKey } from "@shared/blueprint/blueprintLayers";

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

/** The one layer this fixture blueprint holds. */
const SCRIPT_LAYER_ID = "layer-script";

const BLUEPRINT_ID = "bp-story";
const SCRIPT_REF = "scripts/story.ts";

function blueprintDocument(): BlueprintDocument {
    return {
        blueprints: {
            [BLUEPRINT_ID]: {
                id: BLUEPRINT_ID,
                name: "Condition",
                owner: { kind: "storyAction", blueprintId: BLUEPRINT_ID, mode: "condition" },
                graphs: {
                    eventIds: [SCRIPT_LAYER_ID],
                    events: { [SCRIPT_LAYER_ID]: { id: SCRIPT_LAYER_ID, script: { scriptRef: SCRIPT_REF } } },
                    functions: {},
                },
                members: { variables: {}, fields: {}, functions: {} },
                bindings: {},
            },
        },
        // Spelled through the helper: the key format belongs to one function, and a fixture that
        // restates it stops testing the thing that produces it.
        ownerRecords: {
            [storyActionOwnerKey(BLUEPRINT_ID)]: {
                blueprintId: BLUEPRINT_ID,
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

function input(
    onDiagnostic?: (message: string) => void,
    devtools?: CompileStoryActionScriptInput["devtools"],
): CompileStoryActionScriptInput {
    return {
        devtools,
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
        { [scriptLayerKey(BLUEPRINT_ID, SCRIPT_LAYER_ID)]: { scriptRef: SCRIPT_REF, url: "file:///story.mjs" } },
        undefined,
        async () => module,
    );
}

afterEach(() => {
    unmountCompiledScripts();
});

/**
 * The graph half of the same seam.
 *
 * A `Log` node placed in a story row reads `hostAdapter.blueprintRuntime?.hostApi?.devtools?.log`
 * and falls back to the console when it is not there. It was never there: the row's host API was
 * built only when the host had a persistence bridge, and carried nothing else when it was. So the
 * node wrote to the console and to nowhere an author looks.
 */
describe("a story row's host API", () => {
    it("carries devtools whether or not the host has persistence", () => {
        const lines: string[] = [];
        const withHost = buildStoryActionHostApi(input(undefined, { log: (_level, message) => lines.push(message) }));
        withHost.devtools!.log("info", "through the host");
        expect(lines).toEqual(["through the host"]);

        // No persistence bridge, and the object still exists: that absence is what used to remove
        // the whole host API, and with it every `Log` node's only route to the panel.
        expect(buildStoryActionHostApi(input()).devtools).toBeDefined();
    });

    it("omits persistence when the host has none, rather than answering with a broken one", () => {
        expect(buildStoryActionHostApi(input()).persistence).toBeUndefined();
    });
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

    it("hands the row's script the host's own devtools, so a line reaches the Output panel", async () => {
        const lines: Array<[string, string]> = [];
        await mount({
            default: (ctx: { devtools: { log: (level: string, message: string) => void } }) => {
                ctx.devtools.log("info", "from the row");
                return true;
            },
        });

        expect(
            evaluateStoryActionBlueprintValueSync(input(undefined, { log: (level, message) => lines.push([level, message]) }), scriptCtx(new Map())),
        ).toBe(true);
        expect(lines).toEqual([["info", "from the row"]]);
    });

    it("still gives a script devtools when the host has no debugger, so the call never throws", async () => {
        // A workspace scene preview compiles with no host stream. The console half of the log still
        // runs; what must not happen is a script failing on a member the types promise it.
        await mount({
            default: (ctx: { devtools: { log: (level: string, message: string) => void } }) => {
                ctx.devtools.log("info", "nowhere to go");
                return "survived";
            },
        });
        expect(evaluateStoryActionBlueprintValueSync(input(), scriptCtx(new Map()))).toBe("survived");
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
