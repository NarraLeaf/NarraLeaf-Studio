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

import { Script } from "narraleaf-react";
import type { Scene, ScriptCtx } from "narraleaf-react";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { collectStoryActionEventHeadNodeIdsForDispatch } from "@shared/types/blueprint/graph";
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

export type CompileStoryActionScriptInput = {
    blueprintDocument: BlueprintDocument;
    blueprintId: string;
    nlrScene: Scene;
    sceneFnCatalog: StoryActionFnCatalog;
    sceneVariables: Record<string, StorySceneVariableDefinition>;
    savedVariables: Record<string, StorySavedVariableDefinition>;
    savedNamespace: string;
    persistence?: StoryPersistenceBridgeLike;
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
    const activeId = document.ownerRecords?.[ownerKey]?.activeBlueprintId ?? blueprintId;
    return document.blueprints?.[activeId] ?? document.blueprints?.[blueprintId];
}

type StoryActionExecutionEnv = {
    input: CompileStoryActionScriptInput;
    hostAdapter: UIHostAdapter;
    signal: AbortSignal;
};

/**
 * Compile a Story Action Blueprint into an NLR `Script` action, or `null` when it cannot be compiled
 * (missing blueprint, not a graph, or no "On Call" event). The action form ignores any Return Value.
 */
export function compileStoryActionBlueprintToScript(input: CompileStoryActionScriptInput): unknown {
    const bp = resolveActiveStoryActionBlueprint(input.blueprintDocument, input.blueprintId);
    if (!bp) {
        input.onDiagnostic?.("Story Action Blueprint not found; the action was skipped.");
        return null;
    }
    if (bp.program.kind !== "graph") {
        input.onDiagnostic?.("Story Action Blueprint is not a graph blueprint; the action was skipped.");
        return null;
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
 * Evaluate a Story Action Blueprint's "On Call" graph SYNCHRONOUSLY and return its captured Return
 * Value. Used for inline text interpolation, where a NarraLeaf-React dynamic `Word` must produce a
 * value in the same tick and cannot await. Inline blueprints are restricted to synchronous nodes at
 * authoring time (no `isLatent`/async nodes); if an async node is nonetheless reached, `executeGraphSync`
 * throws `AsyncNodeInSyncGraphError`, which the caller catches and renders as empty. Returns `undefined`
 * when the blueprint is missing or is not a graph.
 */
export function evaluateStoryActionBlueprintValueSync(input: CompileStoryActionScriptInput, ctx: ScriptCtx): unknown {
    const bp = resolveActiveStoryActionBlueprint(input.blueprintDocument, input.blueprintId);
    if (!bp || bp.program.kind !== "graph") {
        return undefined;
    }
    // No async work runs synchronously, so a never-aborting signal suffices for the host adapter.
    const hostAdapter = buildStoryActionHostAdapter(input, ctx, new AbortController().signal);
    let lastReturn: unknown;
    for (const eventGraph of Object.values(bp.program.graphs.events ?? {})) {
        const ir = eventGraph.graph;
        const headIds = collectStoryActionEventHeadNodeIdsForDispatch(ir?.nodes);
        if (headIds.length === 0 || !ir) continue;
        const graph = adaptBlueprintGraphIr(ir, `storyActionValue:${bp.id}:${eventGraph.id}`);
        for (const headId of headIds) {
            const result = executeGraphSync({
                graph,
                entry: { start: { nodeId: headId, port: "then" as const } },
                hostAdapter,
                blueprintLocals: {},
                eventName: "onCall",
                executionOwner: { blueprintId: bp.id },
                persistentVariables: input.blueprintDocument.persistentVariables,
            });
            if (result.returnValueSet) lastReturn = result.returnValue;
        }
    }
    return lastReturn;
}

type StorableNamespaceLike = {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => unknown;
    has: (key: string) => boolean;
};

function buildStoryActionHostAdapter(
    input: CompileStoryActionScriptInput,
    ctx: ScriptCtx,
    signal: AbortSignal,
): UIHostAdapter {
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

    const persistence = input.persistence;
    const hostApi = persistence
        ? {
              persistence: {
                  get: async (storageKey: string) => persistence.get(storageKey),
                  set: async (storageKey: string, value: unknown) => {
                      assertSerializable(value);
                      await persistence.set(storageKey, value);
                  },
              },
          }
        : undefined;

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
    if (!bp || bp.program.kind !== "graph") {
        return undefined;
    }
    let lastReturn: unknown;
    for (const eventGraph of Object.values(bp.program.graphs.events ?? {})) {
        const ir = eventGraph.graph;
        const headIds = collectStoryActionEventHeadNodeIdsForDispatch(ir?.nodes);
        if (headIds.length === 0 || !ir) continue;
        const graph = adaptBlueprintGraphIr(ir, `storyAction:${bp.id}:${eventGraph.id}`);
        for (const headId of headIds) {
            const result = await executeGraph({
                graph,
                entry: { start: { nodeId: headId, port: "then" as const } },
                hostAdapter: env.hostAdapter,
                blueprintLocals: {},
                eventName: "onCall",
                executionOwner: { blueprintId: bp.id },
                persistentVariables: env.input.blueprintDocument.persistentVariables,
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
    const visible =
        decl.owner.kind === "globalMain" ||
        (decl.owner.kind === "storyAction" && input.sceneFnCatalog.blueprintIds.has(decl.owner.blueprintId));
    if (!visible) {
        throw new Error(`Fn "${decl.name}" is not available in this scene`);
    }
    const blueprintLocals: Record<string, unknown> = {};
    const seededArgs: Record<string, unknown> = {};
    for (const param of decl.params) {
        seededArgs[param.pinId] = args[param.pinId];
    }
    writeBlueprintNodeOutputValues(blueprintLocals, decl.headNodeId, seededArgs);
    const graph = adaptBlueprintGraphIr(decl.ir, `storyActionFn:${decl.blueprintId}:${decl.graphId}`);
    const result = await executeGraph({
        graph,
        entry: { start: { nodeId: decl.headNodeId, port: "then" as const } },
        hostAdapter: options.buildHostAdapter(),
        blueprintLocals,
        executionOwner: { blueprintId: decl.blueprintId },
        persistentVariables: input.blueprintDocument.persistentVariables,
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
