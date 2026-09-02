/**
 * Running a script blueprint: mounting the compiled modules, and building the `ctx` a handler gets.
 *
 * The bundle carries each script as ESM text (see the Dev Mode script compiler). This turns that
 * text into a module namespace, finds the export a dispatched event calls, and assembles the context
 * `scriptContext.ts` describes - so what the types promised an author is what their handler is
 * handed.
 *
 * # Loaded as a module, not evaluated into this page's scope
 *
 * Each script becomes a blob URL and is imported. That is how the puppet backend already loads the
 * author's own renderer, and it means a script is an ES module with its own scope: its top-level
 * declarations are private to it, and `import` inside it resolves against the bundle esbuild
 * produced rather than against anything here.
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
import { scriptEventExportName, type ScriptEventId } from "./scriptEvents";
import type { GameScriptContext, ScriptListRow, ScriptSelf, ScriptWidgetType } from "./scriptContext";

/** A mounted script: its module namespace, and where it came from for a message that names a file. */
type MountedScript = { scriptRef: string; module: Record<string, unknown> };

/**
 * Mounted modules by blueprint id, and the blob URLs holding them.
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

/** What a bundle carries for each script blueprint. */
export type CompiledScriptEntry = { scriptRef: string; code?: string };

/**
 * Mount every compiled script, replacing whatever was mounted before.
 *
 * Every previous blob URL is revoked first: Dev Mode reloads on each save, and a session that
 * reloads a hundred times would otherwise hold a hundred copies of every script for as long as the
 * window is open.
 */
export async function mountCompiledScripts(
    scripts: Readonly<Record<string, CompiledScriptEntry>> | undefined,
    onError: (blueprintId: string, scriptRef: string, message: string) => void = () => undefined,
    // Injected so a test can mount without a blob URL, the way the puppet runtime build takes its
    // bundler. The default is the real thing: a module, imported.
    loadModule: (code: string) => Promise<Record<string, unknown>> = importAsModule,
): Promise<void> {
    const previous = state();
    for (const url of previous.urls) {
        URL.revokeObjectURL(url);
    }
    const next: ScriptMountState = { modules: {}, urls: [] };

    for (const [blueprintId, entry] of Object.entries(scripts ?? {})) {
        if (typeof entry?.code !== "string") {
            // Already reported as a compile diagnostic by whatever produced the bundle. Its
            // blueprint simply listens to nothing.
            continue;
        }
        try {
            const module = await loadModule(entry.code);
            next.modules[blueprintId] = { scriptRef: entry.scriptRef, module };
        } catch (error) {
            // A module that throws while it is being evaluated - a top-level statement that failed.
            // The author's own code, so the message is theirs and names their file.
            onError(blueprintId, entry.scriptRef, error instanceof Error ? error.message : String(error));
        }
    }

    globalThis.__NL_BP_SCRIPTS__ = next;
}

/**
 * Turn module text into a module: a blob URL, imported.
 *
 * The URL is remembered so the next mount can revoke it. Dev Mode reloads on every save, and a
 * session that reloaded a hundred times would otherwise hold a hundred copies of every script for
 * as long as the window is open.
 */
async function importAsModule(code: string): Promise<Record<string, unknown>> {
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    state().urls.push(url);
    return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
}

/** Drop every mounted script. Used when a session ends, so its blobs do not outlive it. */
export function unmountCompiledScripts(): void {
    for (const url of state().urls) {
        URL.revokeObjectURL(url);
    }
    globalThis.__NL_BP_SCRIPTS__ = { modules: {}, urls: [] };
}

/**
 * The handler this blueprint exports for this event, or null.
 *
 * The export name follows from the event id by one rule (`mouseClick` -> `onMouseClick`), which is
 * why there is no table here: a script and the dispatcher agree because both ask
 * {@link scriptEventExportName}.
 */
export function resolveScriptHandler(blueprintId: string, eventId: string): ((...args: unknown[]) => unknown) | null {
    const mounted = state().modules[blueprintId];
    if (!mounted) {
        return null;
    }
    const handler = mounted.module[scriptEventExportName(eventId as ScriptEventId)];
    return typeof handler === "function" ? (handler as (...args: unknown[]) => unknown) : null;
}

/** The default export, which is how a story row and a value binding are entered. */
export function resolveScriptDefault(blueprintId: string): ((...args: unknown[]) => unknown) | null {
    const handler = state().modules[blueprintId]?.module.default;
    return typeof handler === "function" ? (handler as (...args: unknown[]) => unknown) : null;
}

/** Whether this blueprint has a module mounted at all - a compile that failed leaves none. */
export function isScriptMounted(blueprintId: string): boolean {
    return state().modules[blueprintId] !== undefined;
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
