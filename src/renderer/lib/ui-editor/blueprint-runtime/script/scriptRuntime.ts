/**
 * Running a script layer: mounting the compiled modules, and building the `ctx` a handler gets.
 *
 * The bundle names each script by a URL the host wrote it to (see the Dev Mode script compiler).
 * This imports that URL, finds the export a dispatched event calls, and assembles the context
 * `scriptContext.ts` describes - so what the types promised an author is what their handler is
 * handed.
 *
 * # Loaded as a module, from a URL the host serves
 *
 * Each script is imported as an ES module with its own scope: its top-level declarations are
 * private to it, and `import` inside it resolves against the bundle esbuild produced rather than
 * against anything here. It comes from a URL rather than from text because that is the only way a
 * script gets into a page at all - see {@link importAsModule} for the two policies that decide it.
 *
 * What it is not is an isolate. A script running in Dev Mode is in Studio's renderer, which has a
 * privileged preload bridge on `window`, so a determined script could reach past `ctx`. That is a
 * **fidelity** gap rather than a security one - the trust gate decides whether a project's code runs
 * at all, before any of this - and it is worth naming: a script that reaches `window` works in Dev
 * Mode and does nothing in a packaged game, which is the one class of bug this arrangement can
 * produce. Closing it means running scripts in a worker, and every synchronous read on `ctx` - the
 * whole value tier, and a story condition - would become asynchronous, so it is a later shape, not
 * an oversight.
 */

import type { BlueprintHostApiRuntime } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { Blueprint } from "@shared/types/blueprint/document";
import { listScriptLayers, scriptLayerKey } from "@shared/blueprint/blueprintLayers";
import { scriptEventExportName, type ScriptEventId } from "./scriptEvents";
import type { GameScriptContext, ScriptListRow, ScriptSelf, ScriptWidgetType } from "./scriptContext";

/** A mounted script: its module namespace, and where it came from for a message that names a file. */
type MountedScript = { scriptRef: string; module: Record<string, unknown> };

/**
 * Mounted modules by script-layer key ({@link scriptLayerKey}), and the URLs they came from.
 *
 * By layer rather than by blueprint: a blueprint can hold several script layers, and a layer id is
 * only unique inside its own blueprint.
 *
 * On `globalThis` because Dev Mode replaces the whole bundle on a reload and the dispatcher is
 * reached from several module instances; a module-local map would be one per copy.
 */
type ScriptMountState = { modules: Record<string, MountedScript>; urls: string[] };

declare global {
    // eslint-disable-next-line no-var
    var __NL_BP_SCRIPTS__: ScriptMountState | undefined;
}

function state(): ScriptMountState {
    globalThis.__NL_BP_SCRIPTS__ ??= { modules: {}, urls: [] };
    return globalThis.__NL_BP_SCRIPTS__;
}

/** What a bundle carries for each script layer: where its compiled module was written. */
export type CompiledScriptEntry = { scriptRef: string; url?: string };

/**
 * Mount every compiled script, replacing whatever was mounted before.
 */
export async function mountCompiledScripts(
    scripts: Readonly<Record<string, CompiledScriptEntry>> | undefined,
    onError: (layerKey: string, scriptRef: string, message: string) => void = () => undefined,
    // Injected so a test can mount with no host serving anything, the way the puppet runtime build
    // takes its bundler. The default is the real thing: a URL, imported.
    loadModule: (url: string) => Promise<Record<string, unknown>> = importAsModule,
): Promise<void> {
    const next: ScriptMountState = { modules: {}, urls: [] };

    for (const [layerKey, entry] of Object.entries(scripts ?? {})) {
        if (typeof entry?.url !== "string") {
            // Already reported as a compile diagnostic by whatever produced the bundle. Its layer
            // simply listens to nothing.
            continue;
        }
        try {
            const module = await loadModule(entry.url);
            next.modules[layerKey] = { scriptRef: entry.scriptRef, module };
        } catch (error) {
            // A module that throws while it is being evaluated - a top-level statement that failed.
            // The author's own code, so the message is theirs and names their file.
            onError(layerKey, entry.scriptRef, error instanceof Error ? error.message : String(error));
        }
    }

    globalThis.__NL_BP_SCRIPTS__ = next;
}

