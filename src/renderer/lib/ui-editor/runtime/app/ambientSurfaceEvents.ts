/**
 * The four events that come from the game's surroundings rather than from anything on screen - a
 * preference changing, the window going fullscreen, the window gaining or losing focus, the player
 * asking to close it - and every surface that is live when one arrives.
 *
 * A surface blueprint can place a head for each of them, and so can the blueprint of every kind of
 * surface: a page, a modal layer stacked over it, an in-game surface the story put on the stage (a
 * dialogue box, a choice list, a quick menu), a page drawn inside a frame. Only the page ever heard
 * them. The four were dispatched to the global blueprint and then to the active page and to nobody
 * else, so a settings overlay that placed `On Preference Changed` to redraw itself, a pause overlay
 * that placed `On Window Focus Changed`, a quick menu that placed `On Fullscreen Changed` - each sat
 * on screen with a head that looked wired and never ran.
 *
 * These are facts about the game, not input aimed at something, so every live surface with a head
 * hears them - not only whichever one holds the keyboard. The order is fixed so a close request,
 * the one of the four a graph can answer, is answered from the top down: the global blueprint, then
 * the layers from the topmost, the page, the pages drawn in frames and the surfaces on the stage.
 * A graph that keeps the window open stops it there, as it always has; the others are not stopped by
 * anything.
 *
 * Comments in English per project convention.
 */

