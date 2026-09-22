/**
 * The runtime a page drawn inside a Page widget (`nl.frame`) runs on, wherever the widget is.
 *
 * A Page widget embeds another page the way a same-origin iframe does: the page it shows is a live
 * surface - its Surface Init, its widgets' events, its value bindings, the Page Event it sends back
 * to the frame - and it shares the host environment around it rather than getting one of its own.
 * Its host API is built from the same game capabilities as every other surface of the game, and
 * the answers that belong to where it is drawn (is this over a running game?) are read from the
 * surface it is drawn on.
 *
 * Every host that draws a surface while a game runs hands its element tree this - the app's pages
 * and layers, and every Game UI slot surface (the dialogue box, the choice menu, notifications, NVL,
 * the on-stage layer). A host that draws surfaces and does not is a host where a page placed in a
 * frame is drawn and never runs: the element tree then falls back to the parent's adapter, which
 * looks blueprints up under the parent's surface id and finds none of the page's. That is what a
 * Page widget on a slot surface did until every slot took this from the same place the pages do.
 *
 * ## The page's scope follows the drawing around it
 *
 * The page's scope is derived from the scope of the surface around it (see the element tree's
 * `defaultFrameRuntimeScopeId`), so it is exactly as fine-grained as that surface's: each choice
 * menu has a scope of its own and so does a page in one, while the drawings of the dialogue slot
 * that are on screen together - a scene parked behind a returnable jump and the scene it called,
 * two concurrent branches that both speak - share the slot's scope, and so share the page in it.
 * That is the slot's own rule: its scope stays open until the last drawing leaves, and its Surface
 * Init runs when the first arrives rather than once per drawing. The page follows it through
 * `scopeHeld`, so the drawing that leaves first never closes the page under the one that stays.
 * Closing it there would be a cancellation rather than an error: the page would stay on screen
 * and quietly stop answering.
 *
 * Comments in English per project convention.
 */