/**
 * Import the compiled module the host wrote and named.
 *
 * A plain dynamic import of a URL, because that is the only way a script can be loaded at all. The
 * Dev Mode document's `script-src` is `'self' app: file: ...` and the shipped runtime's is `'self'
 * <scheme>: 'nonce-...'`; neither admits `blob:` or `data:`, and the shipped one does not carry
 * `unsafe-eval` either, so module text held in memory has no way into a page. Loading a blob was
 * the first thing tried here and the policy refused every script - worth stating, because the
 * refusal names the blob URL and so names nothing an author would recognise.
 *
 * The query is cache-busting. Dev Mode reloads on every save and rewrites the file in place, and a
 * second import of the same URL answers from the module map with the previous revision's code - so
 * the author's edit would appear not to have taken.
 */
async function importAsModule(url: string): Promise<Record<string, unknown>> {
    const versioned = `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`;
    state().urls.push(url);
    return (await import(/* @vite-ignore */ versioned)) as Record<string, unknown>;
}

/** Drop every mounted script, so a session's modules do not outlive it. */
export function unmountCompiledScripts(): void {
    globalThis.__NL_BP_SCRIPTS__ = { modules: {}, urls: [] };
}

/**
 * The handler this script layer exports for this event, or null.
 *
 * The export name follows from the event id by one rule (`mouseClick` -> `onMouseClick`), which is
 * why there is no table here: a script and the dispatcher agree because both ask
 * {@link scriptEventExportName}.
 *
 * A **script event id**, not the id the dispatch raised. Those are two vocabularies and they differ
 * on every head named after its widget - a slider raises `valueChanged` and its head is
 * `sliderValueChanged` - so a caller translates first through `scriptEventDispatch.ts`. Passing the
 * dispatch's own id here is what made 81 declared handler names unreachable.
 */
export function resolveScriptHandler(
    layerKey: string,
    eventId: ScriptEventId,
): ((...args: unknown[]) => unknown) | null {
    const mounted = state().modules[layerKey];
    if (!mounted) {
        return null;
    }
    const handler = mounted.module[scriptEventExportName(eventId)];
    return typeof handler === "function" ? (handler as (...args: unknown[]) => unknown) : null;
}

/**
 * Every script layer of one blueprint that answers this event, in authored order.
 *
 * A list rather than one answer, and that is the whole difference between a script layer and the
 * script blueprint it replaced. Layers are siblings: the dispatcher runs every graph layer whose
 * head matches a dispatch, and it runs every script layer that exports a handler for it too. Two
 * layers answering one event is an arrangement the author can see in the layer list, not a
 * precedence rule they have to know.
 */
export function resolveScriptLayerHandlers(
    blueprint: Blueprint | undefined,
    eventId: ScriptEventId,
): Array<{ layerKey: string; handler: (...args: unknown[]) => unknown }> {
    const out: Array<{ layerKey: string; handler: (...args: unknown[]) => unknown }> = [];
    if (!blueprint) {
        return out;
    }
    for (const { layerId } of listScriptLayers(blueprint.graphs)) {
        const layerKey = scriptLayerKey(blueprint.id, layerId);
        const handler = resolveScriptHandler(layerKey, eventId);
        if (handler) {
            out.push({ layerKey, handler });
        }
    }
    return out;
}

/**
 * Every function this script layer's module exports, by name.
 *
 * For the mount-time check that reports a script exporting nothing its slot calls: the author's
 * spelling is half of that message, and only the module knows it.
 */