import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import type { PersistentVariableRuntimeTable } from "@shared/types/variables/registry";
import type { BehaviorGraphEventControl } from "@/lib/ui-editor/behavior-graph/BehaviorNodeRegistry";
import {
    dispatchGlobalBlueprintEvent,
    dispatchSurfaceBlueprintEvent,
    dispatchWidgetsBlueprintEvent,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { AppSurfaceLayerNavEntry } from "./AppSurfaceLayer";
import type { HostAdapterBundleFor } from "./hostAdapterBundles";

/** One live surface, on the host it is drawn with. */
export type AmbientSurfaceTarget = {
    surface: UISurface;
    hostAdapter: UIHostAdapter;
    runtimeScopeId: string;
};

/**
 * The live surfaces the game's own composite does not list: those the story puts on the stage and
 * the pages drawn inside frames. Each drawing registers itself while it is drawn and far enough in
 * that its graphs run, and takes itself off when it goes.
 *
 * A surface is its runtime scope, not its drawing, so each scope is listed once however many
 * drawings show it. The dialogue slot is regularly drawn twice at once over one scope - a scene
 * parked behind a returnable jump keeps its box while the scene it called has drawn its own, and two
 * concurrent branches that both speak have one each - and a page in a frame on it is drawn twice
 * with it. Listed once per drawing, each of them ran its heads twice for one event: one preference
 * change, two runs of `On Preference Changed` against the same state.
 *
 * The scope is reached through the drawing registered for it last, which is the one arriving - the
 * called scene's box, not the caller's on its way out - and through the one before it once that has
 * gone. It keeps the place in the order the scope first came in at.
 */
export class AmbientSurfaceTargets {
    /** Each scope's drawings, oldest first; the map keeps the order the scopes came in. */
    private readonly drawingsByScope = new Map<string, AmbientSurfaceTarget[]>();

    /** Add a drawing of a surface; the returned function takes it off again. */
    public add(target: AmbientSurfaceTarget): () => void {
        const drawings = this.drawingsByScope.get(target.runtimeScopeId);
        if (drawings) {
            drawings.push(target);
        } else {
            this.drawingsByScope.set(target.runtimeScopeId, [target]);
        }
        let registered = true;
        return () => {
            if (!registered) {
                return;
            }
            registered = false;
            const current = this.drawingsByScope.get(target.runtimeScopeId);
            const index = current?.lastIndexOf(target) ?? -1;
            if (!current || index < 0) {
                return;
            }
            current.splice(index, 1);
            if (current.length === 0) {
                this.drawingsByScope.delete(target.runtimeScopeId);
            }
        };
    }

    /** One per scope, in the order the scopes came in. */
    public list(): AmbientSurfaceTarget[] {
        return [...this.drawingsByScope.values()].map(drawings => drawings[drawings.length - 1]!);
    }
}

/**
 * Every live surface, in the order an ambient event reaches it: the layers from the topmost down,
 * the page, then the surfaces that registered themselves (the stage's, the frames').
 *
 * A layer is reached through the same per-entry host its layer draws it with and the keyboard
 * reaches it through (`hostAdapterBundleFor`), so a graph run from here reads and writes the layer
 * the player is looking at. `live` is the caller's answer to whether the layer's graphs run yet -
 * drawn, and far enough in - which is the answer it takes keys on.
 */
export function listAmbientSurfaceTargets(input: {
    /** Bottom to top, as the layer stack holds them. */
    layers: readonly { entry: AppSurfaceLayerNavEntry; surface: UISurface; live: boolean }[];
    page: { entry: AppSurfaceLayerNavEntry; surface: UISurface } | null;
    hostAdapterBundleFor: HostAdapterBundleFor;
    registered: AmbientSurfaceTargets;
}): AmbientSurfaceTarget[] {
    const drawn = [...input.layers]
        .filter(layer => layer.live)
        .reverse()
        .map(layer => ({ entry: layer.entry, surface: layer.surface }));
    if (input.page) {
        drawn.push(input.page);
    }
    const targets: AmbientSurfaceTarget[] = [];
    for (const { entry, surface } of drawn) {
        const host = input.hostAdapterBundleFor(entry, surface);
        if (host) {
            targets.push({ surface, hostAdapter: host.hostAdapter, runtimeScopeId: host.runtimeScopeId });
        }
    }
    return [...targets, ...input.registered.list()];
}

export type AmbientSurfaceEventName =
    | "gamePreferenceChanged"
    | "windowFullscreenChanged"
    | "windowFocusChanged"
    | "windowCloseRequested";

/**
 * The two whose heads a widget may place as well (`On Window Focus Changed`, `On Fullscreen Changed`
 * are offered on element blueprints); the other two are surface and global heads only.
 */
const WIDGET_HEARD_EVENTS: ReadonlySet<AmbientSurfaceEventName> = new Set(["windowFullscreenChanged", "windowFocusChanged"]);

export type AmbientSurfaceDispatch = {
    blueprintDocument: BlueprintDocument;
    persistentVariables: PersistentVariableRuntimeTable;
    document: UIDocument;
    core: BlueprintRuntimeCore;
    /** The host the global blueprint runs on. */
    globalHost: { hostAdapter: UIHostAdapter; runtimeScopeId: string };
    /** Every live surface, in the order the event reaches them; read once, as the event arrives. */
    readTargets: () => readonly AmbientSurfaceTarget[];
};

function stateOf(core: BlueprintRuntimeCore, runtimeScopeId: string) {
    const store = core.scopeBridge.getSurfaceStore(runtimeScopeId);
    return {
        getSurfaceState: (key: string) => store.get(key),
        setSurfaceState: (key: string, value: unknown) => store.set(key, value),
    };
}

/**
 * One ambient event, all the way through: the global blueprint, then every live surface's heads -
 * and, for the two a widget can place, every widget head on that surface.
 *
 * Each target is finished before the next starts, and one that stops propagation on `eventControl`
 * ends the event there - which is how `Keep Window Open` keeps a close request from the surfaces
 * under the one that answered it.
 */
export async function dispatchAmbientSurfaceEvent(
    input: AmbientSurfaceDispatch,
    eventName: AmbientSurfaceEventName,
    eventPayload: Record<string, unknown> | undefined,
    eventControl?: BehaviorGraphEventControl,
): Promise<void> {
    const { blueprintDocument, persistentVariables, core, globalHost } = input;
    const targets = input.readTargets();
    await dispatchGlobalBlueprintEvent({
        blueprintDocument,
        persistentVariables,
        eventName,
        eventPayload,
        eventControl,
        hostAdapter: globalHost.hostAdapter,
        debug: core.debug,
        ...stateOf(core, globalHost.runtimeScopeId),
        executionManager: core.executionManager,
    });
    for (const target of targets) {
        if (eventControl?.isPropagationStopped()) {
            return;
        }
        const state = stateOf(core, target.runtimeScopeId);
        await dispatchSurfaceBlueprintEvent({
            blueprintDocument,
            persistentVariables,
            surfaceId: target.surface.id,
            runtimeScopeId: target.runtimeScopeId,
            eventName,
            eventPayload,
            eventControl,
            hostAdapter: target.hostAdapter,
            debug: core.debug,
            ...state,
            executionManager: core.executionManager,
        });
        if (!WIDGET_HEARD_EVENTS.has(eventName)) {
            continue;
        }
        await dispatchWidgetsBlueprintEvent({
            document: input.document,
            blueprintDocument,
            persistentVariables,
            surfaceId: target.surface.id,
            runtimeScopeId: target.runtimeScopeId,
            eventName,
            eventPayload: eventPayload ?? {},
            hostAdapter: target.hostAdapter,
            debug: core.debug,
            ...state,
            executionManager: core.executionManager,
        });
    }
}