import type { MutableRefObject } from "react";
import type { DevModeBundle } from "@shared/types/devMode";
import { createDevModeBlueprintHostApi } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { dispatchSurfaceBlueprintEvent } from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { createDevModeBlueprintHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import type { NestedSurfaceRuntime } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { AmbientSurfaceTargets } from "./ambientSurfaceEvents";
import {
    buildGameHostApiOptions,
    type GameHostCapabilities,
    type GameHostSurfaceBinding,
} from "./gameHostApiOptions";
import {
    executeLifecycleCommands,
    type LifecycleCommandExecutor,
    type SurfaceLifecycleOrchestrator,
} from "./lifecycle/surfaceLifecycleOrchestrator";

/** What the nested pages of one running game are built from - the same as its other surfaces. */
export type NestedSurfaceHostInputs = {
    core: BlueprintRuntimeCore;
    /** The game's capabilities, as the surface the frame is drawn on was given them. */
    capabilities: GameHostCapabilities;
    bundle: DevModeBundle;
    /** As the surface around the frame starts a story; see `GameHostSurfaceBinding.startStory`. */
    startStory: GameHostSurfaceBinding["startStory"];
    widgetPatches: GameHostSurfaceBinding["widgetPatches"];
    /** The game's lifecycle bookkeeping, shared with every other surface of it. */
    lifecycleRef: MutableRefObject<SurfaceLifecycleOrchestrator>;
    /**
     * Where a live nested page registers for the game's window and preference events. Absent on a
     * host that raises none of them, such as the story editor's preview.
     */
    ambientSurfaces?: AmbientSurfaceTargets;
};

export function createNestedSurfaceHost(inputs: NestedSurfaceHostInputs): NestedSurfaceRuntime {
    const { core, capabilities, bundle, lifecycleRef, ambientSurfaces } = inputs;
    const globalState = {
        get: (key: string) => core.scopeBridge.globalGet(key),
        subscribe: (listener: () => void) => core.scopeBridge.subscribeGlobals(listener),
    };
    return {
        createHostAdapter: input => {
            const runtimeScopeId = input.runtimeScopeId;
            let nestedHostAdapter: UIHostAdapter | null = null;
            const hostApi = createDevModeBlueprintHostApi(buildGameHostApiOptions(capabilities, {
                document: bundle.ui.uidoc,
                scope: core.scopeBridge,
                emit: event => core.debug.emit(event),
                activeSurfaceId: input.targetSurface.id,
                runtimeScopeId,
                pageProps: input.params,
                // Inherited rather than decided: a frame is drawn inside a surface, so whether it is
                // over a running game is that surface's answer, not one of its own - a page's, from
                // how it was pushed, or a Game UI slot's, which is always yes.
                isGameOverlay: () =>
                    input.parentHostAdapter.blueprintRuntime?.hostApi?.game.isGameOverlay() === true,
                // As the surface around it; see `createStoryStartGate`.
                startStory: inputs.startStory,
                widgetPatches: inputs.widgetPatches,
                resolveHostAdapter: () => nestedHostAdapter,
                frame: {
                    params: input.params,
                    // Through the frame's own dispatch, so it lands in the drawing the frame is in:
                    // a frame in a list row hears its page as that row, not as nobody.
                    emit: async (eventName, data) => {
                        const payload = { event: eventName, data };
                        if (input.dispatchFrameEvent) {
                            await input.dispatchFrameEvent("pageEvent", payload);
                            return;
                        }
                        await input.parentHostAdapter.blueprintRuntime?.dispatchElementBlueprintEvent(
                            input.frameElement.id,
                            "pageEvent",
                            payload,
                        );
                    },
                },
            }));
            const adapter = createDevModeBlueprintHostAdapter({
                bundle,
                surface: input.targetSurface,
                runtimeScopeId,
                scopeBridge: core.scopeBridge,
                debug: core.debug,
                hostApi,
                executionManager: core.executionManager,
            });
            // Which Game UI slot the page is drawn in, if any, is the slot's to say: a page in the
            // dialogue box draws the line being spoken as the box itself does.
            const { gameUiRuntime } = input.parentHostAdapter;
            nestedHostAdapter = gameUiRuntime ? { ...adapter, gameUiRuntime } : adapter;
            return nestedHostAdapter;
        },
        createBindingContext: input => ({
            blueprintDocument: bundle.ui.localBlueprints,
            persistentVariables: bundle.ui.persistentVariables,
            surfaceState: core.scopeBridge.getSurfaceStore(input.runtimeScopeId),
            debug: core.debug,
            coalescer: core.bindingDebugCoalescer,
            globalState,
            pageProps: input.params,
        }),
        mountSurface: input => {
            const surfaceStore = core.scopeBridge.getSurfaceStore(input.runtimeScopeId);
            const executor: LifecycleCommandExecutor = {
                openScope: scopeId => core.executionManager.openScope(scopeId),
                closeScope: (scopeId, reason) => core.executionManager.closeScope(scopeId, reason),
                dispatchSurfaceEvent: command => {
                    void dispatchSurfaceBlueprintEvent({
                        blueprintDocument: bundle.ui.localBlueprints,
                        persistentVariables: bundle.ui.persistentVariables,
                        surfaceId: command.surfaceId,
                        runtimeScopeId: command.scopeId,
                        eventName: command.eventName,
                        hostAdapter: input.hostAdapter,
                        debug: core.debug,
                        getSurfaceState: key => surfaceStore.get(key),
                        setSurfaceState: (key, value) => surfaceStore.set(key, value),
                        executionManager: core.executionManager,
                        ...(command.allowClosedScopeExecution ? { allowClosedScopeExecution: true } : {}),
                    });
                },
                setTransitionState: () => undefined,
                bumpLifecycleSignal: () => undefined,
                clearInteraction: () => undefined,
            };
            // Held for as long as this drawing shows the page, released on the way out below: see
            // "The page's scope follows the drawing around it" above. A scope only ever held once
            // closes on its first release, as a page of the app's always has.
            lifecycleRef.current.scopeHeld(input.runtimeScopeId);
            executeLifecycleCommands(
                lifecycleRef.current.surfaceReady(input.runtimeScopeId, input.targetSurface.id),
                executor,
            );
            // A page drawn in a frame is a live surface like any other: its window and preference
            // heads hear what the surface around it hears.
            const leaveAmbient = ambientSurfaces?.add({
                surface: input.targetSurface,
                hostAdapter: input.hostAdapter,
                runtimeScopeId: input.runtimeScopeId,
            });
            return () => {
                leaveAmbient?.();
                executeLifecycleCommands(
                    lifecycleRef.current.surfaceUnmounted(input.runtimeScopeId, input.targetSurface.id),
                    executor,
                );
            };
        },
        getWidgetRuntimePatches: input => inputs.widgetPatches.byScopeRef.current[input.runtimeScopeId] ?? {},
    };
}