export function listScriptExportedFunctionNames(layerKey: string): string[] {
    const mounted = state().modules[layerKey];
    if (!mounted) {
        return [];
    }
    return Object.entries(mounted.module)
        .filter(([, value]) => typeof value === "function")
        .map(([name]) => name)
        .sort();
}

/** The default export, which is how a story row and a value binding are entered. */
export function resolveScriptDefault(layerKey: string): ((...args: unknown[]) => unknown) | null {
    const handler = state().modules[layerKey]?.module.default;
    return typeof handler === "function" ? (handler as (...args: unknown[]) => unknown) : null;
}

/** Whether this script layer has a module mounted at all - a compile that failed leaves none. */
export function isScriptMounted(layerKey: string): boolean {
    return state().modules[layerKey] !== undefined;
}

export type BuildGameScriptContextInput = {
    self: ScriptSelf;
    hostAdapter: UIHostAdapter;
    hostApi: BlueprintHostApiRuntime;
    /** This drawing's own store, with the lifetime a graph `Var` has. */
    vars: Record<string, unknown>;
    signal?: AbortSignal;
    stopPropagation: () => void;
};

/**
 * Assemble the context a UI event handler is given.
 *
 * Every member is the thing an adapter already hands a graph, which is the whole design: a script
 * gets the capability surface its slot has, never one of its own. The two surface-bound members are
 * present only where the self has a surface, exactly as the types say - a project script reads
 * `undefined` there rather than calling a method that would throw.
 */
export function buildGameScriptContext(input: BuildGameScriptContextInput): GameScriptContext {
    const runtime = input.hostAdapter.blueprintRuntime;
    const onSurface = input.self.kind === "surface" || input.self.kind === "element";
    const elementId = input.self.kind === "element" || input.self.kind === "componentElement"
        ? input.self.elementId
        : undefined;

    const broadcast = onSurface && runtime?.dispatchBroadcastEvent
        ? {
              send: async (event: string, data?: unknown) => {
                  await runtime.dispatchBroadcastEvent?.(event, data, elementId);
              },
              listenerCount: (event: string) => runtime.getBroadcastListenerCount?.(event) ?? 0,
          }
        : undefined;

    const surface = onSurface
        ? {
              isEntering: () => runtime?.getSurfaceTransitionState?.().isEntering ?? false,
              isExiting: () => runtime?.getSurfaceTransitionState?.().isExiting ?? false,
              isTransitioning: () => {
                  const transition = runtime?.getSurfaceTransitionState?.();
                  return (transition?.isEntering ?? false) || (transition?.isExiting ?? false);
              },
          }
        : undefined;

    return {
        self: input.self,
        host: input.hostApi,
        broadcast,
        surface,
        vars: input.vars,
        signal: input.signal ?? new AbortController().signal,
        stopPropagation: input.stopPropagation,
    } as GameScriptContext;
}

/**
 * Which drawing a running handler belongs to, from what the dispatcher has in hand.
 *
 * `elementId` is the element's own id and never the widget address - the address is how the runtime
 * finds this drawing's widget, and an author who was handed one would have to know to pass it back.
 * The instance key travels separately, on the host API the ctx carries.
 */
export function scriptSelfOf(input: {
    surfaceId?: string;
    componentId?: string;
    elementId?: string;
    widgetType?: string;
    row?: ScriptListRow | null;
}): ScriptSelf {
    if (input.componentId && input.elementId) {
        return {
            kind: "componentElement",
            componentId: input.componentId,
            elementId: input.elementId,
            widgetType: (input.widgetType ?? "nl.container") as ScriptWidgetType,
            params: {},
            row: input.row ?? null,
        };
    }
    if (input.surfaceId && input.elementId) {
        return {
            kind: "element",
            surfaceId: input.surfaceId,
            elementId: input.elementId,
            widgetType: (input.widgetType ?? "nl.container") as ScriptWidgetType,
            row: input.row ?? null,
        };
    }
    if (input.surfaceId) {
        return { kind: "surface", surfaceId: input.surfaceId };
    }
    return { kind: "project" };
}
