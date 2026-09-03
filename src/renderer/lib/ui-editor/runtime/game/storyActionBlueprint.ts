/**
 * Compiles a Story Action Blueprint (a graph blueprint bound 1:1 to a story action) into an NLR
 * `Script` action. The Script handler runs the blueprint's "On Call" graph through the shared
 * behavior-graph interpreter, mapping variable scopes onto NLR stores:
 *   - Var        -> ephemeral graph execution locals
 *   - Scene var  -> NLR `Scene.local` (per-scene, in-save)
 *   - Saved var  -> NLR `Storable` namespace (per save-file)
 *   - Persistent -> shared host persistence bridge (app-level, cross-save)
 * The handler returns a `ScriptCleaner` so NLR can cancel in-flight async work on undo/load/interrupt.
 * Comments in English per project convention.
 */

import type { PersistentVariableRuntimeTable } from "@shared/types/variables/registry";
import { Script } from "narraleaf-react";
import type { Scene, ScriptCtx } from "narraleaf-react";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { collectStoryActionEventHeadNodeIdsForDispatch } from "@shared/types/blueprint/graph";
import { buildBlueprintRunGraphId } from "@shared/blueprint/blueprintRunGraphId";
import { blueprintAnchor } from "@shared/blueprint/ownerShape";
import type {
    StoryDocument,
    StorySavedVariableDefinition,
    StoryScene,
    StorySceneVariableDefinition,
} from "@shared/types/story";
import { adaptBlueprintGraphIr } from "@/lib/ui-editor/blueprint-runtime/adaptBlueprintGraphIr";
import { executeGraph } from "@/lib/ui-editor/behavior-graph/GraphExecutor";
import { executeGraphSync } from "@/lib/ui-editor/behavior-graph/executeGraphSync";
import { isBlueprintGraphExecutionCancelledError } from "@/lib/ui-editor/behavior-graph/GraphExecutionError";
import { writeBlueprintNodeOutputValues } from "@/lib/ui-editor/blueprint-nodes/nodeOutputValues";
import { findBlueprintFnByRef } from "@/lib/workspace/services/ui-editor/blueprint/fnCatalog";
import { storyActionOwnerKey } from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import type { StoryVariableRuntimeAccess, UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { isScriptMounted, resolveScriptDefault } from "@/lib/ui-editor/blueprint-runtime/script/scriptRuntime";
import { scriptLayerKey, soleScriptLayer, type ScriptLayerEntry } from "@shared/blueprint/blueprintLayers";
import { createBlueprintDevtoolsApi } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { BlueprintHostApiRuntime } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type {
    StoryScriptContext,
    StorySyncScriptContext,
} from "@/lib/ui-editor/blueprint-runtime/script/scriptContext";

const MAX_STORY_FN_CALL_DEPTH = 32;

/** Scene-scoped Fn visibility: story-action fns are callable across blueprints of the same scene. */
export type StoryActionFnCatalog = {
    /** Story-action blueprint ids referenced by this scene; used for scene-scoped fn visibility. */
    blueprintIds: ReadonlySet<string>;
};

export type StoryPersistenceBridgeLike = {
    get: (storageKey: string) => unknown;
    set: (storageKey: string, value: unknown) => void | Promise<void>;
};

/**
 * Where a story row's log lines go: the same debug stream a Surface blueprint writes to.
 *
 * Supplied by the host rather than built here, because what is on the other end is the host's
 * business - Dev Mode's Output panel, and the log a packaged game keeps. A host that has no
 * debugger passes none, and the fallback below still writes the console line: that half has always
 * worked, and it is the half a `Log` node in a story row was reaching before this member existed.
 */
export type StoryDevtoolsBridge = BlueprintHostApiRuntime["devtools"];

export type CompileStoryActionScriptInput = {
    blueprintDocument: BlueprintDocument;
    /** M-VAR: persistent variable definitions (baked from the registry), replacing the old blueprint-doc field. */
    persistentVariables: PersistentVariableRuntimeTable;
    blueprintId: string;
    nlrScene: Scene;
    sceneFnCatalog: StoryActionFnCatalog;
    sceneVariables: Record<string, StorySceneVariableDefinition>;
    savedVariables: Record<string, StorySavedVariableDefinition>;
    savedNamespace: string;
    persistence?: StoryPersistenceBridgeLike;
    devtools?: StoryDevtoolsBridge;
    onDiagnostic?: (message: string) => void;
};

/**
 * Collect the story-action blueprint ids referenced by a scene's `{action:"blueprint"}` blocks.
 * "Compile all scene blueprints on scene start" (for Fn sharing) is realized at compile time here:
 * every referenced blueprint contributes its Fn declarations to the scene-shared catalog.
 */
export function collectSceneStoryActionFns(input: {
    document: StoryDocument;
    blueprintDocument?: BlueprintDocument;
    scene: StoryScene;
}): StoryActionFnCatalog {
    const blueprintIds = new Set<string>();
    for (const block of Object.values(input.scene.blocks)) {
        if (block.kind === "action" && block.payload.action === "blueprint" && block.payload.blueprintId) {
            blueprintIds.add(block.payload.blueprintId);
        }
    }
    return { blueprintIds };
}

function resolveActiveStoryActionBlueprint(document: BlueprintDocument, blueprintId: string) {
    const ownerKey = storyActionOwnerKey(blueprintId);
    const activeId = document.ownerRecords?.[ownerKey]?.blueprintId ?? blueprintId;
    return document.blueprints?.[activeId] ?? document.blueprints?.[blueprintId];
}

type StoryActionExecutionEnv = {
    input: CompileStoryActionScriptInput;
    hostAdapter: UIHostAdapter;
    signal: AbortSignal;
};

/**
 * Compile a Story Action Blueprint into an NLR `Script` action, or `null` when it cannot be compiled
 * (missing blueprint, or no "On Call" layer). The action form ignores any Return Value.
 *
 * A story row has one event head, so it has one layer, and that layer is a graph or one of the
 * author's files.
 */
export function compileStoryActionBlueprintToScript(input: CompileStoryActionScriptInput): unknown {
    const bp = resolveActiveStoryActionBlueprint(input.blueprintDocument, input.blueprintId);
    if (!bp) {
        input.onDiagnostic?.("Story Action Blueprint not found; the action was skipped.");
        return null;
    }
    const script = soleScriptLayer(bp);
    if (script) {
        return compileStoryActionScriptModule(input, bp.name, script);
    }

    return Script.execute((ctx: ScriptCtx) => {
        const abort = new AbortController();
        const hostAdapter = buildStoryActionHostAdapter(input, ctx, abort.signal);
        const env: StoryActionExecutionEnv = { input, hostAdapter, signal: abort.signal };
        void runStoryActionOnCall(env).catch(err => {
            if (!isBlueprintGraphExecutionCancelledError(err)) {
                // Surface unexpected runtime errors; NLR treats the action itself as complete.
                console.error("[storyActionBlueprint] execution error", err);
            }
        });
        // ScriptCleaner: cancel in-flight async graph work on undo / load / game interrupt.
        return () => abort.abort();
    });
}

/**
 * A story row whose logic is a script: its default export, run with the story context.
 *
 * The same `Script.execute` shape a graph compiles to, so the row behaves identically from NLR's
 * side - the cleaner included, which aborts the signal the handler was given when the player undoes,
 * loads or interrupts. The export is resolved when the row runs rather than when it is compiled,
 * because Dev Mode remounts modules on every save and a handler captured here would be the one from
 * before the author's edit.
 */
function compileStoryActionScriptModule(
    input: CompileStoryActionScriptInput,
    name: string,
    layer: ScriptLayerEntry,
): unknown {
    return Script.execute((ctx: ScriptCtx) => {
        const abort = new AbortController();
        const handler = resolveScriptDefault(scriptLayerKey(input.blueprintId, layer.layerId));
        if (!handler) {
            reportMissingDefaultExport(input, name, layer, "this action was skipped");
            return () => undefined;
        }
        const storyCtx = buildStoryScriptContext(input, ctx, abort.signal);
        void Promise.resolve(handler(storyCtx)).catch(error => {
            if (!isBlueprintGraphExecutionCancelledError(error)) {
                console.error("[storyActionBlueprint] script error", error);
            }
        });
        return () => abort.abort();
    });
}

/**
 * The context a story script is handed: the story's own two variable stores, app persistence, and
 * the signal that is aborted when the row is undone.
 *
 * Assembled from the same accessors the graph's `Get Scene Var` and `Get Persistent` nodes reach, so
 * the two frontends can do the same things from a row and no more.
 */
function buildStoryScriptContext(
    input: CompileStoryActionScriptInput,
    ctx: ScriptCtx,
    signal: AbortSignal,
): StoryScriptContext {
    const access = buildStoryVariableAccess(input, ctx);
    const persistence = input.persistence;
    const unavailable = () => {
        throw new Error("This game has no persistence bridge, so ctx.persistent cannot be read here");
    };
    return {
        self: { kind: "storyRow" },
        scene: access.sceneVar,
        saved: access.savedVar,
        devtools: storyDevtools(input),
        persistent: {
            get: async (storageKey: string) => (persistence ? persistence.get(storageKey) : unavailable()),
            set: async (storageKey: string, value: unknown) => {
                if (!persistence) {
                    unavailable();
                    return;
                }
                assertSerializable(value);
                await persistence.set(storageKey, value);
            },
        },
        signal,
    };
}

/**
 * The synchronous half of that context, for an inline value and for a condition.
 *
 * No `persistent` and no `signal`: both are evaluated where the story asks for the value and cannot
 * wait, which is the same rule that keeps a latent node out of their graphs.
 */
function buildStorySyncScriptContext(
    input: CompileStoryActionScriptInput,
    ctx: ScriptCtx,
): StorySyncScriptContext {
    const access = buildStoryVariableAccess(input, ctx);
    return {
        self: { kind: "storyRow" },
        scene: access.sceneVar,
        saved: access.savedVar,
        devtools: storyDevtools(input),
    };
}

/**
 * Evaluate a Story Action Blueprint's "On Call" graph SYNCHRONOUSLY and return its captured Return
 * Value. Used for inline text interpolation, where a NarraLeaf-React dynamic `Word` must produce a
 * value in the same tick and cannot await. Inline blueprints are restricted to synchronous nodes at
 * authoring time (no `isLatent`/async nodes); if an async node is nonetheless reached, `executeGraphSync`
 * throws `AsyncNodeInSyncGraphError`, which the caller catches and renders as empty. Returns `undefined`
 * when the blueprint is missing or is not a graph.
 */
export function evaluateStoryActionBlueprintValueSync(input: CompileStoryActionScriptInput, ctx: ScriptCtx): unknown {
    const bp = resolveActiveStoryActionBlueprint(input.blueprintDocument, input.blueprintId);
    if (!bp) {
        return undefined;
    }
    const scriptLayer = soleScriptLayer(bp);
    if (scriptLayer) {
        return evaluateStoryScriptValueSync(input, ctx, bp.name, scriptLayer);
    }
    // No async work runs synchronously, so a never-aborting signal suffices for the host adapter.
    const hostAdapter = buildStoryActionHostAdapter(input, ctx, new AbortController().signal);
    let lastReturn: unknown;
    for (const eventGraph of Object.values(bp.graphs.events ?? {})) {
        const ir = eventGraph.graph;
        const headIds = collectStoryActionEventHeadNodeIdsForDispatch(ir?.nodes);
        if (headIds.length === 0 || !ir) continue;
        const graph = adaptBlueprintGraphIr(ir, buildBlueprintRunGraphId("storyActionValue", bp.id, eventGraph.id));
        for (const headId of headIds) {
            const result = executeGraphSync({
                graph,
                entry: { start: { nodeId: headId, port: "then" as const } },
                hostAdapter,
                blueprintLocals: {},
                eventName: "onCall",
                executionOwner: { blueprintId: bp.id },
                persistentVariables: input.persistentVariables,
            });
            if (result.returnValueSet) lastReturn = result.returnValue;
        }
    }
    return lastReturn;
}

/**
 * A value or a condition written as a script: its default export, called for what it returns.
 *
 * A returned promise is refused rather than rendered. Both callers put the answer somewhere that
 * cannot wait - a word being drawn, a branch being tested - and `String(aPromise)` would put
 * "[object Promise]" on screen and take the branch, which is the shape of bug that teaches an author
 * the wrong thing about their own code.
 */
function evaluateStoryScriptValueSync(
    input: CompileStoryActionScriptInput,
    ctx: ScriptCtx,
    name: string,
    layer: ScriptLayerEntry,
): unknown {
    const handler = resolveScriptDefault(scriptLayerKey(input.blueprintId, layer.layerId));
    if (!handler) {
        reportMissingDefaultExport(input, name, layer, "nothing was evaluated");
        return undefined;
    }
    const value = handler(buildStorySyncScriptContext(input, ctx));
    if (value instanceof Promise) {
        input.onDiagnostic?.(
            `"${name}" is evaluated where the story cannot wait, so ${layer.script.scriptRef} must return a value rather than a promise.`,
        );
        return undefined;
    }
    return value;
}

/**
 * Why there was nothing to run, told apart.
 *
 * A module that never mounted failed to compile or threw while it was being evaluated, and that was
 * already reported against the file where it happened - saying "no default export" as well would be
 * a second, wrong diagnosis of one problem. A module that did mount and exports no default is the
 * author's spelling, and only then is it worth a line.
 */
function reportMissingDefaultExport(
    input: CompileStoryActionScriptInput,
    name: string,
    layer: ScriptLayerEntry,
    outcome: string,
): void {
    if (!isScriptMounted(scriptLayerKey(input.blueprintId, layer.layerId))) {
        return;
    }
    input.onDiagnostic?.(
        `"${name}" exports no default from ${layer.script.scriptRef}, which is how a story row enters a script; ${outcome}.`,
    );
}

type StorableNamespaceLike = {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => unknown;
    has: (key: string) => boolean;
};

/**
 * The host API a story row's nodes are given: the two families a row may reach, and no more.
 *
 * Always an object, where it used to be absent unless the host had a persistence bridge. `devtools`
 * is a member every host can answer - the console half needs nothing - and a `Log` node placed in a
 * story row reads exactly `hostApi?.devtools?.log`, so an absent object was the whole of why that
 * node wrote nothing to the panel. The members stay individually optional, which is what lets a row
 * carry these two and none of the forty a Surface blueprint's host carries.
 */
export function buildStoryActionHostApi(input: CompileStoryActionScriptInput): Partial<BlueprintHostApiRuntime> {
    const persistence = input.persistence;
    return {
        devtools: storyDevtools(input),
        ...(persistence
            ? {
                  persistence: {
                      get: async (storageKey: string) => persistence.get(storageKey),
                      set: async (storageKey: string, value: unknown) => {
                          assertSerializable(value);
                          await persistence.set(storageKey, value);
                      },
                  },
              }
            : {}),
    };
}

/**
 * The devtools this run writes to: the host's, or a console-only stand-in.
 *
 * The stand-in is the same implementation with nowhere to emit, rather than a second one: a host
 * without a debugger should still put the line where a developer looks for it, and writing that
 * line twice is how the two spellings of it drift.
 */
function storyDevtools(input: CompileStoryActionScriptInput): StoryDevtoolsBridge {
    return input.devtools ?? createBlueprintDevtoolsApi(() => undefined);
}

/**
 * The story's two variable stores, by variable id.
 *
 * Shared by the graph's host adapter and by a script's ctx so both frontends read and write the same
 * values through the same defaulting and the same serialization check - a second copy of this would
 * be a second answer to "what is this variable worth".
 */
function buildStoryVariableAccess(
    input: CompileStoryActionScriptInput,
    ctx: ScriptCtx,
): { sceneVar: StoryVariableRuntimeAccess; savedVar: StoryVariableRuntimeAccess } {
    const sceneNamespace = () => ctx.storable.getNamespace(sceneLocalNamespaceName(input.nlrScene));
    const savedNamespace = () => ctx.storable.getNamespace(input.savedNamespace);

    const sceneVar: StoryVariableRuntimeAccess = {
        get: variableId => {
            const def = input.sceneVariables[variableId];
            if (!def) return undefined;
            const ns = sceneNamespace();
            return ns.has(def.storageKey) ? ns.get(def.storageKey) : def.defaultValue;
        },
        set: (variableId, value) => {
            const def = input.sceneVariables[variableId];
            if (def) sceneNamespace().set(def.storageKey, value);
        },
    };

    const savedVar: StoryVariableRuntimeAccess = {
        get: variableId => {
            const def = input.savedVariables[variableId];
            if (!def) return undefined;
            const ns = savedNamespace();
            return ns.has(def.storageKey) ? ns.get(def.storageKey) : def.defaultValue;
        },
        set: (variableId, value) => {
            const def = input.savedVariables[variableId];
            if (!def) return;
            assertSerializable(value);
            savedNamespace().set(def.storageKey, value);
        },
    };

    return { sceneVar, savedVar };
}

function buildStoryActionHostAdapter(
    input: CompileStoryActionScriptInput,
    ctx: ScriptCtx,
    signal: AbortSignal,
): UIHostAdapter {
    const { sceneVar, savedVar } = buildStoryVariableAccess(input, ctx);
    const hostApi = buildStoryActionHostApi(input);

    const adapter: Partial<UIHostAdapter> = {
        host: undefined as unknown as UIHostAdapter["host"],
        storyRuntime: { sceneVar, savedVar },
        blueprintRuntime: {
            invokeBlueprintFn: (fnInput: { fnRef: string; args: Record<string, unknown>; depth: number; signal?: AbortSignal }) =>
                invokeStoryActionFn({
                    fnRef: fnInput.fnRef,
                    args: fnInput.args,
                    depth: fnInput.depth,
                    signal: fnInput.signal ?? signal,
                    input,
                    buildHostAdapter: () => adapter as UIHostAdapter,
                }),
            hostApi,
        } as unknown as UIHostAdapter["blueprintRuntime"],
    };
    return adapter as UIHostAdapter;
}

async function runStoryActionOnCall(env: StoryActionExecutionEnv): Promise<unknown> {
    const bp = resolveActiveStoryActionBlueprint(env.input.blueprintDocument, env.input.blueprintId);
    if (!bp) {
        return undefined;
    }
    let lastReturn: unknown;
    for (const eventGraph of Object.values(bp.graphs.events ?? {})) {
        const ir = eventGraph.graph;
        const headIds = collectStoryActionEventHeadNodeIdsForDispatch(ir?.nodes);
        if (headIds.length === 0 || !ir) continue;
        const graph = adaptBlueprintGraphIr(ir, buildBlueprintRunGraphId("storyAction", bp.id, eventGraph.id));
        for (const headId of headIds) {
            const result = await executeGraph({
                graph,
                entry: { start: { nodeId: headId, port: "then" as const } },
                hostAdapter: env.hostAdapter,
                blueprintLocals: {},
                eventName: "onCall",
                executionOwner: { blueprintId: bp.id },
                persistentVariables: env.input.persistentVariables,
                signal: env.signal,
            });
            if (result.returnValueSet) lastReturn = result.returnValue;
        }
    }
    return lastReturn;
}

async function invokeStoryActionFn(options: {
    fnRef: string;
    args: Record<string, unknown>;
    depth: number;
    signal?: AbortSignal;
    input: CompileStoryActionScriptInput;
    buildHostAdapter: () => UIHostAdapter;
}): Promise<{ returns: Record<string, unknown> }> {
    const { fnRef, args, depth, input } = options;
    if (depth >= MAX_STORY_FN_CALL_DEPTH) {
        throw new Error(`Fn call depth exceeded ${MAX_STORY_FN_CALL_DEPTH} (recursive call?)`);
    }
    const decl = findBlueprintFnByRef(input.blueprintDocument, fnRef);
    if (!decl) {
        throw new Error(`Fn does not exist: ${fnRef}`);
    }
    // Project-wide fns are callable from anywhere; a story fn only from a scene that reaches its
    // row. Every other position - a surface, a widget, a component definition - is a UI pool a
    // compiled story cannot see into.
    const declAnchor = blueprintAnchor(decl.owner);
    const visible =
        declAnchor.kind === "project" ||
        (declAnchor.kind === "storyRow" && input.sceneFnCatalog.blueprintIds.has(declAnchor.blueprintId));
    if (!visible) {
        throw new Error(`Fn "${decl.name}" is not available in this scene`);
    }
    const blueprintLocals: Record<string, unknown> = {};
    const seededArgs: Record<string, unknown> = {};
    for (const param of decl.params) {
        seededArgs[param.pinId] = args[param.pinId];
    }
    writeBlueprintNodeOutputValues(blueprintLocals, decl.headNodeId, seededArgs);
    const graph = adaptBlueprintGraphIr(decl.ir, buildBlueprintRunGraphId("storyActionFn", decl.blueprintId, decl.graphId));
    const result = await executeGraph({
        graph,
        entry: { start: { nodeId: decl.headNodeId, port: "then" as const } },
        hostAdapter: options.buildHostAdapter(),
        blueprintLocals,
        executionOwner: { blueprintId: decl.blueprintId },
        persistentVariables: input.persistentVariables,
        signal: options.signal,
        fnCallDepth: depth + 1,
    });
    const returns =
        result.returnValueSet && result.returnValue && typeof result.returnValue === "object" && !Array.isArray(result.returnValue)
            ? (result.returnValue as Record<string, unknown>)
            : {};
    return { returns };
}

/** Read Scene.local's Storable namespace name (runtime-only accessor, not in the public types). */
function sceneLocalNamespaceName(scene: Scene): string {
    const local = (scene as unknown as { local: { getNamespaceName?: () => string } }).local;
    return local?.getNamespaceName?.() ?? "";
}

function assertSerializable(value: unknown): void {
    if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
        throw new Error("Saved and Persistent variables must hold serializable values");
    }
}
